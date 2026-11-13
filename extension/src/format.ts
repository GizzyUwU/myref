import type { Author, Reference } from "./types.js";

export type SortKey =
  | "added-new"
  | "added-old"
  | "author-az"
  | "pub-new"
  | "pub-old"
  | "title-az";

export interface FormattedEntry {
  id: string;
  plain: string;
  html: string;
  inText: string;
}

export function initials(given: string | undefined): string {
  return String(given ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + ".")
    .join(" ");
}

export function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isRiskyAttrValue(value: string): boolean {
  const cleaned = value
    .trim()
    .replace(/^[\u0000-\u0020]+/, "")
    .toLowerCase();
  return (
    cleaned.startsWith("javascript:") ||
    cleaned.startsWith("data:") ||
    cleaned.startsWith("vbscript:")
  );
}

export function sanitizeCslHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.body
    .querySelectorAll(
      "script,style,iframe,object,embed,form,link,meta,base,title",
    )
    .forEach((node) => node.remove());
  const nodes = parsed.body.querySelectorAll("*");
  nodes.forEach((node) => {
    const names: string[] = [];
    for (let i = 0; i < node.attributes.length; i += 1) {
      const attr = node.attributes[i];
      if (attr) names.push(attr.name);
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower === "style" || lower.startsWith("on")) {
        node.removeAttribute(name);
        continue;
      }
      if (
        [
          "href",
          "src",
          "action",
          "xlink:href",
          "poster",
          "background",
          "data",
        ].includes(lower)
      ) {
        const raw = node.getAttribute(name) ?? "";
        if (isRiskyAttrValue(raw)) node.removeAttribute(name);
      }
    }
  });
  return parsed.body.innerHTML;
}

export function fmtPerson(person: Author): string {
  const family = (person.family || "").trim();
  const given = initials(person.given);
  if (!family) return "";
  return given ? `${family}, ${given}` : family;
}

