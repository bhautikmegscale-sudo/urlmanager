import 'dotenv/config';
import { z } from 'zod';
import { webUrl } from '../utils/url-transformer';

const absoluteUrl = z.string().transform((value, context) => {
  const url = webUrl(value);
  if (url && !url.search && !url.hash) return url;
  context.addIssue({ code: 'custom', message: 'Use an HTTP(S) URL without credentials, query or fragment.' });
  return z.NEVER;
});
const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  META_ACCESS_TOKEN: z.string().trim().default(''),
  META_CATALOG_ID: z.string().trim().regex(/^\d*$/).default(''),
  META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  BASE_URL: absoluteUrl.default(new URL('http://localhost:3000')),
  APP_USERNAME: z.string().trim().max(128).regex(/^[^:\x00-\x1f\x7f]*$/).default(''),
  APP_PASSWORD: z.string().max(512).regex(/^[^\x00-\x1f\x7f]*$/).default(''),
  URL_REPLACEMENT_FROM: absoluteUrl,
  URL_REPLACEMENT_TO: absoluteUrl,
}).safeParse(process.env);

if (!config.success) {
  throw new Error('Invalid environment configuration: ' + config.error.issues.map(issue => issue.path.join('.')).join(', '));
}
export const env = config.data;
