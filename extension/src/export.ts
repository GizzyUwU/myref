import type { Author, Reference } from "./types.js";
import { normDoi } from "./format.js";

function risAuthors(list: Author[] | undefined): string[] {
  return (list ?? [])
    .map((author) => {
      const family = (author.family || "").trim();
      const given = (author.given || "").trim();
      if (!family) return "";
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
}

export function toRis(rows: Reference[]): string {
  const typeMap: Record<Reference["type"], string> = {
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

  const out: string[] = [];
  for (const row of rows) {
    out.push(`TY  - ${typeMap[row.type] ?? "GEN"}`);
    for (const author of risAuthors(row.authors)) out.push(`AU  - ${author}`);
    for (const editor of risAuthors(row.editors)) out.push(`ED  - ${editor}`);
    if ((row.title || "").trim()) out.push(`TI  - ${row.title.trim()}`);
    if ((row.containerTitle || "").trim()) {
      out.push(`T2  - ${row.containerTitle.trim()}`);
    }
    if ((row.year || "").trim()) out.push(`PY  - ${row.year.trim()}`);
    if ((row.publisher || "").trim()) out.push(`PB  - ${row.publisher.trim()}`);
    if ((row.place || "").trim()) out.push(`CY  - ${row.place.trim()}`);
    if ((row.edition || "").trim()) out.push(`ET  - ${row.edition.trim()}`);
    if ((row.volume || "").trim()) out.push(`VL  - ${row.volume.trim()}`);
    if ((row.issue || "").trim()) out.push(`IS  - ${row.issue.trim()}`);
    const pages = (row.pages || "").trim();
    if (pages) {
      const match = pages.match(/^(.+?)\s*[–-]\s*(.+)$/);
      if (match) {
        out.push(`SP  - ${match[1]!.trim()}`);
        out.push(`EP  - ${match[2]!.trim()}`);
      } else {
        out.push(`SP  - ${pages}`);
      }
    }
    const doi = normDoi(row.doi);
    if (doi) out.push(`DO  - ${doi}`);
    if ((row.url || "").trim()) out.push(`UR  - ${row.url.trim()}`);
    if (row.accessedDate) {
      out.push(`Y2  - ${String(row.accessedDate).slice(0, 10).replace(/-/g, "/")}/`);
    }
    if ((row.notes || "").trim()) out.push(`N1  - ${row.notes.trim()}`);
    for (const tag of row.tags ?? []) {
      if ((tag || "").trim()) out.push(`KW  - ${tag.trim()}`);
    }
    out.push("ER  -", "");
  }

  return out.join("\n").trimEnd() + "\n";
}

function bibEscape(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function toBibtex(rows: Reference[]): string {
  const typeMap: Record<Reference["type"], string> = {
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
    const family = row.authors?.[0]?.family ?? "ref";
    const word =
      (row.title || "").trim().split(/\s+/).find((w) => w.length > 3) ?? "";
    let base =
      `${family}${row.year || "nd"}${word}`
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "ref";
    let key = base;
    let index = 2;
    while (used.has(key)) {
      key = `${base}${index}`;
      index += 1;
    }
    used.add(key);

    const authorStr = risAuthors(row.authors).join(" and ");
    const editorStr = risAuthors(row.editors).join(" and ");
    const fields: Array<[string, string]> = [];
    if (authorStr) fields.push(["author", authorStr]);
    if (editorStr) fields.push(["editor", editorStr]);
    if ((row.title || "").trim()) fields.push(["title", row.title.trim()]);
    if ((row.year || "").trim()) fields.push(["year", row.year.trim()]);
    if ((row.containerTitle || "").trim()) {
      const fieldName =
        row.type === "chapter"
          ? "booktitle"
          : row.type === "journal" || row.type === "newspaper"
            ? "journal"
            : "howpublished";
      fields.push([fieldName, row.containerTitle.trim()]);
    }
    if ((row.publisher || "").trim()) {
      fields.push([
        row.type === "thesis"
          ? "school"
          : row.type === "report"
            ? "institution"
            : "publisher",
        row.publisher.trim(),
      ]);
    }
    if ((row.place || "").trim()) fields.push(["address", row.place.trim()]);
    if ((row.edition || "").trim()) fields.push(["edition", row.edition.trim()]);
    if ((row.volume || "").trim()) fields.push(["volume", row.volume.trim()]);
    if ((row.issue || "").trim()) fields.push(["number", row.issue.trim()]);
    if ((row.pages || "").trim()) fields.push(["pages", row.pages.trim()]);
    const doi = normDoi(row.doi);
    if (doi) fields.push(["doi", doi]);
    if ((row.url || "").trim()) fields.push(["url", row.url.trim()]);
    if (row.accessedDate) {
      fields.push(["urldate", String(row.accessedDate).slice(0, 10)]);
    }
    if ((row.notes || "").trim()) fields.push(["note", row.notes.trim()]);

    entries.push(
      `@${typeMap[row.type] ?? "misc"}{${key},\n${fields
        .map(([name, value]) => `  ${name} = {${bibEscape(value)}}`)
        .join(",\n")}\n}`,
    );
  }

  return entries.join("\n\n") + "\n";
}

export function download(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
