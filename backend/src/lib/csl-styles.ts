import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import CSL from "citeproc";
import { defaultStyleId } from "./csl-defaults";
import { HttpError } from "./http";

const catalogUrl = "https://www.zotero.org/styles-files/styles.json";
const styleBaseUrl = "https://www.zotero.org/styles/";
const localeBaseUrl =
  "https://raw.githubusercontent.com/citation-style-language/locales/master/";
const cacheDir = resolve(import.meta.dir, "../../.cache/csl");
const catalogCachePath = resolve(cacheDir, "styles.json");
const styleTtlMs = 24 * 60 * 60 * 1000;
const catalogTtlMs = 6 * 60 * 60 * 1000;
const defaultLocale = "en-US";
const featuredStyles = [
  defaultStyleId,
  "apa",
  "modern-language-association",
  "chicago-author-date",
  "harvard-cite-them-right",
  "vancouver",
  "ieee",
  "nature",
  "american-medical-association",
  "oscola",
];


type CatalogStyle = {
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

type CatalogCache = {
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

type StyleCacheEntry = {
  at: number;
  style: LoadedCslStyle;
};

type LocaleCacheEntry = {
  at: number;
  xml: string;
};

let catalogMemory: CatalogCache | null = null;
const styleMemory = new Map<string, StyleCacheEntry>();
const localeMemory = new Map<string, LocaleCacheEntry>();

const sampleItem = {
  id: "myref-style-validation",
  type: "book",
  title: "Style validation",
  author: [{ family: "Doe", given: "Jane" }],
  issued: { "date-parts": [[2020]] },
  publisher: "Example Publisher",
  "publisher-place": "London",
};

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function styleXmlTag(xml: string, tag: string): string {
  const match = xml.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? decodeXml(match[1]!.trim()) : "";
}

function styleInfo(xml: string) {
  const id = styleXmlTag(xml, "id");
  const title = styleXmlTag(xml, "title");
  const updated = styleXmlTag(xml, "updated");

  const parentMatch =
    xml.match(
      /<link\b[^>]*\brel="independent-parent"[^>]*\bhref="([^"]+)"/i,
    ) ??
    xml.match(
      /<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="independent-parent"/i,
    );

  const parentId = parentMatch?.[1]?.match(/\/styles\/([^/?#]+)/)?.[1] ?? null;

  return { id, title, updated: updated || null, parentId };
}

function localeNames(xml: string): string[] {
  const names = new Set<string>([defaultLocale]);
  const xmlDefaultLocale = xml.match(/\bdefault-locale="([^"]+)"/i)?.[1];
  if (xmlDefaultLocale) names.add(xmlDefaultLocale);

  for (const match of xml.matchAll(/\bxml:lang="([^"]+)"/gi)) {
    if (match[1]) names.add(match[1]);
  }

  return [...names];
}

async function fetchText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "MyRef/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`Network request failed for ${url}`);
  }

  if (!response.ok) {
    throw new Error(`Request for ${url} returned ${response.status}`);
  }

  return response.text();
}

async function readJsonCache<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonCache(path: string, value: unknown): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(value));
  } catch {
  }
}

function styleCachePath(styleId: string): string {
  return resolve(cacheDir, `style-${styleId}.json`);
}

function localeCachePath(locale: string): string {
  const safe = locale.replace(/[^a-zA-Z0-9-]/g, "") || defaultLocale;
  return resolve(cacheDir, `locale-${safe}.json`);
}

function bundledLocale(locale: string): string | null {
  try {
    return readFileSync(
      resolve(import.meta.dir, `styles/locales-${locale}.xml`),
      "utf8",
    );
  } catch {
    return null;
  }
}

