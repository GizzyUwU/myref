import { Elysia, t } from "elysia";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Author, ReferenceType } from "../db/schema";
import { env } from "../env";
import { normalizeDoi } from "../lib/format";
import { badRequest, HttpError, notFound } from "../lib/http";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import { requireUser } from "../lib/session";
import { errorResponse, lookupResultSchema } from "../lib/api-schemas";
import type {
  CrossrefMessage,
  CrossrefPerson,
  CrossrefResponse,
  OpenLibraryResponse,
} from "./lookup.types";

function toAuthor(entry: CrossrefPerson): Author {
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

function isBlockedIPv4(octets: [number, number, number, number]): boolean {
  const [a, b, c, d] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224 && a <= 239) return true;
  if (a >= 240) return true;
  void d;
  return false;
}

function parseIPv4Bytes(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let value: number;
    if (/^0x[0-9a-fA-F]+$/.test(part)) {
      value = parseInt(part, 16);
    } else if (/^0[0-9]+$/.test(part)) {
      if (!/^[0-7]+$/.test(part.slice(1))) return null;
      value = parseInt(part, 8);
    } else if (/^[0-9]+$/.test(part)) {
      value = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets as [number, number, number, number];
}

export function normalizeObscuredIPv4(host: string): string | null {
  const h = host.trim();
  if (!h || h.includes(":") || /[^0-9a-fA-FxX.]/.test(h)) return null;
  const tryInt = (s: string): number | null => {
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^0[0-9]+$/.test(s)) {
      if (!/^[0-7]+$/.test(s.slice(1))) return null;
      return parseInt(s, 8);
    }
    if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
    return null;
  };
  if (!h.includes(".")) {
    const n = tryInt(h);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
  }
  const parts = h.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = tryInt(p);
    if (n === null || n < 0) return null;
    nums.push(n);
  }
  let n32: number;
  if (nums.length === 2) {
    if (nums[0]! > 255 || nums[1]! > 0xffffff) return null;
    n32 = (nums[0]! << 24) + nums[1]!;
  } else if (nums.length === 3) {
    if (nums[0]! > 255 || nums[1]! > 255 || nums[2]! > 0xffff) return null;
    n32 = (nums[0]! << 24) + (nums[1]! << 16) + nums[2]!;
  } else {
    for (const n of nums) if (n > 255) return null;
    n32 = ((nums[0]! << 24) >>> 0) + (nums[1]! << 16) + (nums[2]! << 8) + nums[3]!;
  }
  n32 >>>= 0;
  return `${(n32 >>> 24) & 0xff}.${(n32 >>> 16) & 0xff}.${(n32 >>> 8) & 0xff}.${n32 & 0xff}`;
}

function parseIPv6Bytes(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const v4Tail = addr.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const bytes = parseIPv4Bytes(v4Tail[1]!);
    if (!bytes) return null;
    addr = addr.slice(0, addr.length - v4Tail[1]!.length) + "0:0";
  }
  if ((addr.match(/::/g) ?? []).length > 1) return null;
  const halves = addr.split("::");
  const head = halves[0] ? halves[0]!.split(":") : [];
  const tail = halves.length > 1 && halves[1] ? halves[1]!.split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const parseGroup = (g: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    return parseInt(g, 16);
  };
  const headVals: number[] = [];
  const tailVals: number[] = [];
  for (const g of head) {
    const v = parseGroup(g);
    if (v === null) return null;
    headVals.push(v);
  }
  for (const g of tail) {
    const v = parseGroup(g);
    if (v === null) return null;
    tailVals.push(v);
  }
  let groups: number[];
  if (halves.length === 1) {
    if (headVals.length !== 8) return null;
    groups = headVals;
  } else {
    if (headVals.length + tailVals.length > 7) return null;
    const zeros: number[] = new Array(8 - headVals.length - tailVals.length).fill(0);
    groups = [...headVals, ...zeros, ...tailVals];
  }
  if (v4Tail) {
    const bytes = parseIPv4Bytes(v4Tail[1]!)!;
    groups[6] = bytes[0] * 256 + bytes[1];
    groups[7] = bytes[2] * 256 + bytes[3];
  }
  const out: number[] = [];
  for (const g of groups) {
    out.push((g >> 8) & 0xff, g & 0xff);
  }
  return out;
}

export function isBlockedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const bytes = parseIPv4Bytes(ip);
    if (!bytes) return true;
    return isBlockedIPv4(bytes);
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mappedV4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedV4) {
      const bytes = parseIPv4Bytes(mappedV4[1]!);
      if (!bytes) return true;
      return isBlockedIPv4(bytes);
    }
    const bytes = parseIPv6Bytes(lower);
    if (!bytes) return true;
    if (bytes.every((b) => b === 0)) return true;
    if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
    if ((bytes[0] & 0xfe) === 0xfc) return true;
    if (bytes[0] === 0xff) return true;
    if (
      bytes.slice(0, 10).every((b) => b === 0) &&
      bytes[10] === 0xff &&
      bytes[11] === 0xff
    ) {
      const inner: [number, number, number, number] = [
        bytes[12]!,
        bytes[13]!,
        bytes[14]!,
        bytes[15]!,
      ];
      return isBlockedIPv4(inner);
    }
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
      return true;
    if (
      bytes[0] === 0x00 &&
      bytes[1] === 0x64 &&
      bytes[2] === 0xff &&
      bytes[3] === 0x9b
    )
      return true;
    if (bytes[0] === 0x01 && bytes[1] === 0x00) return true;
    return false;
  }
  return true;
}

