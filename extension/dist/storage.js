import { defaultStyle } from "./csl.js";
export function defaultState() {
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
function hasChromeStorage() {
    return (typeof chrome !== "undefined" &&
        !!chrome.storage &&
        !!chrome.storage.local);
}
function lsGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function lsSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    }
    catch {
    }
}
const storagePrefix = "myref:";
export async function loadState() {
    const fallback = defaultState();
    let stored;
    if (hasChromeStorage()) {
        stored = (await chrome.storage.local.get([
            "projects",
            "refsByProject",
            "settings",
            "deletedServerRefIds",
            "deletedServerProjectIds",
            "needsPush",
            "cslStyles",
        ]));
    }
    else {
        stored = {
            projects: lsGet(storagePrefix + "projects", []),
            refsByProject: lsGet(storagePrefix + "refsByProject", {}),
            settings: lsGet(storagePrefix + "settings", fallback.settings),
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
        refsByProject: stored.refsByProject && typeof stored.refsByProject === "object"
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
        cslStyles: stored.cslStyles && typeof stored.cslStyles === "object"
            ? stored.cslStyles
            : {},
    };
}
export async function saveState(state) {
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
//# sourceMappingURL=storage.js.map