async function loadCatalog(): Promise<CatalogStyle[]> {
  if (
    catalogMemory &&
    Date.now() - catalogMemory.at < catalogTtlMs
  ) {
    return catalogMemory.styles;
  }

  try {
    const parsed = JSON.parse(await fetchText(catalogUrl)) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Invalid style catalogue");

    const styles = parsed.filter(
      (entry): entry is CatalogStyle =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as CatalogStyle).name === "string" &&
        typeof (entry as CatalogStyle).title === "string",
    );

    catalogMemory = { at: Date.now(), styles };
    await writeJsonCache(catalogCachePath, catalogMemory);
    return styles;
  } catch {
    const disk = await readJsonCache<CatalogCache>(catalogCachePath);
    if (disk?.styles?.length) {
      catalogMemory = disk;
      return disk.styles;
    }

    throw new HttpError(
      502,
      "Could not load the official CSL style catalogue from Zotero.",
    );
  }
}

function styleSummary(style: CatalogStyle): CslStyleSummary {
  return {
    id: style.name,
    name: style.name,
    title: style.title,
    titleShort: style.titleShort ?? null,
    dependent: style.dependent === 1,
    format: style.categories?.format ?? null,
    fields: style.categories?.fields ?? [],
    updated: style.updated ?? null,
    href: style.href ?? `${styleBaseUrl}${style.name}`,
    isDefault: style.name === defaultStyleId,
  };
}

export async function searchCslStyles(
  query: string,
  limit?: number,
): Promise<CslStyleSummary[]> {
  const catalog = await loadCatalog();
  const term = query.trim().toLowerCase();
  // No explicit cap by default: callers virtualize the list. An explicit
  // limit is still honored (clamped) for anyone wanting a short list.
  const maxResults =
    limit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.min(Math.max(Math.trunc(limit) || 30, 1), 20000);

  let matches: CatalogStyle[];
  if (term) {
    matches = catalog.filter((style) => {
      return (
        style.name.toLowerCase().includes(term) ||
        style.title.toLowerCase().includes(term) ||
        (style.titleShort ?? "").toLowerCase().includes(term)
      );
    });

    matches.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const rank = (name: string, title: string) => {
        if (name === term || title === term) return 0;
        if (name.startsWith(term) || title.startsWith(term)) return 1;
        return 2;
      };
      return (
        rank(aName, aTitle) - rank(bName, bTitle) ||
        aTitle.localeCompare(bTitle)
      );
    });
  } else {
    // No query: the whole catalog, featured styles first so the common
    // choices stay at the top, then alphabetical by title.
    const featured = new Map(
      featuredStyles.map((id, index) => [id, index]),
    );
    const featuredMatches = catalog
      .filter((style) => featured.has(style.name))
      .sort(
        (a, b) =>
          (featured.get(a.name) ?? 999) - (featured.get(b.name) ?? 999),
      );
    const rest = catalog
      .filter((style) => !featured.has(style.name))
      .sort((a, b) => a.title.localeCompare(b.title));
    matches = [...featuredMatches, ...rest];
  }

  return matches.slice(0, maxResults).map(styleSummary);
}

async function loadLocale(locale: string): Promise<string> {
  const name = locale.trim() || defaultLocale;

  const memory = localeMemory.get(name);
  if (memory) return memory.xml;

  const disk = await readJsonCache<LocaleCacheEntry>(localeCachePath(name));
  if (disk?.xml) {
    localeMemory.set(name, disk);
    return disk.xml;
  }

  try {
    const xml = await fetchText(`${localeBaseUrl}locales-${name}.xml`);
    const entry = { at: Date.now(), xml };
    localeMemory.set(name, entry);
    await writeJsonCache(localeCachePath(name), entry);
    return xml;
  } catch {
    const bundled = bundledLocale(name);
    if (bundled) {
      const entry = { at: Date.now(), xml: bundled };
      localeMemory.set(name, entry);
      return bundled;
    }

    if (name !== defaultLocale) {
      return loadLocale(defaultLocale);
    }

    const fallback = bundledLocale(defaultLocale);
    if (fallback) return fallback;

    throw new HttpError(
      502,
      "Could not load the official CSL locale data.",
    );
  }
}