export function fmtPeople(list: Author[] | undefined): string {
  const names = (list ?? []).map(fmtPerson).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]} et al.`;
}

export function normDoi(doi: string | null | undefined): string {
  return String(doi ?? "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  const dt = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function splitName(name: string): Author {
  const value = String(name || "").trim();
  if (!value) return { family: "" };
  if (value.includes(",")) {
    const [family, ...rest] = value.split(",");
    return { family: family!.trim(), given: rest.join(",").trim() };
  }
  const parts = value.split(/\s+/);
  if (parts.length === 1) return { family: parts[0]! };
  return {
    family: parts[parts.length - 1]!,
    given: parts.slice(0, -1).join(" "),
  };
}

export function parsePeople(text: string): Author[] {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes(",")) {
        const [family, ...rest] = line.split(",");
        return { family: family!.trim(), given: rest.join(",").trim() };
      }
      return splitName(line);
    })
    .filter((person) => person.family);
}

export function peopleToText(list: Author[] | undefined): string {
  return (list ?? [])
    .map((person) => (person.given ? `${person.family}, ${person.given}` : person.family))
    .join("\n");
}

export function formatReference(ref: Reference): { plain: string; html: string } {
  const authors = fmtPeople(ref.authors);
  const year = (ref.year || "").trim() || "no date";
  const title = (ref.title || "").trim() || "Untitled";
  const container = (ref.containerTitle || "").trim();
  const publisher = (ref.publisher || "").trim();
  const place = (ref.place || "").trim();
  const edition = (ref.edition || "").trim();
  const vol = (ref.volume || "").trim();
  const issue = (ref.issue || "").trim();
  const pages = (ref.pages || "").trim();
  const doi = normDoi(ref.doi);
  const url = (ref.url || "").trim();
  const accessed = ref.accessedDate ? fmtDate(ref.accessedDate) : "";
  const pubDate = (ref.publicationDate || "").trim();

  let plain = `${authors ? authors + " " : ""}(${year}) ${title}.`;
  let html = `${authors ? esc(authors) + " " : ""}(${esc(year)}) <i>${esc(title)}</i>.`;
  if (container) {
    plain += ` ${container}.`;
    html += ` <i>${esc(container)}</i>.`;
  }
  let volIssue = vol;
  if (vol && issue) volIssue += `(${issue})`;
  else if (issue) volIssue = `(${issue})`;
  if (volIssue) {
    plain += ` ${volIssue}.`;
    html += ` ${esc(volIssue)}.`;
  }
  if (pages) {
    const pp = /^[\d–-]+$/.test(pages.replace(/\s/g, "")) ? `pp. ${pages}` : pages;
    plain += ` ${pp}.`;
    html += ` ${esc(pp)}.`;
  }
  if (edition) {
    plain += ` ${edition} edn.`;
    html += ` ${esc(edition)} edn.`;
  }
  if (publisher || place) {
    plain += ` ${[place, publisher].filter(Boolean).join(": ")}.`;
    html += ` ${esc([place, publisher].filter(Boolean).join(": "))}.`;
  }
  if (doi) {
    plain += ` doi:${doi}.`;
    html += ` doi:${esc(doi)}.`;
  }
  if (url) {
    plain += ` Available at: ${url}${accessed ? ` (Accessed: ${accessed})` : ""}.`;
    const linkBody = `${esc(url)}${accessed ? ` (Accessed: ${esc(accessed)})` : ""}.`;
    if (isHttpUrl(url)) {
      html += ` Available at: <a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>${accessed ? ` (Accessed: ${esc(accessed)})` : ""}.`;
    } else {
      html += ` Available at: ${linkBody}`;
    }
  } else if (accessed && ref.type === "website") {
    plain += ` (Accessed: ${accessed}).`;
    html += ` (Accessed: ${esc(accessed)}).`;
  }
  if (pubDate && ref.type === "newspaper") {
    plain += ` Published ${pubDate}.`;
    html += ` Published ${esc(pubDate)}.`;
  }
  return { plain, html };
}

export function inText(ref: Reference): string {
  const families = (ref.authors ?? [])
    .map((author) => (author.family || "").trim())
    .filter(Boolean);
  const year = (ref.year || "").trim() || "n.d.";
  let who = "Anon";
  if (families.length === 1) who = families[0]!;
  else if (families.length === 2) who = `${families[0]} and ${families[1]}`;
  else if (families.length > 2) who = `${families[0]} et al.`;
  return `(${who}, ${year})`;
}

export function sortRefs(list: Reference[], key: SortKey): Reference[] {
  const arr = [...list];
  const pubTime = (ref: Reference): number => {
    const match = (ref.year || "").match(/(\d{4})/);
    return match ? Date.UTC(Number(match[1]), 0, 1) : -1;
  };
  const added = (ref: Reference): number => Date.parse(ref.createdAt || "") || 0;
  const firstFamily = (ref: Reference): string =>
    (ref.authors?.[0]?.family || ref.title || "").toLowerCase();
  switch (key) {
    case "added-old":
      arr.sort((a, b) => added(a) - added(b));
      break;
    case "author-az":
      arr.sort(
        (a, b) =>
          firstFamily(a).localeCompare(firstFamily(b)) || pubTime(b) - pubTime(a),
      );
      break;
    case "pub-new":
      arr.sort((a, b) => pubTime(b) - pubTime(a));
      break;
    case "pub-old":
      arr.sort((a, b) => pubTime(a) - pubTime(b));
      break;
    case "title-az":
      arr.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        }),
      );
      break;
    case "added-new":
    default:
      arr.sort((a, b) => added(b) - added(a));
  }
  return arr;
}

export function formatEntries(refs: Reference[]): FormattedEntry[] {
  return sortRefs(refs, "author-az").map((ref) => ({
    id: ref.id,
    ...formatReference(ref),
    inText: inText(ref),
  }));
}
