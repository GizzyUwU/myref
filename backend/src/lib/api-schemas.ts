import { t } from "elysia";

const dateTimeExample = "2026-11-13T08:28:55.231Z";

export const dateTime = t.Union([t.Date(), t.String()], {
  example: dateTimeExample,
  examples: [dateTimeExample],
});

export const nullableDateTime = t.Union([t.Date(), t.String(), t.Null()], {
  example: dateTimeExample,
  examples: [dateTimeExample, null],
});

export const errorResponse = t.Object({
  error: t.String(),
});

export const authorSchema = t.Object({
  family: t.String(),
  given: t.Optional(t.String()),
});

export const publicUserSchema = t.Object({
  id: t.String(),
  username: t.String(),
  createdAt: dateTime,
});

export const mintedTokenSchema = t.Object({
  id: t.String(),
  token: t.String(),
  name: t.String(),
  createdAt: dateTime,
});

export const apiTokenInfoSchema = t.Object({
  id: t.String(),
  name: t.String(),
  createdAt: dateTime,
  lastUsedAt: nullableDateTime,
});

export const projectSchema = t.Object({
  id: t.String(),
  userId: t.Optional(t.String()),
  name: t.String(),
  description: t.String(),
  styleId: t.String(),
  styleTitle: t.String(),
  styleSource: t.String(),
  fontFamily: t.String(),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const projectWithMetaSchema = t.Composite([
  projectSchema,
  t.Object({
    referenceCount: t.Number(),
    role: t.Union([t.Literal("owner"), t.Literal("member")]),
    ownerUsername: t.String(),
  }),
]);

export const referenceSchema = t.Object({
  id: t.String(),
  projectId: t.String(),
  userId: t.String(),
  type: t.String(),
  title: t.String(),
  authors: t.Array(authorSchema),
  editors: t.Array(authorSchema),
  year: t.String(),
  containerTitle: t.String(),
  publisher: t.String(),
  place: t.String(),
  edition: t.String(),
  volume: t.String(),
  issue: t.String(),
  pages: t.String(),
  doi: t.String(),
  url: t.String(),
  accessedDate: t.Union([t.String(), t.Null()]),
  publicationDate: t.String(),
  notes: t.String(),
  tags: t.Array(t.String()),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const referenceDraftSchema = t.Object({
  type: t.String(),
  title: t.String(),
  authors: t.Array(authorSchema),
  editors: t.Array(authorSchema),
  year: t.String(),
  containerTitle: t.String(),
  publisher: t.String(),
  place: t.String(),
  edition: t.String(),
  volume: t.String(),
  issue: t.String(),
  pages: t.String(),
  doi: t.String(),
  url: t.String(),
  accessedDate: t.Union([t.String(), t.Null()]),
  publicationDate: t.String(),
  notes: t.String(),
  tags: t.Array(t.String()),
});

export const bibliographyEntrySchema = t.Object({
  id: t.String(),
  type: t.String(),
  plain: t.String(),
  html: t.String(),
});

export const bibliographySchema = t.Object({
  style: t.String(),
  styleId: t.String(),
  styleSource: t.String(),
  entries: t.Array(bibliographyEntrySchema),
  citations: t.Array(
    t.Object({
      id: t.String(),
      inText: t.String(),
    }),
  ),
});

export const styleSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  title: t.String(),
  titleShort: t.Union([t.String(), t.Null()]),
  dependent: t.Boolean(),
  format: t.Union([t.String(), t.Null()]),
  fields: t.Array(t.String()),
  updated: t.Union([t.String(), t.Null()]),
  href: t.String(),
  isDefault: t.Boolean(),
});

export const styleDetailSchema = t.Object({
  id: t.String(),
  title: t.String(),
  xml: t.String(),
  sourceUrl: t.String(),
  locales: t.Record(t.String(), t.String()),
});

export const shareCodeSchema = t.Object({
  id: t.String(),
  expiresAt: dateTime,
  createdAt: dateTime,
});

export const memberSchema = t.Object({
  id: t.String(),
  username: t.String(),
  createdAt: dateTime,
});

export const lookupResultSchema = t.Object({
  source: t.String(),
  reference: referenceDraftSchema,
});

export const okSchema = t.Object({
  ok: t.Boolean(),
});

export const userResponse = t.Object({
  user: publicUserSchema,
});

export const meResponse = t.Object({
  user: t.Union([publicUserSchema, t.Null()]),
  tokenId: t.Union([t.String(), t.Null()]),
});

export const tokenResponse = t.Object({
  token: mintedTokenSchema,
});

export const tokensResponse = t.Object({
  tokens: t.Array(apiTokenInfoSchema),
});