async function loadStyleLocales(xml: string): Promise<Record<string, string>> {
  const names = localeNames(xml);
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadLocale(name)] as const),
  );
  return Object.fromEntries(entries);
}

function validateStyleRendering(
  xml: string,
  locales: Record<string, string>,
): void {
  if (!/<style\b/i.test(xml) || !/http:\/\/purl\.org\/net\/xbiblio\/csl/.test(xml)) {
    throw new Error("The downloaded file is not a CSL style.");
  }

  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang: string) =>
        locales[lang] ?? locales[defaultLocale] ?? "",
      retrieveItem: () => sampleItem,
    },
    xml,
  );

  engine.setOutputFormat("html");
  engine.updateItems([sampleItem.id]);

  const bibliography = engine.makeBibliography();
  if (
    !bibliography ||
    !Array.isArray(bibliography[1]) ||
    bibliography[1].length === 0
  ) {
    throw new Error("The CSL style could not render a bibliography.");
  }

  const citation = engine.makeCitationCluster([{ id: sampleItem.id }]);
  if (typeof citation !== "string" || !citation.trim()) {
    throw new Error("The CSL style could not render an in-text citation.");
  }
}

async function fetchValidatedStyle(
  styleId: string,
  depth = 0,
): Promise<LoadedCslStyle> {
  if (depth > 4) {
    throw new Error("The CSL style parent chain is too deep.");
  }

  const sourceUrl = `${styleBaseUrl}${styleId}`;
  const xml = await fetchText(sourceUrl);
  const info = styleInfo(xml);

  const expectedIds = [
    `http://www.zotero.org/styles/${styleId}`,
    `https://www.zotero.org/styles/${styleId}`,
  ];

  if (!expectedIds.includes(info.id)) {
    throw new Error(
      `The downloaded CSL style id did not match the requested style "${styleId}".`,
    );
  }

  if (!info.title) {
    throw new Error(`The CSL style "${styleId}" has no title.`);
  }

  if (info.parentId) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(info.parentId)) {
      throw new Error(
        `The CSL style "${styleId}" has an invalid parent style id.`,
      );
    }

    const parent = await fetchValidatedStyle(info.parentId, depth + 1);
    validateStyleRendering(parent.xml, parent.locales);

    return {
      ...parent,
      id: styleId,
      title: info.title,
      sourceUrl,
      updated: info.updated ?? parent.updated,
      parentId: info.parentId,
    };
  }

  const locales = await loadStyleLocales(xml);
  validateStyleRendering(xml, locales);

  return {
    id: styleId,
    title: info.title,
    xml,
    sourceUrl,
    updated: info.updated,
    locales,
  };
}

export async function loadCslStyle(styleId: string): Promise<LoadedCslStyle> {
  const id = styleId.trim();

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id.length > 200) {
    throw new HttpError(400, "Invalid CSL style id.");
  }

  const memory = styleMemory.get(id);
  if (memory && Date.now() - memory.at < styleTtlMs) {
    return memory.style;
  }

  const disk = await readJsonCache<StyleCacheEntry>(styleCachePath(id));
  if (disk?.style?.xml && Date.now() - disk.at < styleTtlMs) {
    try {
      validateStyleRendering(disk.style.xml, disk.style.locales);
      styleMemory.set(id, disk);
      return disk.style;
    } catch {
    }
  }

  try {
    const style = await fetchValidatedStyle(id);
    const entry = { at: Date.now(), style };
    styleMemory.set(id, entry);
    await writeJsonCache(styleCachePath(id), entry);
    return style;
  } catch {
    if (disk?.style?.xml) {
      try {
        validateStyleRendering(disk.style.xml, disk.style.locales);
        styleMemory.set(id, disk);
        return disk.style;
      } catch {
      }
    }

    throw new HttpError(
      502,
      `Could not load the official CSL style "${id}" from Zotero.`,
    );
  }
}

