import type { Author, Reference } from "./types.js";
import {
  formatEntries as formatFallback,
  normDoi,
  type FormattedEntry,
} from "./format.js";

export interface CslDoc {
  title: string;
  xml: string;
  locales: Record<string, string>;
}

export interface CslStyleSummary {
  id: string;
  title: string;
}

export const defaultStyleId = "harvard-the-university-of-northampton";
export const defaultStyleTitle =
  "The University of Northampton (author-date/Harvard)";

export const bundledStyles: CslStyleSummary[] = [
  { id: "harvard-the-university-of-northampton", title: "The University of Northampton (author-date/Harvard)" },
  { id: "apa", title: "APA Style 7th edition" },
  { id: "modern-language-association", title: "MLA Handbook 9th edition (in-text citations)" },
  { id: "chicago-author-date", title: "Chicago Manual of Style 18th edition (author-date)" },
  { id: "ieee", title: "IEEE Reference Guide" },
  { id: "vancouver", title: "NLM/Vancouver: Citing Medicine 2nd edition (citation-sequence)" },
];

export function defaultStyle(): { styleId: string; styleTitle: string } {
  return { styleId: defaultStyleId, styleTitle: defaultStyleTitle };
}

export async function loadBundledStyle(id: string): Promise<CslDoc | null> {
  const bundled = bundledStyles.find((style) => style.id === id);
  if (!bundled) return null;
  try {
    const [xmlRes, localeRes] = await Promise.all([
      fetch(chrome.runtime.getURL(`csl/${id}.xml`)),
      fetch(chrome.runtime.getURL("csl/locales-en-US.xml")),
    ]);
    if (!xmlRes.ok || !localeRes.ok) return null;
    const [xml, localeXml] = await Promise.all([xmlRes.text(), localeRes.text()]);
    if (!/<style\b/i.test(xml)) return null;
    return { title: bundled.title, xml, locales: { "en-US": localeXml } };
  } catch {
    return null;
  }
}

type CslName = { family: string; given?: string };
type CslItem = {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: { "date-parts": number[][] };
  accessed?: { "date-parts": number[][] };
  "container-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  genre?: string;
};

const cslTypes: Record<Reference["type"], string> = {
  book: "book",
  chapter: "chapter",
  journal: "article-journal",
  website: "webpage",
  report: "report",
  thesis: "thesis",
  newspaper: "article-newspaper",
  film: "motion_picture",
  other: "article",
};

function dateParts(value: string | null | undefined): number[][] | undefined {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return [[Number(iso[1]), Number(iso[2]), Number(iso[3])]];
  const year = value.match(/\d{4}/);
  return year ? [[Number(year[0])]] : undefined;
}

function cslNames(authors: Author[] | undefined): CslName[] {
  return (authors ?? [])
    .map((author) => {
      const family = (author.family ?? "").trim();
      const given = (author.given ?? "").trim();
      return given ? { family, given } : { family };
    })
    .filter((author) => author.family);
}

function toCslItem(row: Reference): CslItem {
  const item: CslItem = { id: row.id, type: cslTypes[row.type] ?? "article" };
  if (row.title.trim()) item.title = row.title.trim();
  const authors = cslNames(row.authors);
  if (authors.length) item.author = authors;
  const editors = cslNames(row.editors);
  if (editors.length) item.editor = editors;
  const issued = dateParts(row.year) ?? dateParts(row.publicationDate);
  if (issued) item.issued = { "date-parts": issued };
  if (row.containerTitle.trim()) item["container-title"] = row.containerTitle.trim();
  if (row.publisher.trim()) item.publisher = row.publisher.trim();
  if (row.place.trim()) item["publisher-place"] = row.place.trim();
  if (row.edition.trim()) item.edition = row.edition.trim();
  if (row.volume.trim()) item.volume = row.volume.trim();
  if (row.issue.trim()) item.issue = row.issue.trim();
  if (row.pages.trim()) item.page = row.pages.trim();
  const doi = normDoi(row.doi);
  if (doi) item.DOI = doi;
  if (row.url.trim()) item.URL = row.url.trim();
  const accessed = dateParts(row.accessedDate);
  if (accessed) item.accessed = { "date-parts": accessed };
  if (row.type === "thesis") item.genre = "Thesis";
  return item;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

function stripEntryWrapper(entry: string): string {
  let value = entry.trim();
  if (value.startsWith('<div class="csl-entry">')) {
    value = value.slice('<div class="csl-entry">'.length);
  }
  if (value.endsWith("</div>")) value = value.slice(0, -"</div>".length);
  return value.trim();
}

function htmlToPlain(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(?:div|p|li|h[1-6])>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function renderCsl(
  refs: Reference[],
  doc: CslDoc,
): FormattedEntry[] | null {
  try {
    if (refs.length === 0) return [];
    if (typeof CSL === "undefined") return null;
    const items: Record<string, CslItem> = {};
    for (const row of refs) items[row.id] = toCslItem(row);
    const engine = new CSL.Engine(
      {
        retrieveLocale: (lang: string) =>
          doc.locales[lang] ?? doc.locales["en-US"] ?? "",
        retrieveItem: (id: string) => items[id],
      },
      doc.xml,
    );
    engine.setOutputFormat("html");
    engine.updateItems(refs.map((row) => row.id));
    const bibliography = engine.makeBibliography();
    if (!bibliography) return null;
    const [meta, rawEntries] = bibliography as [
      { entry_ids: string[][] },
      string[],
    ];
    const typeById = new Map(refs.map((row) => [row.id, row.type]));
    const entries = meta.entry_ids
      .map((group, index) => {
        const id = group[0];
        if (!id) return null;
        const html = stripEntryWrapper(rawEntries[index] ?? "");
        const plain = htmlToPlain(html);
        if (!plain) return null;
        return { id, type: typeById.get(id) ?? "other", plain, html };
      })
      .filter((entry): entry is { id: string; type: Reference["type"]; plain: string; html: string } => entry !== null);
    const citations = entries.map((entry) => ({
      id: entry.id,
      inText: htmlToPlain(engine.makeCitationCluster([{ id: entry.id }])),
    }));
    const inTextById = new Map(citations.map((citation) => [citation.id, citation.inText]));
    return entries.map((entry) => ({
      id: entry.id,
      plain: entry.plain,
      html: entry.html,
      inText: inTextById.get(entry.id) ?? "",
    }));
  } catch {
    return null;
  }
}

export function formatWithStyle(
  refs: Reference[],
  doc: CslDoc | null,
): FormattedEntry[] {
  if (doc) {
    const rendered = renderCsl(refs, doc);
    if (rendered) return rendered;
  }
  return formatFallback(refs);
}