export async function assertHostnameIsPublic(hostname: string): Promise<void> {
  let host = hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) badRequest("Enter a valid URL.");

  if (isIP(host)) {
    if (isBlockedIP(host)) badRequest("That URL is not allowed.");
    return;
  }
  const deobfuscated = normalizeObscuredIPv4(host);
  if (deobfuscated) {
    if (isBlockedIP(deobfuscated)) badRequest("That URL is not allowed.");
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dnsLookup(host, { all: true });
  } catch {
    throw new HttpError(502, "Could not reach that URL. Try again.");
  }
  if (!records.length) {
    throw new HttpError(502, "Could not reach that URL. Try again.");
  }
  for (const record of records) {
    if (isBlockedIP(record.address)) badRequest("That URL is not allowed.");
  }
}

export function assertUrlShapeIsAllowed(parsed: URL): void {
  if (parsed.username || parsed.password) badRequest("That URL is not allowed.");
  const effectivePort = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "http:"
      ? 80
      : 443;
  if (effectivePort !== 80 && effectivePort !== 443) {
    badRequest("That URL is not allowed.");
  }
}

function lookupLimit(
  request: Request,
  server: unknown,
): { retryAfter: number } | null {
  const limit = checkRateLimit(
    `lookup:${clientIp(request, server, env.trustProxy)}`,
    30,
    60_000,
  );
  return limit.allowed ? null : { retryAfter: limit.retryAfter };
}

export async function readCappedText(
  response: Response,
  maxBytes = 2_000_000,
): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(413, "That response is too large to process.");
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "That response is too large to process.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((merged, chunk) => {
      const next = new Uint8Array(merged.length + chunk.length);
      next.set(merged);
      next.set(chunk, merged.length);
      return next;
    }, new Uint8Array()),
  );
}

function parseJsonPayload<T>(text: string, source: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, `${source} returned an unreadable response.`);
  }
}

export async function fetchUrlWithSsrfChecks(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= 5; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      badRequest("Enter a valid URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      badRequest("Enter a valid URL.");
    }
    assertUrlShapeIsAllowed(parsed);
    await assertHostnameIsPublic(parsed.hostname);

    const response = await fetch(current, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MyRef/1.0 (referencing app)",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    }).catch(() => {
      throw new HttpError(502, "Could not reach that URL. Try again.");
    });

    await assertHostnameIsPublic(parsed.hostname).catch(async (error: unknown) => {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.arrayBuffer().catch(() => undefined);
      if (!location) {
        throw new HttpError(502, "Could not fetch metadata from that URL.");
      }
      if (hop === 5) {
        throw new HttpError(502, "Too many redirects.");
      }
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new HttpError(502, "Too many redirects.");
}

export const lookupRoutes = new Elysia({ prefix: "/lookup" })
  .get(
    "/doi",
    async ({ query, cookie, request, server, set }) => {
      const limited = lookupLimit(request, server);
      if (limited) {
        set.status = 429;
        set.headers["retry-after"] = String(limited.retryAfter);
        return { error: "Too many lookups. Try again later." };
      }

      await requireUser(cookie, request.headers.get("authorization"));

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

      const payload = parseJsonPayload<CrossrefResponse>(
        await readCappedText(response),
        "Crossref",
      );
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
      detail: {
        summary: "Lookup by DOI",
        description: "Crossref metadata prefilled as a reference draft.",
        tags: ["lookup"],
      },
      response: {
        200: lookupResultSchema,
        429: errorResponse,
      },
    },
  )
  .get(
    "/isbn",
    async ({ query, cookie, request, server, set }) => {
      const limited = lookupLimit(request, server);
      if (limited) {
        set.status = 429;
        set.headers["retry-after"] = String(limited.retryAfter);
        return { error: "Too many lookups. Try again later." };
      }

      await requireUser(cookie, request.headers.get("authorization"));

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

      const payload = parseJsonPayload<OpenLibraryResponse>(
        await readCappedText(response),
        "Open Library",
      );

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
      detail: {
        summary: "Lookup by ISBN",
        description: "Open Library metadata prefilled as a reference draft.",
        tags: ["lookup"],
      },
      response: {
        200: lookupResultSchema,
        429: errorResponse,
      },
    },
  )
  .get(
    "/url",
    async ({ query, cookie, request, server, set }) => {
      const limited = lookupLimit(request, server);
      if (limited) {
        set.status = 429;
        set.headers["retry-after"] = String(limited.retryAfter);
        return { error: "Too many lookups. Try again later." };
      }

      await requireUser(cookie, request.headers.get("authorization"));

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

      const response = await fetchUrlWithSsrfChecks(parsed.toString());

      if (!response.ok) {
        throw new HttpError(502, "Could not fetch metadata from that URL.");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        throw new HttpError(422, "That URL does not appear to be an HTML page.");
      }

      const html = await readCappedText(response);

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
      detail: {
        summary: "Lookup by URL",
        description: "Page metadata scraped prefilled as a reference draft.",
        tags: ["lookup"],
      },
      response: {
        200: lookupResultSchema,
        429: errorResponse,
      },
    },
  );
