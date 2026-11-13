# MyRef API — browser extension guide

Interactive reference: run the backend and open **`/api/docs`** (Swagger UI, OpenAPI JSON at **`/api/docs/json`**).
Machine-readable summary: **`GET /api/docs/extension`** — sync flow plus the full endpoint list, generated from the live router.

Base URL is configurable in the extension (`Server URL`, default `http://localhost:3000`).
Every path below is prefixed with `/api`. Auth is a long-lived Bearer token, never the password.

## 1. Auth

| Step | Call |
|---|---|
| Mint token | `POST /api/auth/token` `{ username, password, name? }` → `{ token: { token, id, name, createdAt } }` |
| Use it | `Authorization: Bearer myref_...` on every request |
| Validate | `GET /api/auth/me` → `{ user, tokenId }` |
| Disconnect | `DELETE /api/auth/token` revokes the calling token |

Token auth takes precedence over the `myref_session` cookie. Name new tokens `"Browser extension"`.
Failures: `401 { error }`. Token endpoints are rate-limited (`429` + `Retry-After`).

## 2. Sync order

```text
GET    /api/projects
GET    /api/projects/:projectId/references      per project (supports ?q= &type=)
POST   /api/projects/:projectId/references      local-only rows
PATCH  /api/references/:id                      local edits newer than server
DELETE /api/references/:id                      replayed local deletes
GET    /api/styles?q=&limit=                    cache style list
GET    /api/styles/:id                          cache { id, title, xml, sourceUrl, locales } for offline citeproc
```

Last-write-wins per entity by `updatedAt`. Push creates missing projects first
(`POST /api/projects` `{ name, description? }`), then references.

## 3. Capture

```text
GET /api/lookup/doi?doi=      Crossref, returns { source, reference }
GET /api/lookup/isbn?isbn=    Open Library, returns { source, reference }
GET /api/lookup/url?url=      SSRF-guarded fetch + meta scrape, returns { source, reference }
```

Returns a prefilled `website`/`book`/`journal` draft the extension can save with
`POST /api/projects/:projectId/references`. Rate limit ~30/min/IP.

## 4. Projects, bibliography, sharing

```text
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId                 { name?, description?, styleId?, fontFamily? }
DELETE /api/projects/:projectId
GET    /api/projects/:projectId/bibliography    { style, styleId, styleSource, entries[], citations[] }
GET    /api/projects/:projectId/export?format=  text | html | ris | bibtex
POST   /api/projects/:projectId/share-codes     { expiresInDays? } -> { code, expiresAt, id }
POST   /api/share/join                          { code }
```

## 5. Reference shape

```json
{
  "type": "book | chapter | journal | website | report | thesis | newspaper | film | other",
  "title": "string (required)",
  "authors": [{ "family": "Doe", "given": "Jane" }],
  "editors": [],
  "year": "2024",
  "containerTitle": "",
  "publisher": "",
  "place": "",
  "edition": "",
  "volume": "",
  "issue": "",
  "pages": "",
  "doi": "",
  "url": "",
  "accessedDate": "2024-01-31 | null",
  "publicationDate": "",
  "notes": "",
  "tags": []
}
```

## 6. Errors and limits

Error shape is always `{ error: string }`. Codes: `400` validation (also `javascript:`/`data:`/`vbscript:`/`file:` URL and DOI schemes),
`401` unauthenticated, `404` not found (also unknown share/DOI), `409` conflict, `413` lookup response over 2 MB,
`422` bad export/HTML, `429` rate limit with `Retry-After`, `502` upstream lookup failure.
CORS allows the web `APP_ORIGIN` plus configured extension origins. API docs are served in non-production only.
