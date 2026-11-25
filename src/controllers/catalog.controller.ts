import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { catalog } from '../services/catalog.service';
import { CatalogError } from '../types/catalog.types';
import { urlTransformer, webUrl } from '../utils/url-transformer';

const id = z.string().regex(/^\d{1,32}$/, 'Use a numeric Meta product ID.');
const update = z.object({
  url: z.string().max(4096).refine(value => Boolean(webUrl(value)), 'Use an absolute HTTP(S) URL without credentials.'),
  expectedUrl: z.string().optional(),
});
const bulk = z.object({ products: z.array(update.extend({ id })).min(1).max(500) });
const list = z.object({
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).default(''),
});

export function errorMessage(error: unknown) {
  return error instanceof CatalogError ? error.message : 'An unexpected error occurred.';
}

async function getPage(req: Request) {
  const { page, pageSize, q } = list.parse(req.query);
  return { catalogId: env.META_CATALOG_ID, q, ...await catalog.page(page, pageSize, q) };
}

async function getDashboardRule(req: Request) {
  const defaults = { from: '', to: env.URL_REPLACEMENT_TO.href };
  const rule = (key: keyof typeof defaults) => {
    const value = req.query[key];
    return value === undefined ? defaults[key] : typeof value === 'string' ? value.trim() : '';
  };
  const customFrom = req.query.from !== undefined;
  const from = rule('from');
  const to = rule('to');
  const target = webUrl(to);
  const source = webUrl(from);
  if ((customFrom && (!source || source.search || source.hash)) || !target || target.search || target.hash ||
      from.length > 2048 || to.length > 2048) {
    throw new CatalogError(400, 'From URL and To URL must be absolute HTTP(S) URLs without credentials, queries, or fragments and at most 2048 characters.');
  }
  const origins = await catalog.originalOrigins();
  const effectiveFrom = !customFrom && origins.length === 1 ? origins[0] : from;
  const effectiveSource = webUrl(effectiveFrom);
  const transform = effectiveSource && urlTransformer(effectiveSource, target);
  return { from: effectiveFrom, to, customFrom, origins, transform };
}

export async function listProposedUpdates(req: Request, res: Response) {
  const { q } = list.parse(req.query);
  const { transform } = await getDashboardRule(req);
  const { products } = await catalog.page(1, Number.MAX_SAFE_INTEGER, q);
  res.json(products.flatMap(product => {
    const url = transform && transform(product.url);
    return url ? [{ id: product.id, url, expectedUrl: product.url }] : [];
  }));
}

export async function renderCatalog(req: Request, res: Response) {
  try {
    const result = await getPage(req);
    const { from, to, customFrom, origins, transform } = await getDashboardRule(req);
    const products = result.products.map(product => ({ ...product, newUrl: transform ? transform(product.url) : undefined }));
    res.render('catalog', { ...result, products, from, to, customFrom, origins, error: null });
  } catch (error) {
    res.status(error instanceof z.ZodError ? 400 : error instanceof CatalogError ? error.status : 500)
      .render('catalog', {
        catalogId: env.META_CATALOG_ID, products: [], total: 0, matching: 0, q: '', page: 1, totalPages: 1,
        from: typeof req.query.from === 'string' ? req.query.from.slice(0, 2048) : '',
        to: typeof req.query.to === 'string' ? req.query.to.slice(0, 2048) : env.URL_REPLACEMENT_TO.href,
        customFrom: req.query.from !== undefined, origins: [],
        pageSize: 25, error: error instanceof z.ZodError ? 'Invalid search or page parameters.' : errorMessage(error),
      });
  }
}

export async function listProducts(req: Request, res: Response) {
  res.json(await getPage(req));
}

export async function getProduct(req: Request, res: Response) {
  res.json(await catalog.getProduct(id.parse(req.params.id)));
}

export async function refreshCatalog(req: Request, res: Response) {
  list.parse(req.query);
  await catalog.refresh();
  res.json(await getPage(req));
}

export async function updateUrl(req: Request, res: Response) {
  const { url, expectedUrl } = update.parse(req.body);
  await catalog.updateProductUrl(id.parse(req.params.id), url, expectedUrl);
  res.json({ success: true });
}

export async function bulkUpdateUrls(req: Request, res: Response) {
  const { products } = bulk.parse(req.body);
  if (new Set(products.map(product => product.id)).size !== products.length) {
    throw new CatalogError(400, 'Each product ID must appear once per bulk request.');
  }
  const streaming = req.accepts(['json', 'application/x-ndjson']) === 'application/x-ndjson';
  if (streaming) {
    res.type('application/x-ndjson');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }
  const emit = (event: object) => {
    if (streaming && !res.destroyed) res.write(JSON.stringify(event) + '\n');
  };
  const results = await catalog.bulkUpdateProductUrls(products, result => emit({ type: 'result', result }));
  const success = results.every(result => result.status === 'updated');
  if (streaming) {
    emit({ type: 'complete', success });
    if (!res.destroyed) res.end();
  } else {
    res.json({ success, results });
  }
}
