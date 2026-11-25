import { Router } from 'express';
import { bulkUpdateUrls, getProduct, listProducts, listProposedUpdates, refreshCatalog, updateUrl } from '../controllers/catalog.controller';

export const catalogRoutes = Router();
catalogRoutes.get('/products', listProducts);
catalogRoutes.get('/proposed-updates', listProposedUpdates);
catalogRoutes.get('/products/:id', getProduct);
catalogRoutes.post('/refresh', refreshCatalog);
catalogRoutes.post('/products/bulk-update-url', bulkUpdateUrls);
catalogRoutes.post('/products/:id/url', updateUrl);
