export type User = {
  id: string;
  email: string;
  username: string;
  createdAt: string;
};

export type Author = {
  family: string;
  given?: string;
};

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

export type Reference = {
  id: string;
  projectId: string;
  userId: string;
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
  createdAt: string;
  updatedAt: string;
};

export type ReferenceDraft = Omit<
  Reference,
  "id" | "projectId" | "userId" | "createdAt" | "updatedAt"
>;

export const bibFonts = [
  "Calibri, 'Calibri Light', Arial, sans-serif",
] as const;

export const defaultBibFont = "Calibri, 'Calibri Light', Arial, sans-serif";

export type Project = {
  id: string;
  name: string;
  description: string;
  styleId: string;
  styleTitle: string;
  styleSource: string;
  fontFamily: string;
  createdAt: string;
  updatedAt: string;
  referenceCount: number;
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

export type BibliographyEntry = {
  id: string;
  type: ReferenceType;
  plain: string;
  html: string;
};

export type Citation = {
  id: string;
  inText: string;
};

export type Bibliography = {
  style: string;
  styleId: string;
  styleSource: string;
  entries: BibliographyEntry[];
  citations: Citation[];
};

export const typeLabels: Record<ReferenceType, string> = {
  book: "Book",
  chapter: "Book chapter",
  journal: "Journal article",
  website: "Website",
  report: "Report",
  thesis: "Thesis",
  newspaper: "Newspaper",
  film: "Film",
  other: "Other",
};

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

export function toDraft(reference: Reference): ReferenceDraft {
  return {
    type: reference.type,
    title: reference.title,
    authors:
      reference.authors.length > 0
        ? reference.authors.map((author) => ({ ...author }))
        : [{ family: "", given: "" }],
    editors: reference.editors.map((editor) => ({ ...editor })),
    year: reference.year,
    containerTitle: reference.containerTitle,
    publisher: reference.publisher,
    place: reference.place,
    edition: reference.edition,
    volume: reference.volume,
    issue: reference.issue,
    pages: reference.pages,
    doi: reference.doi,
    url: reference.url,
    accessedDate: reference.accessedDate,
    publicationDate: reference.publicationDate,
    notes: reference.notes,
    tags: [...reference.tags],
  };
}
