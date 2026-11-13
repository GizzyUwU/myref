import type { ReferenceRow } from "../db/schema";

export type CslName = {
  family: string;
  given?: string;
};

export type CslDate = {
  "date-parts": number[][];
};

export type CslItem = {
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
