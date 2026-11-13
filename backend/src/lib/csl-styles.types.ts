export type CatalogStyle = {
  name: string;
  title: string;
  titleShort?: string;
  dependent?: number;
  categories?: {
    format?: string;
    fields?: string[];
  };
  updated?: string;
  href?: string;
};

export type CatalogCache = {
  at: number;
  styles: CatalogStyle[];
};

export type CslStyleSummary = {
  id: string;
  name: string;
  title: string;
  titleShort: string | null;
  dependent: boolean;
  format: string | null;
  fields: string[];
  updated: string | null;
  href: string;
  isDefault: boolean;
};

export type LoadedCslStyle = {
  id: string;
  title: string;
  xml: string;
  sourceUrl: string;
  updated: string | null;
  locales: Record<string, string>;
  parentId?: string;
};

export type StyleCacheEntry = {
  at: number;
  style: LoadedCslStyle;
};

export type LocaleCacheEntry = {
  at: number;
  xml: string;
};
