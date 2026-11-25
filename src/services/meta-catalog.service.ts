import { z } from 'zod';
import { env } from '../config/env';
import { CatalogError, log, type Product } from '../types/catalog.types';
import { urlTransformer, webUrl } from '../utils/url-transformer';

const fields = 'id,retailer_id,name,description,price,currency,image_url,url,availability,brand,category,review_status,capability_to_review_status,review_rejection_reasons,errors';
const capabilitySchema = z.object({ key: z.string(), value: z.string() });
const issueSchema = z.object({
  title: z.string().nullish().transform(value => value ?? undefined),
  description: z.string().nullish().transform(value => value ?? undefined),
  error_type: z.string().nullish().transform(value => value ?? undefined),
});

function readList<T>(value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
const transform = urlTransformer(env.URL_REPLACEMENT_FROM, env.URL_REPLACEMENT_TO);
const itemSchema = z.object({ id: z.string().regex(/^\d+$/) }).catchall(z.unknown());
const pageSchema = z.object({
  data: z.array(itemSchema),
  paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional(),
});
const errorSchema = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }) });

function normalize(item: z.infer<typeof itemSchema>): Product {
  const read = (field: string) => typeof item[field] === 'string' ? item[field] as string : undefined;
  const priceLabel = read('price');
  const price = typeof item.price === 'number' ? item.price : Number(priceLabel?.match(/^-?\d+(?:\.\d+)?$/)?.[0]);
  const url = webUrl(read('url')) ? read('url') : undefined;
  const image = read('image_url');
  return {
    review: {
      status: read('review_status')?.trim().toLowerCase() || undefined,
      capabilities: readList(item.capability_to_review_status, capabilitySchema),
      rejectionReasons: readList(item.review_rejection_reasons, z.string()),
      issues: readList(item.errors, issueSchema),
    },
    id: item.id, retailer_id: read('retailer_id'), name: read('name'), description: read('description'),
    price: Number.isFinite(price) ? price : undefined, priceLabel, currency: read('currency'),
    image_url: webUrl(image) ? image : undefined, url, newUrl: transform(url),
    availability: read('availability'), brand: read('brand'), category: read('category'),
  };
}

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET') {
  if (!env.META_ACCESS_TOKEN || !env.META_CATALOG_ID) {
    throw new CatalogError(503, 'Set META_ACCESS_TOKEN and META_CATALOG_ID in .env, then restart the server.');
  }
  const endpoint = new URL('https://graph.facebook.com/' + env.META_API_VERSION + '/' + path);
  const form = new URLSearchParams(params);
  if (method === 'GET') endpoint.search = form.toString();
  let response: Response;
  let data: unknown;
  try {
    response = await fetch(endpoint, {
      method, headers: { Authorization: 'Bearer ' + env.META_ACCESS_TOKEN },
      body: method === 'POST' ? form : undefined, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    data = await response.json().catch(() => undefined);
  } catch {
    throw new CatalogError(502, 'Unable to reach Meta. Check the connection and try again.');
  }
  const failure = errorSchema.safeParse(data);
  if (!response.ok || failure.success) {
    const error = failure.success ? failure.data.error : undefined;
    if (response.status === 429 || [4, 17, 32, 613, 80009].includes(error?.code ?? 0))
      throw new CatalogError(429, 'Meta rate limit reached. Wait before retrying.');
    if (error?.code === 190 || response.status === 401)
      throw new CatalogError(401, error?.error_subcode === 463 ? 'The Meta access token expired.' : 'Meta rejected the access token. Check or renew it.');
    if (error?.code === 10 || error?.code === 200 || response.status === 403)
      throw new CatalogError(403, 'Meta denied permission. Check catalog access and catalog_management.');
    if (error?.code === 100 || response.status === 404)
      throw new CatalogError(422, method === 'POST' ? 'Meta rejected the product ID or URL.' : 'Meta rejected the catalog or product ID or the requested fields. Verify the ID, access and Graph version.');
    throw new CatalogError(502, 'Meta could not complete the request. Try again later.');
  }
  return data;
}

export class MetaCatalogService {
  async getCatalogProducts() {
    log('Catalog fetch started');
    const products = new Map<string, Product>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const parsed = pageSchema.safeParse(await graph(env.META_CATALOG_ID + '/products', {
        fields, limit: '100', ...(cursor ? { after: cursor } : {}),
      }));
      if (!parsed.success) throw new CatalogError(502, 'Meta returned an invalid catalog page.');
      for (const item of parsed.data.data) products.set(item.id, normalize(item));
      log('Products fetched', { page: ++pages, count: parsed.data.data.length });
      const paging = parsed.data.paging;
      cursor = paging?.next ? paging.cursors?.after : undefined;
      if (paging?.next && (!cursor || cursors.has(cursor))) {
        throw new CatalogError(502, 'Meta returned a missing or repeated pagination cursor. Refresh to retry.');
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    log('Pagination completed', { pages, count: products.size });
    log('URL transformation completed', { count: [...products.values()].filter(product => product.newUrl).length });
    return products;
  }

  async getProduct(productId: string) {
    const result = itemSchema.safeParse(await graph(productId, { fields, catalog_id: env.META_CATALOG_ID }));
    if (!result.success || result.data.id !== productId) throw new CatalogError(502, 'Meta returned an invalid product.');
    return normalize(result.data);
  }

  async updateProductUrl(productId: string, url: string) {
    log('Product URL update started', { productId });
    try {
      const result = z.object({ success: z.literal(true) }).safeParse(await graph(productId, { url }, 'POST'));
      if (!result.success) throw new CatalogError(502, 'Meta did not confirm the update. Refresh to check the current URL.');
      log('Product URL update successful', { productId });
    } catch (error) {
      log('Product URL update failed', { productId });
      throw error;
    }
  }
}
