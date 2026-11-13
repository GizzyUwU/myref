import { nowIso, referenceTypes, } from "./types.js";
export function serverBase(serverUrl) {
    return (serverUrl || "").trim().replace(/\/+$/, "");
}
export async function searchServerStyles(base, token, query) {
    const data = await serverFetch(base, token, `/api/styles?q=${encodeURIComponent(query)}&limit=50`);
    return data.styles ?? [];
}
export async function fetchServerStyle(base, token, styleId) {
    return serverFetch(base, token, `/api/styles/${encodeURIComponent(styleId)}`);
}
async function serverFetch(base, token, path, options) {
    if (!base)
        throw new Error("Set a server URL first.");
    if (!token)
        throw new Error("Not connected — log in to get an API token.");
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
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = null;
    }
    if (!res.ok) {
        if (res.status === 401) {
            throw new Error("Sync token rejected — please log in again.");
        }
        const message = data && typeof data.error === "string"
            ? data.error
            : `Request failed (${res.status}).`;
        throw new Error(message);
    }
    return data;
}
export async function mintToken(base, username, password) {
    if (!base)
        throw new Error("Set a server URL first.");
    if (!username || !password)
        throw new Error("Enter username and password.");
    const cleanBase = serverBase(base);
    const res = await fetch(cleanBase + "/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, name: "Browser extension" }),
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = null;
    }
    if (!res.ok || !data?.token) {
        throw new Error(data && typeof data.error === "string"
            ? data.error
            : `Login failed (${res.status}).`);
    }
    return { token: data.token, username };
}
export async function revokeToken(base, token) {
    try {
        await serverFetch(base, token, "/api/auth/token", {
            method: "DELETE",
        });
    }
    catch {
    }
}
export async function validateToken(base, token) {
    const cleanBase = serverBase(base);
    if (!cleanBase)
        throw new Error("Set a server URL first.");
    if (!token.trim())
        throw new Error("Paste an API token first.");
    const data = await serverFetch(cleanBase, token.trim(), "/api/auth/me");
    if (!data.user)
        throw new Error("That token is invalid or revoked.");
    return { username: data.user.username, tokenId: data.tokenId };
}
function asReferenceType(value) {
    return referenceTypes.includes(value ?? "")
        ? value
        : "other";
}
function toLocalRef(serverId, row) {
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
function fullDraft(ref) {
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
function newer(a, b) {
    return Date.parse(a ?? "") > Date.parse(b ?? "");
}
export async function pullMerge(state, base, token) {
    const { projects } = await serverFetch(base, token, "/api/projects");
    let projectCount = 0;
    let refCount = 0;
    for (const remote of projects ?? []) {
        let local = state.projects.find((project) => project.serverId === remote.id || project.id === remote.id);
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
        }
        else if (!newer(local.updatedAt, remote.updatedAt)) {
            local.name = remote.name;
            local.description = remote.description ?? "";
            local.styleId = remote.styleId;
            local.styleTitle = remote.styleTitle;
            local.updatedAt = remote.updatedAt ?? local.updatedAt;
            local.serverId = remote.id;
        }
        local.serverId = remote.id;
        const { references } = await serverFetch(base, token, `/api/projects/${remote.id}/references`);
        const list = state.refsByProject[local.id] ?? [];
        const byServerId = new Map(list.filter((ref) => ref.serverId).map((ref) => [ref.serverId, ref]));
        const byId = new Map(list.map((ref) => [ref.id, ref]));
        for (const row of references ?? []) {
            refCount += 1;
            const existing = byServerId.get(row.id) ?? byId.get(row.id);
            if (!existing) {
                const created = toLocalRef(local.id, row);
                list.push(created);
                byServerId.set(row.id, created);
                byId.set(created.id, created);
            }
            else if (!newer(existing.updatedAt, row.updatedAt)) {
                Object.assign(existing, toLocalRef(local.id, row), { id: existing.id });
                byServerId.set(row.id, existing);
            }
        }
        state.refsByProject[local.id] = list;
        projectCount += 1;
    }
    return { projects: projectCount, refs: refCount };
}
export async function pushAll(state, base, token) {
    const ignoreMissing = (error) => {
        if (error instanceof Error && /\(404\)/.test(error.message))
            return;
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
            const created = await serverFetch(base, token, "/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: local.name,
                    description: local.description ?? "",
                }),
            });
            serverId = created.project.id;
            local.serverId = serverId;
            if (created.project.styleId !== local.styleId) {
                await serverFetch(base, token, `/api/projects/${serverId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ styleId: local.styleId }),
                });
            }
        }
        else if (!since || newer(local.updatedAt, since)) {
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
                const created = await serverFetch(base, token, `/api/projects/${serverId}/references`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(fullDraft(ref)),
                });
                ref.serverId = created.reference.id;
                ref.updatedAt = created.reference.updatedAt ?? ref.updatedAt;
            }
            else if (!since || newer(ref.updatedAt, since)) {
                const updated = await serverFetch(base, token, `/api/references/${ref.serverId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(fullDraft(ref)),
                });
                ref.updatedAt = updated.reference.updatedAt ?? ref.updatedAt;
            }
        }
    }
    state.settings.lastSyncedAt = nowIso();
}
//# sourceMappingURL=sync.js.map