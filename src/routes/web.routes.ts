import { Router } from 'express';
import { renderCatalog } from '../controllers/catalog.controller';

export const webRoutes = Router();
webRoutes.get('/', renderCatalog);
