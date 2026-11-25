# Meta Product Catalog URL Manager

A local Express and EJS dashboard for reviewing and updating product links in one Meta catalog. Requires Node.js 22 or later.

## Setup

1. Run `npm install`.
2. Open `.env`. If it is missing, copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell).
3. Enter the numeric catalog ID from Commerce Manager and a Meta access token with `catalog_management`. Use a user or system user assigned manage access to the catalog. Ensure the Meta app has the appropriate Marketing API access level and complete App Review if required for your integration.
4. Set `URL_REPLACEMENT_FROM` and `URL_REPLACEMENT_TO`. The sample uses Graph API `v26.0`. Set `META_API_VERSION` to a supported version for your app.
5. Set `APP_USERNAME` and `APP_PASSWORD` in `.env`. Use a unique password and quote it if it contains characters such as `#`. The username cannot contain a colon.
6. Run `npm run dev`, open [the dashboard](http://localhost:3000), and sign in at the browser prompt.

In development, the server restarts automatically when backend code or `.env` changes. Refresh the browser to load edited templates, CSS, and browser JavaScript. Use **Refresh from Meta** to reload product data from the catalog.

For compiled execution, run `npm run build` followed by `npm start` from the project root. Keep `src/views` and `src/public` alongside the compiled application. The server binds to IPv4 loopback for local use. To use a different port, change `PORT` and update `BASE_URL` to match.

## Dashboard

The dashboard fills **Current address** from the product links when they share one origin. For a catalog with multiple origins, choose a suggestion or enter an address. **New address** starts with the destination in `.env`. Click **Preview changes** after editing either field. The active rule carries through search, pagination, and refresh. The REST list uses the source and destination configured in `.env`.

The first dashboard load reads Meta's catalog in cursor pages of 100 and stores a snapshot in memory. Search by product name, Meta ID, or retailer ID across the snapshot. **Refresh from Meta** replaces the snapshot after reading all Meta pages successfully.

URL rules match the source origin and optional path prefix at a path boundary. For example, replacing `https://old.example/shop` with `https://new.example/store` maps `https://old.example/shop/phone?variant=123#specs` to `https://new.example/store/phone?variant=123#specs`. Products with missing, invalid, or unmatched URLs have no proposed change.

Use **Review proposed links** to see the changes on the current page. To change one product, choose **Edit link** on its row. To change multiple products, select their rows and click **Update selected**. In either case, **Save to Meta** confirms the update. A later import from an upstream catalog feed may replace a manually updated link.

## REST API

The dashboard and API use HTTP Basic authentication. For a local API request, run `curl.exe -u your-username http://localhost:3000/api/catalog/products` and enter your password when prompted. Keep the default loopback binding for local use. Any remote access must use HTTPS.

| Method | Path | Use |
| --- | --- | --- |
| GET | `/api/catalog/products?page=1&pageSize=25&q=shirt` | Search the catalog snapshot and return results and page totals. |
| GET | `/api/catalog/products/123` | Read a product in the configured catalog from Meta. |
| POST | `/api/catalog/refresh` | Resync and return the requested page. Accepts the same query parameters as listing. |
| POST | `/api/catalog/products/123/url` | Update a product URL. |
| POST | `/api/catalog/products/bulk-update-url` | Process up to 500 items with three updates in flight and return a result for each one. |

Bulk updates stream results to the dashboard as products finish. If Meta returns a rate-limit error, the batch stops initiating writes and reports the skipped products. Wait for the rate limit to clear before retrying.

```http
POST /api/catalog/products/123/url
Content-Type: application/json

{"url":"https://new.example/products/shirt"}
```

```http
POST /api/catalog/products/bulk-update-url
Content-Type: application/json

{"products":[{"id":"123","url":"https://new.example/products/shirt"},{"id":"456","url":"https://new.example/products/hat"}]}
```

Use Meta product item IDs in the path and payload. The optional `expectedUrl` on each update protects the reviewed original against stale previews. The URL check and write are separate Graph requests, so another integration can change a product between them. Bulk responses contain `success` (true if all succeeded) and a `results` array with `id`, `status` (`updated` or `failed`), and an `error` for failed items. Refresh after a timeout to verify the current URL before retrying.

Graph operations and error mapping live in `src/services/meta-catalog.service.ts`. Credentials are sent in a server-side authorization header. Logs record operation results, product IDs, and counts.

- [Meta Product Catalog reference](https://developers.facebook.com/docs/marketing-api/reference/product-catalog/)
- [Meta Product Item fields and update parameters](https://developers.facebook.com/docs/marketing-api/reference/product-item/)
- [Graph API cursor pagination](https://developers.facebook.com/docs/graph-api/results/)
- [Catalog permissions and roles](https://developers.facebook.com/docs/business-management-apis/business-asset-management/overview/)
- [Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/versions/)
