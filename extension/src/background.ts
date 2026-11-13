import { saveCurrentTab } from "./lookup.js";
import { loadState, saveState } from "./storage.js";
import { nowIso, uid } from "./types.js";

function setBadge(text: string): void {
  try {
    chrome.action?.setBadgeText?.({ text });
  } catch {
  }
}

chrome.commands?.onCommand.addListener((command) => {
  if (command !== "save-tab") return;
  void (async () => {
    const state = await loadState();
    const project =
      state.projects.find((p) => p.id === state.settings.activeProjectId) ??
      null;
    if (!project) {
      setBadge("!");
      try {
        await chrome.action?.openPopup?.();
      } catch {
      }
      setTimeout(() => setBadge(""), 2500);
      return;
    }
    try {
      const draft = await saveCurrentTab();
      const now = nowIso();
      const list = state.refsByProject[project.id] ?? [];
      list.push({
        id: uid(),
        projectId: project.id,
        serverId: null,
        ...draft,
        createdAt: now,
        updatedAt: now,
      });
      state.refsByProject[project.id] = list;
      project.updatedAt = now;
      state.needsPush = true;
      await saveState(state);
      setBadge("✓");
    } catch {
      setBadge("!");
    }
    setTimeout(() => setBadge(""), 2500);
  })();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && typeof message === "object" && "type" in message) {
    const typed = message as { type?: unknown };
    if (typed.type === "MYREF_PING") {
      sendResponse({ ok: true });
    }
  }
  return false;
});
