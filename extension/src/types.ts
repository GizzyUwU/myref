export const referenceTypes = [
  "book",
  "chapter",
  "journal",
  "website",
  "report",
  "thesis",
  "newspaper",
  "film",
  "other",
] as const;

export type ReferenceType = (typeof referenceTypes)[number];

export const typeLabels: Record<ReferenceType, string> = {
  book: "Book",
  chapter: "Chapter",
  journal: "Journal",
  website: "Website",
  report: "Report",
  thesis: "Thesis",
  newspaper: "Newspaper",
  film: "Film",
  other: "Other",
};

export const themes = ["light", "dracula", "macchiato", "mocha"] as const;

export type Theme = (typeof themes)[number];

export function isTheme(value: string | null | undefined): value is Theme {
  return (
    value === "light" ||
    value === "dracula" ||
    value === "macchiato" ||
    value === "mocha"
  );
}

export interface Author {
  family: string;
  given?: string;
}

export interface ReferenceDraft {
  type: ReferenceType;
  title: string;
  authors: Author[];
  editors: Author[];
  year: string;
  containerTitle: string;
  publisher: string;
  place: string;
  edition: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  accessedDate: string | null;
  publicationDate: string;
  notes: string;
  tags: string[];
}

export interface Reference extends ReferenceDraft {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;

  serverId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;

  serverId: string | null;

  styleId: string;
  styleTitle: string;
}

export interface Settings {
  theme: Theme;
  serverUrl: string;

  token: string | null;
  tokenId: string | null;
  serverUser: string | null;
  lastSyncedAt: string | null;

  activeProjectId: string | null;
}

export function emptyDraft(type: ReferenceType = "book"): ReferenceDraft {
  return {
    type,
    title: "",
    authors: [{ family: "", given: "" }],
    editors: [],
    year: "",
    containerTitle: "",
    publisher: "",
    place: "",
    edition: "",
    volume: "",
    issue: "",
    pages: "",
    doi: "",
    url: "",
    accessedDate: null,
    publicationDate: "",
    notes: "",
    tags: [],
  };
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
