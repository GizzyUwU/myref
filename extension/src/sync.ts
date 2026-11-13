import type { PersistedState } from "./storage.js";
import {
  nowIso,
  referenceTypes,
  type Project,
  type Reference,
  type ReferenceType,
} from "./types.js";

interface ServerProject {
  id: string;
  name: string;
  description: string;
  styleId: string;
  styleTitle: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerStyleDoc {
  id: string;
  title: string;
  xml: string;
  sourceUrl: string;
  locales: Record<string, string>;
}

export interface ServerStyleSummary {
  id: string;
  title: string;
}

interface ServerReference {
  id: string;
  type: string;
  title: string;
  authors: Array<{ family: string; given?: string }>;
  editors: Array<{ family: string; given?: string }>;
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
}

interface MintedToken {
  id: string;
  token: string;
  name: string;
  createdAt: string;
}

export function serverBase(serverUrl: string): string {
  return (serverUrl || "").trim().replace(/\/+$/, "");
}

export async function searchServerStyles(
  base: string,
  token: string,
  query: string,
): Promise<ServerStyleSummary[]> {
  const data = await serverFetch<{ styles: ServerStyleSummary[] }>(
    base,
    token,
    `/api/styles?q=${encodeURIComponent(query)}&limit=50`,
  );
  return data.styles ?? [];
}

export async function fetchServerStyle(
  base: string,
  token: string,
  styleId: string,
): Promise<ServerStyleDoc> {
  return serverFetch<ServerStyleDoc>(
    base,
    token,
    `/api/styles/${encodeURIComponent(styleId)}`,
  );
}

async function serverFetch<T>(
  base: string,
  token: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (!base) throw new Error("Set a server URL first.");
  if (!token) throw new Error("Not connected — log in to get an API token.");
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(base + path, {
    credentials: "include",
    ...(options ?? {}),
    headers,
  });
  const text = await res.text().catch(() => "");
  let data: { error?: unknown } | null = null;
  try {
    data = text ? (JSON.parse(text) as { error?: unknown }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Sync token rejected — please log in again.");
    }
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export async function mintToken(
  base: string,
  username: string,
  password: string,
): Promise<{ token: MintedToken; username: string }> {
  if (!base) throw new Error("Set a server URL first.");
  if (!username || !password) throw new Error("Enter username and password.");
  const cleanBase = serverBase(base);
  const res = await fetch(cleanBase + "/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, name: "Browser extension" }),
  });
  const text = await res.text().catch(() => "");
  let data: { token?: MintedToken; error?: unknown } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.token) {
    throw new Error(
      data && typeof data.error === "string"
        ? data.error
        : `Login failed (${res.status}).`,
    );
  }
  return { token: data.token, username };
}

export async function revokeToken(base: string, token: string): Promise<void> {
  try {
    await serverFetch<{ ok: boolean }>(base, token, "/api/auth/token", {
      method: "DELETE",
    });
  } catch {
  }
}

export interface ValidatedToken {
  username: string;
  tokenId: string | null;
}

export async function validateToken(
  base: string,
  token: string,
): Promise<ValidatedToken> {
  const cleanBase = serverBase(base);
  if (!cleanBase) throw new Error("Set a server URL first.");
  if (!token.trim()) throw new Error("Paste an API token first.");
  const data = await serverFetch<{
    user: { username: string } | null;
    tokenId: string | null;
  }>(cleanBase, token.trim(), "/api/auth/me");
  if (!data.user) throw new Error("That token is invalid or revoked.");
  return { username: data.user.username, tokenId: data.tokenId };
}

function asReferenceType(value: string | undefined): ReferenceType {
  return (referenceTypes as readonly string[]).includes(value ?? "")
    ? (value as ReferenceType)
    : "other";
}

function toLocalRef(serverId: string, row: ServerReference): Reference {
  return {
    id: row.id,
    projectId: serverId,
    serverId: row.id,
    type: asReferenceType(row.type),
    title: row.title,
    authors: row.authors ?? [],
    editors: row.editors ?? [],
    year: row.year ?? "",
    containerTitle: row.containerTitle ?? "",
    publisher: row.publisher ?? "",
    place: row.place ?? "",
    edition: row.edition ?? "",
    volume: row.volume ?? "",
    issue: row.issue ?? "",
    pages: row.pages ?? "",
    doi: row.doi ?? "",
    url: row.url ?? "",
    accessedDate: row.accessedDate ?? null,
    publicationDate: row.publicationDate ?? "",
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    createdAt: row.createdAt ?? nowIso(),
    updatedAt: row.updatedAt ?? nowIso(),
  };
}

function fullDraft(ref: Reference): Record<string, unknown> {
  return {
    type: ref.type,
    title: ref.title,
    authors: ref.authors,
    editors: ref.editors,
    year: ref.year,
    containerTitle: ref.containerTitle,
    publisher: ref.publisher,
    place: ref.place,
    edition: ref.edition,
    volume: ref.volume,
    issue: ref.issue,
    pages: ref.pages,
    doi: ref.doi,
    url: ref.url,
    accessedDate: ref.accessedDate,
    publicationDate: ref.publicationDate,
    notes: ref.notes,
    tags: ref.tags,
  };
}

function newer(a: string | undefined, b: string | undefined): boolean {
  return Date.parse(a ?? "") > Date.parse(b ?? "");
}

export interface PullResult {
  projects: number;
  refs: number;
}

export async function pullMerge(
  state: PersistedState,
  base: string,
  token: string,
): Promise<PullResult> {
  const { projects } = await serverFetch<{ projects: ServerProject[] }>(
    base,
    token,
    "/api/projects",
  );
  let projectCount = 0;
  let refCount = 0;

  for (const remote of projects ?? []) {
    let local: Project | undefined = state.projects.find(
      (project) => project.serverId === remote.id || project.id === remote.id,
    );
    if (!local) {
      local = {
        id: remote.id,
        name: remote.name,
        description: remote.description ?? "",
        createdAt: remote.createdAt ?? nowIso(),
        updatedAt: remote.updatedAt ?? nowIso(),
        serverId: remote.id,
        styleId: remote.styleId,
        styleTitle: remote.styleTitle,
      };
      state.projects.push(local);
      state.refsByProject[local.id] = [];
    } else if (!newer(local.updatedAt, remote.updatedAt)) {
      local.name = remote.name;
      local.description = remote.description ?? "";
      local.styleId = remote.styleId;
      local.styleTitle = remote.styleTitle;
      local.updatedAt = remote.updatedAt ?? local.updatedAt;
      local.serverId = remote.id;
    }
    local.serverId = remote.id;

    const { references } = await serverFetch<{ references: ServerReference[] }>(
      base,
      token,
      `/api/projects/${remote.id}/references`,
    );
    const list = state.refsByProject[local.id] ?? [];
    const byServerId = new Map(
      list.filter((ref) => ref.serverId).map((ref) => [ref.serverId as string, ref]),
    );
    const byId = new Map(list.map((ref) => [ref.id, ref]));

    for (const row of references ?? []) {
      refCount += 1;
      const existing = byServerId.get(row.id) ?? byId.get(row.id);
      if (!existing) {
        const created = toLocalRef(local.id, row);
        list.push(created);
        byServerId.set(row.id, created);
        byId.set(created.id, created);
      } else if (!newer(existing.updatedAt, row.updatedAt)) {
        Object.assign(existing, toLocalRef(local.id, row), { id: existing.id });
        byServerId.set(row.id, existing);
      }
    }
    state.refsByProject[local.id] = list;
    projectCount += 1;
  }

  return { projects: projectCount, refs: refCount };
}

export async function pushAll(
  state: PersistedState,
  base: string,
  token: string,
): Promise<void> {
  const ignoreMissing = (error: unknown): void => {
    if (error instanceof Error && /\(404\)/.test(error.message)) return;
    throw error;
  };

  for (const projectId of state.deletedServerProjectIds) {
    await serverFetch(base, token, `/api/projects/${projectId}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }
  state.deletedServerProjectIds = [];

  for (const refId of state.deletedServerRefIds) {
    await serverFetch(base, token, `/api/references/${refId}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }
  state.deletedServerRefIds = [];

  const since = state.settings.lastSyncedAt;

  for (const local of state.projects) {
    let serverId = local.serverId;
    if (!serverId) {
      const created = await serverFetch<{ project: ServerProject }>(
        base,
        token,
        "/api/projects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: local.name,
            description: local.description ?? "",
          }),
        },
      );
      serverId = created.project.id;
      local.serverId = serverId;
      if (created.project.styleId !== local.styleId) {
        await serverFetch(base, token, `/api/projects/${serverId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleId: local.styleId }),
        });
      }
    } else if (!since || newer(local.updatedAt, since)) {
      await serverFetch(base, token, `/api/projects/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: local.name,
          description: local.description ?? "",
          styleId: local.styleId,
        }),
      });
    }

    for (const ref of state.refsByProject[local.id] ?? []) {
      if (!ref.serverId) {
        const created = await serverFetch<{ reference: ServerReference }>(
          base,
          token,
          `/api/projects/${serverId}/references`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullDraft(ref)),
          },
        );
        ref.serverId = created.reference.id;
        ref.updatedAt = created.reference.updatedAt ?? ref.updatedAt;
      } else if (!since || newer(ref.updatedAt, since)) {
        const updated = await serverFetch<{ reference: ServerReference }>(
          base,
          token,
          `/api/references/${ref.serverId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fullDraft(ref)),
          },
        );
        ref.updatedAt = updated.reference.updatedAt ?? ref.updatedAt;
      }
    }
  }

  state.settings.lastSyncedAt = nowIso();
}
