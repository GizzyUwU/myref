import type { Author, ReferenceRow } from "../db/schema";
import { normalizeDoi } from "./format";

function risDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10).replace(/-/g, "/") + "/";
}

function risAuthors(authors: Author[]): string[] {
  return authors
    .map((author) => {
      const family = (author.family ?? "").trim();
      const given = (author.given ?? "").trim();
      if (!family) return "";
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
}

function splitPages(pages: string): [string, string] | null {
  const match = pages.trim().match(/^(.+?)\s*[–-]\s*(.+)$/);
  if (!match) return null;
  return [match[1]!.trim(), match[2]!.trim()];
}

export function toRis(rows: ReferenceRow[]): string {
  const typeMap: Record<ReferenceRow["type"], string> = {
    book: "BOOK",
    chapter: "CHAP",
    journal: "JOUR",
    website: "ELEC",
    report: "RPRT",
    thesis: "THES",
    newspaper: "NEWS",
    film: "MPCT",
    other: "GEN",
  };

  const output: string[] = [];

  for (const row of rows) {
    output.push(`TY  - ${typeMap[row.type]}`);
    for (const author of risAuthors(row.authors)) {
      output.push(`AU  - ${author}`);
    }
    for (const editor of risAuthors(row.editors)) {
      output.push(`ED  - ${editor}`);
    }
    if (row.title.trim()) output.push(`TI  - ${row.title.trim()}`);
    if (row.containerTitle.trim()) {
      output.push(`T2  - ${row.containerTitle.trim()}`);
    }
    if (row.year.trim()) output.push(`PY  - ${row.year.trim()}`);
    if (row.publicationDate.trim()) {
      output.push(`DA  - ${row.publicationDate.trim()}`);
    }
    if (row.publisher.trim()) output.push(`PB  - ${row.publisher.trim()}`);
    if (row.place.trim()) output.push(`CY  - ${row.place.trim()}`);
    if (row.edition.trim()) output.push(`ET  - ${row.edition.trim()}`);
    if (row.volume.trim()) output.push(`VL  - ${row.volume.trim()}`);
    if (row.issue.trim()) output.push(`IS  - ${row.issue.trim()}`);
    if (row.pages.trim()) {
      const split = splitPages(row.pages);
      if (split) {
        output.push(`SP  - ${split[0]}`);
        output.push(`EP  - ${split[1]}`);
      } else {
        output.push(`SP  - ${row.pages.trim()}`);
      }
    }
    const doi = normalizeDoi(row.doi);
    if (doi) output.push(`DO  - ${doi}`);
    if (row.url.trim()) output.push(`UR  - ${row.url.trim()}`);
    if (row.accessedDate) output.push(`Y2  - ${risDate(row.accessedDate)}`);
    if (row.notes.trim()) output.push(`N1  - ${row.notes.trim()}`);
    for (const tag of row.tags ?? []) {
      if (tag.trim()) output.push(`KW  - ${tag.trim()}`);
    }
    output.push("ER  -", "");
  }

  return output.join("\n").trimEnd() + "\n";
}

function bibEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function bibKey(row: ReferenceRow, used: Set<string>): string {
  const family = (row.authors ?? [])[0]?.family ?? "ref";
  const titleWord = row.title
    .trim()
    .split(/\s+/)
    .find((word) => word.length > 3);
  const base = `${family}${row.year || "nd"}${titleWord ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  let key = base || "ref";
  let index = 2;
  while (used.has(key)) {
    key = `${base}${index}`;
    index += 1;
  }
  used.add(key);
  return key;
}

function bibAuthors(authors: Author[]): string {
  return authors
    .map((author) => {
      const family = (author.family ?? "").trim();
      const given = (author.given ?? "").trim();
      if (!family) return "";
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean)
    .join(" and ");
}

export function toBibtex(rows: ReferenceRow[]): string {
  const typeMap: Record<ReferenceRow["type"], string> = {
    book: "book",
    chapter: "incollection",
    journal: "article",
    website: "misc",
    report: "techreport",
    thesis: "phdthesis",
    newspaper: "article",
    film: "misc",
    other: "misc",
  };

  const used = new Set<string>();
  const entries: string[] = [];

  for (const row of rows) {
    const fields: Array<[string, string]> = [];

    const authors = bibAuthors(row.authors);
    if (authors) fields.push(["author", authors]);

    const editors = bibAuthors(row.editors);
    if (editors) fields.push(["editor", editors]);

    if (row.title.trim()) fields.push(["title", row.title.trim()]);
    if (row.year.trim()) fields.push(["year", row.year.trim()]);

    switch (row.type) {
      case "book":
        if (row.publisher.trim()) fields.push(["publisher", row.publisher.trim()]);
        if (row.place.trim()) fields.push(["address", row.place.trim()]);
        if (row.edition.trim()) fields.push(["edition", row.edition.trim()]);
        break;
      case "chapter":
        if (row.containerTitle.trim()) {
          fields.push(["booktitle", row.containerTitle.trim()]);
        }
        if (row.publisher.trim()) fields.push(["publisher", row.publisher.trim()]);
        if (row.place.trim()) fields.push(["address", row.place.trim()]);
        if (row.pages.trim()) fields.push(["pages", row.pages.trim()]);
        if (row.edition.trim()) fields.push(["edition", row.edition.trim()]);
        break;
      case "journal":
      case "newspaper":
        if (row.containerTitle.trim()) {
          fields.push(["journal", row.containerTitle.trim()]);
        }
        if (row.volume.trim()) fields.push(["volume", row.volume.trim()]);
        if (row.issue.trim()) fields.push(["number", row.issue.trim()]);
        if (row.pages.trim()) fields.push(["pages", row.pages.trim()]);
        break;
      case "thesis":
        if (row.publisher.trim()) fields.push(["school", row.publisher.trim()]);
        if (row.place.trim()) fields.push(["address", row.place.trim()]);
        fields.push(["type", "Thesis"]);
        break;
      case "report":
        if (row.publisher.trim()) {
          fields.push(["institution", row.publisher.trim()]);
        }
        if (row.place.trim()) fields.push(["address", row.place.trim()]);
        break;
      default:
        if (row.publisher.trim()) fields.push(["publisher", row.publisher.trim()]);
        if (row.place.trim()) fields.push(["address", row.place.trim()]);
    }

    const doi = normalizeDoi(row.doi);
    if (doi) fields.push(["doi", doi]);
    if (row.url.trim()) fields.push(["url", row.url.trim()]);
    if (row.accessedDate) {
      fields.push(["urldate", row.accessedDate.slice(0, 10)]);
    }
    if (row.notes.trim()) fields.push(["note", row.notes.trim()]);

    const body = fields
      .map(([key, value]) => `  ${key} = {${bibEscape(value)}}`)
      .join(",\n");

    entries.push(
      `@${typeMap[row.type]}{${bibKey(row, used)},\n${body}\n}`,
    );
  }

  return entries.join("\n\n") + "\n";
}
