import { Elysia, t } from "elysia";
import type { Author, ReferenceType } from "../db/schema";
import { normalizeDoi } from "../lib/format";
import { badRequest, HttpError, notFound } from "../lib/http";
import { requireUser } from "../lib/session";

type CrossrefMessage = {
  type?: string;
  title?: string[];
  "container-title"?: string[];
  author?: Array<{ family?: string; given?: string; name?: string }>;
  editor?: Array<{ family?: string; given?: string; name?: string }>;
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

function toAuthor(entry: {
  family?: string;
  given?: string;
  name?: string;
}): Author {
  const family = (entry.family ?? entry.name ?? "").trim();
  return { family, given: (entry.given ?? "").trim() };
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
    case "posted-content":
    case "reference-entry":
    case "dataset":
      return "website";
    case "newspaper-article":
      return "newspaper";
    default:
      return "other";
  }
}

function yearFromDates(message: CrossrefMessage): string {
  const candidates = [
    message["published-print"],
    message["published-online"],
    message.issued,
    message.created,
  ];

  for (const candidate of candidates) {
    const year = candidate?.["date-parts"]?.[0]?.[0];
    if (year) return String(year);
  }

  return "";
}

function dateFromParts(message: CrossrefMessage): string {
  const parts =
    message["published-print"]?.["date-parts"]?.[0] ??
    message.issued?.["date-parts"]?.[0] ??
    message.created?.["date-parts"]?.[0];

  if (!parts || !parts[0]) return "";
  const [year, month, day] = parts;
  if (!month) return String(year);
  const date = new Date(Date.UTC(year, month - 1, day ?? 1));
  if (!day)
    return date.toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function splitName(name: string): Author {
  const value = name.trim();
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

export const lookupRoutes = new Elysia({ prefix: "/lookup" })
  .get(
    "/doi",
    async ({ query, cookie }) => {
      await requireUser(cookie);

      const doi = normalizeDoi(query.doi ?? "");
      if (!doi) badRequest("Enter a DOI.");

      const response = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "MyRef/1.0 (referencing app)",
          },
          signal: AbortSignal.timeout(12000),
        },
      ).catch(() => {
        throw new HttpError(502, "Could not reach Crossref. Try again.");
      });

      if (response.status === 404) notFound("No record found for that DOI.");
      if (!response.ok) {
        throw new HttpError(502, "Crossref could not look up that DOI.");
      }

      const payload = (await response.json()) as {
        message?: CrossrefMessage;
      };
      const message = payload.message;
      if (!message) notFound("No record found for that DOI.");

      const type = crossrefType(message.type);
      const title = (message.title?.[0] ?? "").trim();
      if (!title) notFound("That DOI has no usable title.");

      const authors = (message.author ?? [])
        .map(toAuthor)
        .filter((author) => author.family);
      const editors = (message.editor ?? [])
        .map(toAuthor)
        .filter((author) => author.family);

      return {
        source: "Crossref",
        reference: {
          type,
          title,
          authors,
          editors,
          year: yearFromDates(message),
          containerTitle: (message["container-title"]?.[0] ?? "").trim(),
          publisher: (message.publisher ?? "").trim(),
          place: "",
          edition: (message.edition ?? "").trim(),
          volume: (message.volume ?? "").trim(),
          issue: (message.issue ?? "").trim(),
          pages: (message.page ?? "").trim(),
          doi: normalizeDoi(message.DOI ?? doi),
          url: (message.URL ?? "").trim(),
          accessedDate: type === "website" ? new Date().toISOString().slice(0, 10) : null,
          publicationDate: type === "newspaper" ? dateFromParts(message) : "",
          notes: "",
          tags: [],
        },
      };
    },
    {
      query: t.Object({
        doi: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
  .get(
    "/isbn",
    async ({ query, cookie }) => {
      await requireUser(cookie);

      const isbn = (query.isbn ?? "").replace(/[^0-9Xx]/g, "");
      if (isbn.length < 10) badRequest("Enter a valid ISBN.");

      const response = await fetch(
        `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "MyRef/1.0 (referencing app)",
          },
          signal: AbortSignal.timeout(12000),
        },
      ).catch(() => {
        throw new HttpError(502, "Could not reach Open Library. Try again.");
      });

      if (!response.ok) {
        throw new HttpError(502, "Open Library could not look up that ISBN.");
      }

      const payload = (await response.json()) as Record<
        string,
        {
          title?: string;
          subtitle?: string;
          authors?: Array<{ name?: string }>;
          publishers?: Array<{ name?: string }>;
          publish_places?: Array<{ name?: string }>;
          publish_date?: string;
          url?: string;
        }
      >;

      const book = payload[`ISBN:${isbn}`];
      if (!book?.title) notFound("No record found for that ISBN.");

      const year = (book.publish_date ?? "").match(/\d{4}/)?.[0] ?? "";
      const authors = (book.authors ?? [])
        .map((author) => splitName(author.name ?? ""))
        .filter((author) => author.family);

      return {
        source: "Open Library",
        reference: {
          type: "book" as const,
          title: [book.title, book.subtitle].filter(Boolean).join(": "),
          authors,
          editors: [],
          year,
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
    },
    {
      query: t.Object({
        isbn: t.Optional(t.String({ maxLength: 30 })),
      }),
    },
  )
  .get(
    "/url",
    async ({ query, cookie }) => {
      await requireUser(cookie);

      const url = (query.url ?? "").trim();
      if (!url) badRequest("Enter a URL.");

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        badRequest("Enter a valid URL.");
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        badRequest("Enter a valid URL.");
      }

      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "MyRef/1.0 (referencing app)",
        },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      }).catch(() => {
        throw new HttpError(502, "Could not reach that URL. Try again.");
      });

      if (!response.ok) {
        throw new HttpError(502, "Could not fetch metadata from that URL.");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        throw new HttpError(422, "That URL does not appear to be an HTML page.");
      }

      const html = await response.text();

      const getMeta = (name: string) => {
        const escaped = name.replace(/\./g, "\\.");
        const patterns = [
          new RegExp(`<meta[^>]+property=["']` + escaped + `["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']` + escaped + `["'][^>]*>`, "i"),
          new RegExp(`<meta[^>]+name=["']` + escaped + `["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']` + escaped + `["'][^>]*>`, "i"),
          new RegExp(`<meta[^>]+itemprop=["']` + escaped + `["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']` + escaped + `["'][^>]*>`, "i"),
        ];
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match?.[1]) {
            return match[1]
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .trim();
          }
        }
        return "";
      };

      const getTitle = () => {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch?.[1]) {
          return titleMatch[1]
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        }
        return getMeta("og:title") || getMeta("twitter:title");
      };

      const title = getTitle();
      if (!title) notFound("No metadata found for that URL.");

      const description =
        getMeta("og:description") ||
        getMeta("description") ||
        getMeta("twitter:description") ||
        getMeta("dc.description");

      const siteName =
        getMeta("og:site_name") ||
        getMeta("application-name") ||
        getMeta("twitter:site") ||
        parsed.hostname;

      const published =
        getMeta("article:published_time") ||
        getMeta("article:published") ||
        getMeta("published_time") ||
        getMeta("datePublished") ||
        getMeta("date") ||
        getMeta("og:published_time") ||
        getMeta("DC.date.issued");

      const author =
        getMeta("article:author") ||
        getMeta("author") ||
        getMeta("og:author") ||
        getMeta("twitter:creator") ||
        getMeta("dc.creator");

      let year = "";
      if (published) {
        const yearMatch = published.match(/(\d{4})/);
        if (yearMatch) year = yearMatch[1];
      }

      const authors = author
        ? author
            .split(/[,;]+/)
            .map((a) => splitName(a))
            .filter((a) => a.family)
        : [];

      const publishedDate = published ? published.replace(/T.*$/, "") : "";

      return {
        source: "URL metadata",
        reference: {
          type: "website" as const,
          title,
          authors,
          editors: [],
          year,
          containerTitle: siteName || parsed.hostname,
          publisher: siteName || parsed.hostname,
          place: "",
          edition: "",
          volume: "",
          issue: "",
          pages: "",
          doi: "",
          url,
          accessedDate: new Date().toISOString().slice(0, 10),
          publicationDate: publishedDate,
          notes: description ? description.slice(0, 1000) : "",
          tags: [],
        },
      };
    },
    {
      query: t.Object({
        url: t.Optional(t.String({ maxLength: 2000 })),
      }),
    },
  );
