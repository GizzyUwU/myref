import CSL from "citeproc";
import { decode } from "he";
import type { Author, ReferenceRow } from "../db/schema";
import type { LoadedCslStyle } from "./csl-styles";

type CslName = {
  family: string;
  given?: string;
};

type CslDate = {
  "date-parts": number[][];
};

type CslItem = {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  accessed?: CslDate;
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

export type FormattedEntry = {
  id: string;
  type: ReferenceRow["type"];
  plain: string;
  html: string;
};

export type FormattedCitation = {
  id: string;
  inText: string;
};

export type FormattedBibliography = {
  style: string;
  styleId: string;
  styleSource: string;
  entries: FormattedEntry[];
  citations: FormattedCitation[];
};

const cslTypes: Record<ReferenceRow["type"], string> = {
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

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

function dateParts(value: string | null | undefined): number[][] | undefined {
  if (!value) return undefined;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return [[Number(iso[1]), Number(iso[2]), Number(iso[3])]];
  }

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

function toCslItem(row: ReferenceRow): CslItem {
  const item: CslItem = {
    id: row.id,
    type: cslTypes[row.type] ?? "article",
  };

  if (row.title.trim()) item.title = row.title.trim();

  const authors = cslNames(row.authors);
  if (authors.length) item.author = authors;

  const editors = cslNames(row.editors);
  if (editors.length) item.editor = editors;

  const issued = dateParts(row.year) ?? dateParts(row.publicationDate);
  if (issued) item.issued = { "date-parts": issued };

  if (row.containerTitle.trim()) {
    item["container-title"] = row.containerTitle.trim();
  }
  if (row.publisher.trim()) item.publisher = row.publisher.trim();
  if (row.place.trim()) item["publisher-place"] = row.place.trim();
  if (row.edition.trim()) item.edition = row.edition.trim();
  if (row.volume.trim()) item.volume = row.volume.trim();
  if (row.issue.trim()) item.issue = row.issue.trim();
  if (row.pages.trim()) item.page = row.pages.trim();

  const doi = normalizeDoi(row.doi);
  if (doi) item.DOI = doi;
  if (row.url.trim()) item.URL = row.url.trim();

  const accessed = dateParts(row.accessedDate);
  if (accessed) item.accessed = { "date-parts": accessed };

  if (row.type === "thesis") item.genre = "Thesis";

  return item;
}

const entryOpen = '<div class="csl-entry">';

function stripEntryWrapper(entry: string): string {
  let value = entry.trim();
  if (value.startsWith(entryOpen)) {
    value = value.slice(entryOpen.length);
  }
  if (value.endsWith("</div>")) {
    value = value.slice(0, -"</div>".length);
  }
  return value.trim();
}

export function htmlToPlain(html: string): string {
  return decode(
      html
        .replace(/<\/(?:div|p|li|h[1-6])>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, ""),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function formatBibliography(
  rows: ReferenceRow[],
  style: LoadedCslStyle,
): FormattedBibliography {
  if (rows.length === 0) {
    return {
      style: style.title,
      styleId: style.id,
      styleSource: style.sourceUrl,
      entries: [],
      citations: [],
    };
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: Record<string, CslItem> = {};
  for (const row of rows) items[row.id] = toCslItem(row);

  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang: string) =>
        style.locales[lang] ?? style.locales["en-US"] ?? "",
      retrieveItem: (id: string) => items[id]!,
    },
    style.xml,
  );

  engine.setOutputFormat("html");

  const ids = rows.map((row) => row.id);
  engine.updateItems(ids);

  const bibliography = engine.makeBibliography();
  if (!bibliography) {
    return {
      style: style.title,
      styleId: style.id,
      styleSource: style.sourceUrl,
      entries: [],
      citations: [],
    };
  }

  const [meta, rawEntries] = bibliography;

  const entries: FormattedEntry[] = meta.entry_ids
    .map((group, index) => {
      const id = group[0];
      if (!id) return null;

      const row = byId.get(id);
      if (!row) return null;

      const html = stripEntryWrapper(rawEntries[index] ?? "");
      const plain = htmlToPlain(html);

      return {
        id,
        type: row.type,
        plain,
        html,
      };
    })
    .filter((entry): entry is FormattedEntry => Boolean(entry?.plain));

  const citations: FormattedCitation[] = entries.map((entry) => ({
    id: entry.id,
    inText: htmlToPlain(engine.makeCitationCluster([{ id: entry.id }])),
  }));

  return {
    style: style.title,
    styleId: style.id,
    styleSource: style.sourceUrl,
    entries,
    citations,
  };
}

function sortKey(row: ReferenceRow): string {
  const firstAuthor = (row.authors ?? [])[0]?.family?.trim();
  return (firstAuthor || row.title).toLowerCase();
}

export function sortReferences(rows: ReferenceRow[]): ReferenceRow[] {
  return [...rows].sort((a, b) => {
    const byAuthor = sortKey(a).localeCompare(sortKey(b));
    if (byAuthor !== 0) return byAuthor;
    return a.year.localeCompare(b.year);
  });
}
