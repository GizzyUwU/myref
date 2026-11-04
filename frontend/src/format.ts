import type { Reference } from "./types";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function referenceMeta(reference: Reference): string {
  const names = reference.authors
    .map((author) => author.family.trim())
    .filter(Boolean);

  let authorLabel = "";
  if (names.length === 1) authorLabel = names[0]!;
  else if (names.length === 2) authorLabel = `${names[0]} and ${names[1]}`;
  else if (names.length === 3) {
    authorLabel = `${names[0]}, ${names[1]} and ${names[2]}`;
  } else if (names.length > 3) authorLabel = `${names[0]} et al.`;

  const parts = [authorLabel, reference.year || "no date"].filter(Boolean);
  if (reference.containerTitle.trim()) {
    parts.push(reference.containerTitle.trim());
  }

  return parts.join(" · ");
}

export function downloadUrl(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
