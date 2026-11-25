import { MetaCatalogService } from './meta-catalog.service';
import { CatalogError, type Product } from '../types/catalog.types';
import { webUrl } from '../utils/url-transformer';

const bulkConcurrency = 3;

interface UrlUpdate {
  id: string;
  url: string;
  expectedUrl?: string;
}

type BulkResult = { id: string; status: 'updated' } | { id: string; status: 'failed'; error: string; rateLimited?: true };

class CatalogService {
  private readonly meta = new MetaCatalogService();
  private products?: Map<string, Product>;
  private refreshing?: Promise<Map<string, Product>>;
  private tail: Promise<unknown> = Promise.resolve();

  private run<T>(operation: () => Promise<T>) {
    const pending = this.tail.then(operation);
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  refresh() {
    return this.refreshing ??= this.run(async () => {
      this.products = await this.meta.getCatalogProducts();
      return this.products;
    }).finally(() => { this.refreshing = undefined; });
  }

  async originalOrigins() {
    const catalog = this.products ?? await this.refresh();
    const origins = new Set<string>();
    for (const product of catalog.values()) {
      const url = webUrl(product.url);
      if (url) origins.add(url.origin);
    }
    return [...origins].sort();
  }

  async page(page: number, pageSize: number, query: string) {
    const catalog = this.products ?? await this.refresh();
    const search = query.toLowerCase();
    const matches = [...catalog.values()].filter(product =>
      [product.name, product.id, product.retailer_id].some(value => value?.toLowerCase().includes(search)));
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    return {
      total: catalog.size, matching: matches.length, page: currentPage, pageSize, totalPages,
      products: matches.slice(offset, offset + pageSize),
    };
  }

  private async requireProduct(id: string) {
    const product = (this.products ?? await this.refresh()).get(id);
    if (!product) throw new CatalogError(404, 'Product is outside the loaded catalog. Check the ID or refresh the catalog.');
    return product;
  }

  async getProduct(id: string) {
    await this.requireProduct(id);
    return this.meta.getProduct(id);
  }

  async updateProductUrl(id: string, url: string, expectedUrl?: string) {
    await this.requireProduct(id);
    return this.run(() => this.applyUrlUpdate({ id, url, expectedUrl }));
  }

  async bulkUpdateProductUrls(updates: UrlUpdate[], report: (result: BulkResult) => void) {
    try {
      if (!this.products) await this.refresh();
    } catch (error) {
      return updates.map(({ id }): BulkResult => {
        const result = this.failedUpdate(id, error);
        report(result);
        return result;
      });
    }

    return this.run(async () => {
      const results: BulkResult[] = [];
      let next = 0;
      let throttled = false;
      const record = (index: number, result: BulkResult) => {
        results[index] = result;
        report(result);
      };
      const worker = async () => {
        while (!throttled && next < updates.length) {
          const index = next++;
          const update = updates[index];
          try {
            await this.applyUrlUpdate(update, () => throttled);
            record(index, { id: update.id, status: 'updated' });
          } catch (error) {
            if (error instanceof CatalogError && error.status === 429) throttled = true;
            record(index, this.failedUpdate(update.id, error));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(bulkConcurrency, updates.length) }, worker));
      for (let index = next; index < updates.length; index++) {
        record(index, this.failedUpdate(updates[index].id, this.throttledUpdate()));
      }
      return results;
    });
  }

  private failedUpdate(id: string, error: unknown): BulkResult {
    return {
      id, status: 'failed', error: error instanceof CatalogError ? error.message : 'An unexpected error occurred.',
      ...(error instanceof CatalogError && error.status === 429 ? { rateLimited: true as const } : {}),
    };
  }

  private throttledUpdate() {
    return new CatalogError(429, 'Skipped because Meta rate-limited this batch. Wait before retrying.');
  }

  private async applyUrlUpdate({ id, url, expectedUrl }: UrlUpdate, isThrottled?: () => boolean) {
    const product = this.products?.get(id);
    if (!product) throw new CatalogError(404, 'Product is outside the loaded catalog.');
    const live = await this.meta.getProduct(id);
    if ((live.url ?? '') !== (expectedUrl ?? product.url ?? '') && live.url !== url) {
      this.products?.set(id, live);
      throw new CatalogError(409, 'The URL changed in Meta. Review the current URL and try again.');
    }
    if (live.url !== url) {
      if (isThrottled?.()) throw this.throttledUpdate();
      await this.meta.updateProductUrl(id, url);
    }
    this.products?.set(id, { ...live, url, newUrl: undefined });
  }
}

export const catalog = new CatalogService();
