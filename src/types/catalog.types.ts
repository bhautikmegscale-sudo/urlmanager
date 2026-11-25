export interface Product {
  review: {
    status?: string;
    capabilities: { key: string; value: string }[];
    rejectionReasons: string[];
    issues: { title?: string; description?: string; error_type?: string }[];
  };
  id: string;
  retailer_id?: string;
  name?: string;
  description?: string;
  price?: number;
  priceLabel?: string;
  currency?: string;
  image_url?: string;
  url?: string;
  newUrl?: string;
  availability?: string;
  brand?: string;
  category?: string;
}

export class CatalogError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function log(event: string, fields: Record<string, string | number> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
