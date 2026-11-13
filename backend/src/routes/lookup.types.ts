export type CrossrefPerson = {
  family?: string;
  given?: string;
  name?: string;
};

export type CrossrefMessage = {
  type?: string;
  title?: string[];
  "container-title"?: string[];
  author?: CrossrefPerson[];
  editor?: CrossrefPerson[];
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
  ISBN?: string[];
};

export type CrossrefResponse = {
  message?: CrossrefMessage;
};

export type OpenLibraryBook = {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_places?: Array<{ name?: string }>;
  publish_date?: string;
  url?: string;
};

export type OpenLibraryResponse = Record<string, OpenLibraryBook>;
