import type {
  Bibliography,
  CslStyleSummary,
  Project,
  Reference,
  ReferenceDraft,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Is it running?");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : typeof data === "string" && data
          ? data
          : "Something went wrong.";
    throw new ApiError(response.status, message);
  }

  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("/auth/me"),

  register: (input: { username: string; password: string }) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  login: (input: { username: string; password: string }) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  projects: () => request<{ projects: Project[] }>("/projects"),

  project: (id: string) =>
    request<{ project: Project }>(`/projects/${id}`),

  createProject: (input: { name: string; description?: string }) =>
    request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateProject: (
    id: string,
    input: {
      name?: string;
      description?: string;
      styleId?: string;
      fontFamily?: string;
    },
  ) =>
    request<{ project: Project }>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  searchStyles: (query: string) =>
    request<{ styles: CslStyleSummary[] }>(
      `/styles?q=${encodeURIComponent(query)}`,
    ),

  deleteProject: (id: string) =>
    request<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),

  references: (projectId: string) =>
    request<{ references: Reference[] }>(
      `/projects/${projectId}/references`,
    ),

  createReference: (projectId: string, draft: ReferenceDraft) =>
    request<{ reference: Reference }>(
      `/projects/${projectId}/references`,
      {
        method: "POST",
        body: JSON.stringify(draft),
      },
    ),

  updateReference: (id: string, draft: ReferenceDraft) =>
    request<{ reference: Reference }>(`/references/${id}`, {
      method: "PATCH",
      body: JSON.stringify(draft),
    }),

  deleteReference: (id: string) =>
    request<{ ok: true }>(`/references/${id}`, { method: "DELETE" }),

  duplicateReferences: (input: { ids: string[]; projectId: string }) =>
    request<{ references: Reference[]; projectId: string }>(
      "/references/duplicate",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),

  deleteReferences: (input: { ids: string[] }) =>
    request<{ deleted: string[] }>("/references/delete", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  bibliography: (projectId: string) =>
    request<Bibliography>(`/projects/${projectId}/bibliography`),

  lookupDoi: (doi: string) =>
    request<{ source: string; reference: ReferenceDraft }>(
      `/lookup/doi?doi=${encodeURIComponent(doi)}`,
    ),

  lookupIsbn: (isbn: string) =>
    request<{ source: string; reference: ReferenceDraft }>(
      `/lookup/isbn?isbn=${encodeURIComponent(isbn)}`,
    ),

  lookupUrl: (url: string) =>
    request<{ source: string; reference: ReferenceDraft }>(
      `/lookup/url?url=${encodeURIComponent(url)}`,
    ),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteAccount: (input: { password: string }) =>
    request<{ ok: true }>("/auth/delete-account", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateUsername: (input: { username: string }) =>
    request<{ user: User }>("/auth/username", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  authConfig: () =>
    request<{ registrationEnabled: boolean }>("/auth/config"),
};

export function exportUrl(
  projectId: string,
  format: "text" | "html" | "ris" | "bibtex",
): string {
  return `/api/projects/${projectId}/export?format=${format}`;
}
