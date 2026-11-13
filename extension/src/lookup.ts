import type { Author, ReferenceDraft, ReferenceType } from "./types.js";
import { normDoi, splitName } from "./format.js";

export interface LookupResult {
  source: string;
  draft: ReferenceDraft;
}

interface CrossrefAuthor {
  family?: string;
  given?: string;
  name?: string;
}

interface CrossrefMessage {
  type?: string;
  title?: string[];
  "container-title"?: string[];
  author?: CrossrefAuthor[];
  editor?: CrossrefAuthor[];
  issued?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  created?: { "date-parts"?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  DOI?: string;
  URL?: string;
  edition?: string;
}

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_places?: Array<{ name?: string }>;
  publish_date?: string;
  url?: string;
}

function toAuthor(entry: CrossrefAuthor): Author {
  return {
    family: (entry.family ?? entry.name ?? "").trim(),
    given: (entry.given ?? "").trim(),
  };
}

function crossrefType(value: string | undefined): ReferenceType {
  switch (value) {
    case "book":
      return "book";
    case "book-chapter":
    case "book-section":
      return "chapter";
    case "journal-article":
    case "proceedings-article":
      return "journal";
    case "report":
    case "report-component":
      return "report";
    case "dissertation":
      return "thesis";
    case "newspaper-article":
      return "newspaper";
    default:
      return "other";
  }
}

export async function lookupDoi(raw: string): Promise<LookupResult> {
  const doi = normDoi(raw);
  if (!doi) throw new Error("Enter a DOI.");
  const res = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    { headers: { Accept: "application/json" } },
  );
  if (res.status === 404) throw new Error("No record found for that DOI.");
  if (!res.ok) throw new Error("Crossref lookup failed.");
  const payload = (await res.json()) as { message?: CrossrefMessage };
  const message = payload.message ?? {};
  const title = (message.title?.[0] ?? "").trim();
  if (!title) throw new Error("That DOI has no usable title.");

  let year = "";
  for (const candidate of [
    message["published-print"],
    message["published-online"],
    message.issued,
    message.created,
  ]) {
    const part = candidate?.["date-parts"]?.[0]?.[0];
    if (part) {
      year = String(part);
      break;
    }
  }

  return {
    source: "Crossref",
    draft: {
      type: crossrefType(message.type),
      title,
      authors: (message.author ?? []).map(toAuthor).filter((a) => a.family),
      editors: (message.editor ?? []).map(toAuthor).filter((a) => a.family),
      year,
      containerTitle: (message["container-title"]?.[0] ?? "").trim(),
      publisher: (message.publisher ?? "").trim(),
      place: "",
      edition: (message.edition ?? "").trim(),
      volume: (message.volume ?? "").trim(),
      issue: (message.issue ?? "").trim(),
      pages: (message.page ?? "").trim(),
      doi: normDoi(message.DOI ?? doi),
      url: (message.URL ?? "").trim(),
      accessedDate: null,
      publicationDate: "",
      notes: "",
      tags: [],
    },
  };
}

export async function lookupIsbn(raw: string): Promise<LookupResult> {
  const isbn = String(raw || "").replace(/[^0-9Xx]/g, "");
  if (isbn.length < 10) throw new Error("Enter a valid ISBN.");
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  );
  if (!res.ok) throw new Error("Open Library lookup failed.");
  const payload = (await res.json()) as Record<string, OpenLibraryBook>;
  const book = payload[`ISBN:${isbn}`];
  if (!book?.title) throw new Error("No record found for that ISBN.");

  return {
    source: "Open Library",
    draft: {
      type: "book",
      title: [book.title, book.subtitle].filter(Boolean).join(": "),
      authors: (book.authors ?? [])
        .map((author) => splitName(author.name ?? ""))
        .filter((author) => author.family),
      editors: [],
      year: (book.publish_date ?? "").match(/\d{4}/)?.[0] ?? "",
      containerTitle: "",
      publisher: (book.publishers?.[0]?.name ?? "").trim(),
      place: (book.publish_places?.[0]?.name ?? "").trim(),
      edition: "",
      volume: "",
      issue: "",
      pages: "",
      doi: "",
      url: (book.url ?? "").trim(),
      accessedDate: null,
      publicationDate: "",
      notes: "",
      tags: [],
    },
  };
}

export function looksLikeDoi(value: string): boolean {
  return /^10\.\d{4,9}\//i.test(value) || /doi\.org/i.test(value) || /^doi:/i.test(value);
}

export async function doLookup(value: string): Promise<LookupResult> {
  const text = String(value || "").trim();
  if (!text) throw new Error("Enter a DOI, ISBN or URL.");
  if (looksLikeDoi(text)) return lookupDoi(text);
  if (/^https?:\/\//i.test(text)) {
    let host = "";
    try {
      host = new URL(text).hostname;
    } catch {
    }
    return {
      source: "URL",
      draft: {
        type: "website",
        title: host || text,
        authors: [],
        editors: [],
        year: String(new Date().getFullYear()),
        containerTitle: host,
        publisher: host,
        place: "",
        edition: "",
        volume: "",
        issue: "",
        pages: "",
        doi: "",
        url: text,
        accessedDate: new Date().toISOString().slice(0, 10),
        publicationDate: "",
        notes: "",
        tags: [],
      },
    };
  }
  return lookupIsbn(text);
}

export interface PageMeta {
  title: string;
  description: string;
  author: string;
  site: string;
  published: string;
}

export function extractPageMeta(): PageMeta {
  const pick = (selector: string): string =>
    document.querySelector(selector)?.getAttribute("content") || "";
  return {
    title: document.title || "",
    description:
      pick('meta[property="og:description"]') ||
      pick('meta[name="description"]') ||
      "",
    author:
      pick('meta[name="author"]') ||
      pick('meta[property="article:author"]') ||
      "",
    site:
      pick('meta[property="og:site_name"]') || window.location.hostname,
    published: pick('meta[property="article:published_time"]') || "",
  };
}

export async function saveCurrentTab(): Promise<ReferenceDraft> {
  if (typeof chrome === "undefined" || !chrome.tabs) {
    throw new Error("Tabs API unavailable.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("No active tab.");
  if (!/^https?:/i.test(tab.url)) throw new Error("This page cannot be saved.");

  let meta: PageMeta = {
    title: tab.title || "",
    description: "",
    author: "",
    site: "",
    published: "",
  };
  try {
    if (chrome.scripting && tab.id != null) {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMeta,
      });
      if (injection?.result) meta = { ...meta, ...injection.result };
    }
  } catch {
  }

  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {
  }
  const year =
    meta.published.match(/(\d{4})/)?.[1] ?? String(new Date().getFullYear());

  return {
    type: "website",
    title: meta.title || host || tab.url,
    authors: meta.author ? [splitName(meta.author)] : [],
    editors: [],
    year,
    containerTitle: meta.site || host,
    publisher: meta.site || host,
    place: "",
    edition: "",
    volume: "",
    issue: "",
    pages: "",
    doi: "",
    url: tab.url,
    accessedDate: new Date().toISOString().slice(0, 10),
    publicationDate: (meta.published || "").slice(0, 10),
    notes: (meta.description || "").slice(0, 1000),
    tags: [],
  };
}
