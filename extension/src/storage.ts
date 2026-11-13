import type { Project, Reference, Settings } from "./types.js";
import { defaultStyle } from "./csl.js";

export interface CslCacheEntry {
  title: string;
  xml: string;
  locales: Record<string, string>;
  at: number;
}

export interface PersistedState {
  projects: Project[];
  refsByProject: Record<string, Reference[]>;
  settings: Settings;

  deletedServerRefIds: string[];
  deletedServerProjectIds: string[];

  needsPush: boolean;

  cslStyles: Record<string, CslCacheEntry>;
}

export function defaultState(): PersistedState {
  return {
    projects: [],
    refsByProject: {},
    settings: {
      theme: "light",
      serverUrl: "",
      token: null,
      tokenId: null,
      serverUser: null,
      lastSyncedAt: null,
      activeProjectId: null,
    },
    deletedServerRefIds: [],
    deletedServerProjectIds: [],
    needsPush: false,
    cslStyles: {},
  };
}

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

const storagePrefix = "myref:";

export async function loadState(): Promise<PersistedState> {
  const fallback = defaultState();
  let stored: Partial<PersistedState>;
  if (hasChromeStorage()) {
    stored = (await chrome.storage.local.get([
      "projects",
      "refsByProject",
      "settings",
      "deletedServerRefIds",
      "deletedServerProjectIds",
      "needsPush",
      "cslStyles",
    ])) as Partial<PersistedState>;
  } else {
    stored = {
      projects: lsGet<Project[]>(storagePrefix + "projects", []),
      refsByProject: lsGet<Record<string, Reference[]>>(
        storagePrefix + "refsByProject",
        {},
      ),
      settings: lsGet<Settings>(storagePrefix + "settings", fallback.settings),
      deletedServerRefIds: [],
      deletedServerProjectIds: [],
      needsPush: false,
      cslStyles: {},
    };
  }

  const projects = Array.isArray(stored.projects) ? stored.projects : [];
  for (const project of projects) {
    if (!project.styleId || !project.styleTitle) {
      const fallbackStyle = defaultStyle();
      project.styleId = project.styleId || fallbackStyle.styleId;
      project.styleTitle = project.styleTitle || fallbackStyle.styleTitle;
    }
  }

  return {
    projects,
    refsByProject:
      stored.refsByProject && typeof stored.refsByProject === "object"
        ? stored.refsByProject
        : {},
    settings: { ...fallback.settings, ...(stored.settings ?? {}) },
    deletedServerRefIds: Array.isArray(stored.deletedServerRefIds)
      ? stored.deletedServerRefIds
      : [],
    deletedServerProjectIds: Array.isArray(stored.deletedServerProjectIds)
      ? stored.deletedServerProjectIds
      : [],
    needsPush: stored.needsPush === true,
    cslStyles:
      stored.cslStyles && typeof stored.cslStyles === "object"
        ? stored.cslStyles
        : {},
  };
}

export async function saveState(state: PersistedState): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({
      projects: state.projects,
      refsByProject: state.refsByProject,
      settings: state.settings,
      deletedServerRefIds: state.deletedServerRefIds,
      deletedServerProjectIds: state.deletedServerProjectIds,
      needsPush: state.needsPush,
      cslStyles: state.cslStyles,
    });
    return;
  }
  lsSet(storagePrefix + "projects", state.projects);
  lsSet(storagePrefix + "refsByProject", state.refsByProject);
  lsSet(storagePrefix + "settings", state.settings);
  lsSet(storagePrefix + "deletedServerRefIds", state.deletedServerRefIds);
  lsSet(storagePrefix + "deletedServerProjectIds", state.deletedServerProjectIds);
  lsSet(storagePrefix + "needsPush", state.needsPush);
  lsSet(storagePrefix + "cslStyles", state.cslStyles);
}
