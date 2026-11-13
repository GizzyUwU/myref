import { download, toBibtex, toRis } from "./export.js";
import { bundledStyles, defaultStyle, formatWithStyle, loadBundledStyle, } from "./csl.js";
import { esc, formatEntries, inText, peopleToText, parsePeople, sortRefs, } from "./format.js";
import { doLookup, saveCurrentTab } from "./lookup.js";
import { loadState, saveState } from "./storage.js";
import { mintToken, pullMerge, pushAll, revokeToken, serverBase, validateToken, fetchServerStyle, searchServerStyles } from "./sync.js";
import { referenceTypes, typeLabels, emptyDraft, isTheme, nowIso, uid, } from "./types.js";
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing element #${id}`);
    return node;
}
function toast(message, kind) {
    const box = el("toasts");
    const div = document.createElement("div");
    div.className = "toast" + (kind && kind !== "info" ? ` ${kind}` : "");
    div.textContent = message;
    box.appendChild(div);
    setTimeout(() => div.remove(), 3200);
}
function applyTheme(theme) {
    if (theme === "light")
        document.documentElement.removeAttribute("data-theme");
    else
        document.documentElement.dataset.theme = theme;
    el("themeSelect").value = theme;
}
async function copyText(value, message) {
    if (!value) {
        toast("Nothing to copy yet.", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(value);
        toast(message, "success");
    }
    catch {
        toast("Could not copy to the clipboard.", "error");
    }
}
let state = null;
let currentProjectId = null;
let selected = new Set();
let editingRefId = null;
let editingProjectId = null;
let bibTab = "bib";
let importBusy = false;
let dirty = false;
let syncing = false;
let pushTimer;
function getState() {
    if (!state)
        throw new Error("State not loaded.");
    return state;
}
function getRefs(projectId) {
    if (!projectId)
        return [];
    return getState().refsByProject[projectId] ?? [];
}
function currentProject() {
    return (getState().projects.find((project) => project.id === currentProjectId) ??
        null);
}
function touchProject(projectId) {
    const project = getState().projects.find((p) => p.id === projectId);
    if (project)
        project.updatedAt = nowIso();
}
function show(name) {
    for (const view of ["projectsView", "projectView", "settingsView"]) {
        el(view).hidden = view !== name;
    }
}
const projectSortKey = "myref:project-sort";
function currentProjectSort() {
    const fromSelect = el("projectSort").value;
    if (fromSelect === "edited" ||
        fromSelect === "name-az" ||
        fromSelect === "name-za" ||
        fromSelect === "refs" ||
        fromSelect === "created") {
        return fromSelect;
    }
    try {
        const stored = localStorage.getItem(projectSortKey);
        if (stored === "edited" ||
            stored === "name-az" ||
            stored === "name-za" ||
            stored === "refs" ||
            stored === "created") {
            el("projectSort").value = stored;
            return stored;
        }
    }
    catch {
    }
    return "edited";
}
function sortProjectList(projects, sort) {
    const arr = [...projects];
    switch (sort) {
        case "name-az":
            arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
            break;
        case "name-za":
            arr.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
            break;
        case "refs":
            arr.sort((a, b) => getRefs(b.id).length - getRefs(a.id).length);
            break;
        case "created":
            arr.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
            break;
        case "edited":
        default:
            arr.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
    }
    return arr;
}
function renderProjects() {
    const list = el("projectList");
    list.innerHTML = "";
    const { projects } = getState();
    if (projects.length === 0) {
        const empty = document.createElement("div");
        empty.className = "card empty";
        empty.innerHTML =
            "<h2>No projects yet</h2><p class=\"subtle\">Create a project per essay or paper. Everything stays on this device until you sync.</p>";
        list.appendChild(empty);
        return;
    }
    const sorted = sortProjectList(projects, currentProjectSort());
    for (const project of sorted) {
        const count = getRefs(project.id).length;
        const active = getState().settings.activeProjectId === project.id;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "card project-card";
        button.innerHTML =
            `<h2>${active ? "★ " : ""}${esc(project.name)}</h2>` +
                `<p class="subtle">${esc(project.description || "No description yet.")}</p>` +
                `<div class="row space"><span class="meta">${count} ${count === 1 ? "reference" : "references"}</span>` +
                `<span class="row"><span class="btn btn-ghost btn-sm" data-act="edit">Edit</span> ` +
                `<span class="btn btn-danger btn-sm" data-act="del">Delete</span></span></div>`;
        button.addEventListener("click", (event) => {
            const target = event.target;
            const act = target?.dataset?.act;
            if (act === "edit") {
                event.stopPropagation();
                openProjectDialog(project);
                return;
            }
            if (act === "del") {
                event.stopPropagation();
                void deleteProject(project.id);
                return;
            }
            openProject(project.id);
        });
        list.appendChild(button);
    }
}
function filteredSortedRefs() {
    const term = el("searchInput").value.trim().toLowerCase();
    const type = el("typeFilter").value;
    const sort = el("sortSelect").value;
    let list = getRefs(currentProjectId);
    if (type !== "all")
        list = list.filter((ref) => ref.type === type);
    if (term) {
        list = list.filter((ref) => [
            ref.title,
            ref.containerTitle,
            ref.publisher,
            ref.doi,
            ref.year,
            ...(ref.authors ?? []).flatMap((author) => [
                author.family,
                author.given ?? "",
            ]),
            ...(ref.tags ?? []),
        ]
            .join(" ")
            .toLowerCase()
            .includes(term));
    }
    return sortRefs(list, sort);
}
function entriesFor(ids) {
    const all = getRefs(currentProjectId);
    if (!ids || ids.size === 0)
        return all;
    const byId = new Map(all.map((ref) => [ref.id, ref]));
    return [...ids]
        .map((id) => byId.get(id))
        .filter((ref) => Boolean(ref));
}
async function currentEntries(ids) {
    const project = currentProject();
    const targets = entriesFor(ids);
    if (!project)
        return formatEntries(targets);
    const doc = await ensureDoc(project.styleId);
    return formatWithStyle(targets, doc);
}
function paintBib(body, entries, showCite, useSelected) {
    body.innerHTML = "";
    if (entries.length === 0) {
        body.innerHTML = `<p class="subtle">${useSelected ? "None of the selected references have entries yet." : "Your bibliography will appear here."}</p>`;
        return;
    }
    if (!showCite) {
        for (const entry of entries) {
            const div = document.createElement("div");
            div.className = "bib-entry";
            div.innerHTML = entry.html;
            body.appendChild(div);
        }
    }
    else {
        for (const entry of entries) {
            const div = document.createElement("div");
            div.className = "cite-row";
            div.innerHTML = `<code>${esc(entry.inText)}</code>`;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn btn-ghost btn-sm";
            button.textContent = "Copy";
            button.addEventListener("click", () => void copyText(entry.inText, "In-text citation copied."));
            div.appendChild(button);
            body.appendChild(div);
        }
    }
}
let bibRequestId = 0;
function renderBib() {
    const body = el("bibBody");
    const useSelected = selected.size > 0;
    const showCite = bibTab === "cite";
    el("tabBib").classList.toggle("active", !showCite);
    el("tabCite").classList.toggle("active", showCite);
    const project = currentProject();
    const targets = entriesFor(useSelected ? selected : null);
    if (targets.length === 0) {
        paintBib(body, [], showCite, useSelected);
        return;
    }
    const styleId = project?.styleId ?? "";
    const doc = styleId ? cachedDoc(styleId) : null;
    if (doc || !project) {
        paintBib(body, formatWithStyle(targets, doc), showCite, useSelected);
        return;
    }
    const requestId = ++bibRequestId;
    body.innerHTML = `<p class="subtle">Loading citation style…</p>`;
    void ensureDoc(styleId).then((loaded) => {
        if (requestId !== bibRequestId)
            return;
        paintBib(body, formatWithStyle(targets, loaded), showCite, useSelected);
    });
}
function renderProject() {
    const project = currentProject();
    if (!project) {
        show("projectsView");
        renderProjects();
        return;
    }
    el("crumbName").textContent = project.name;
    el("projectTitle").textContent = project.name;
    el("styleBtn").textContent = project.styleTitle || "Citation style";
    const all = getRefs(project.id);
    el("refCount").textContent = `${all.length} refs`;
    const list = el("refList");
    list.innerHTML = "";
    const rows = filteredSortedRefs();
    const isActive = getState().settings.activeProjectId === project.id;
    el("setActiveBtn").textContent = isActive ? "★ In use" : "☆ Quick-save";
    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.innerHTML = all.length
            ? "<h2>No matching references</h2><p class=\"subtle\">Try a different search.</p>"
            : "<h2>No references yet</h2><p class=\"subtle\">Add one manually, import by DOI/ISBN, or save the current tab.</p>";
        list.appendChild(empty);
    }
    for (const ref of rows) {
        const article = document.createElement("div");
        article.className = "ref-card" + (selected.has(ref.id) ? " selected" : "");
        const families = (ref.authors ?? [])
            .map((author) => author.family)
            .filter(Boolean)
            .join(", ");
        article.innerHTML =
            `<input type="checkbox" ${selected.has(ref.id) ? "checked" : ""} aria-label="Select" />` +
                `<span class="type-badge">${esc(typeLabels[ref.type] ?? ref.type)}</span>` +
                `<div class="ref-main"><h3>${esc(ref.title)}</h3>` +
                `<p class="subtle">${esc([families, ref.year].filter(Boolean).join(" · "))}</p>` +
                ((ref.tags ?? []).length
                    ? `<div class="tag-row">${ref.tags.slice(0, 4).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>`
                    : "") +
                `</div>` +
                `<div class="row"><button class="btn btn-ghost btn-sm" data-act="cite">Cite</button>` +
                `<button class="btn btn-ghost btn-sm" data-act="edit">Edit</button>` +
                `<button class="btn btn-danger btn-sm" data-act="del">Del</button></div>`;
        const box = article.getElementsByTagName("input")[0];
        box?.addEventListener("change", () => {
            if (box.checked)
                selected.add(ref.id);
            else
                selected.delete(ref.id);
            renderProject();
        });
        article.querySelectorAll("button").forEach((button) => button.addEventListener("click", (event) => {
            event.stopPropagation();
            const act = button.dataset.act;
            if (act === "cite")
                void copyText(inText(ref), "In-text citation copied.");
            else if (act === "edit")
                openRefDialog(ref);
            else if (act === "del")
                void deleteRefs([ref.id]);
        }));
        list.appendChild(article);
    }
    const bar = el("selectionBar");
    bar.hidden = selected.size === 0;
    el("selCount").textContent = `${selected.size} selected`;
    renderBib();
}
const cslMem = new Map();
function cachedDoc(styleId) {
    const mem = cslMem.get(styleId);
    if (mem)
        return mem;
    const stored = getState().cslStyles[styleId];
    if (stored?.xml) {
        const doc = {
            title: stored.title,
            xml: stored.xml,
            locales: stored.locales,
        };
        cslMem.set(styleId, doc);
        return doc;
    }
    return null;
}
function cacheDoc(styleId, doc) {
    cslMem.set(styleId, doc);
    const st = getState();
    st.cslStyles[styleId] = { ...doc, at: Date.now() };
    void saveState(st);
}
async function ensureDoc(styleId) {
    const cached = cachedDoc(styleId);
    if (cached)
        return cached;
    const bundled = await loadBundledStyle(styleId);
    if (bundled) {
        cacheDoc(styleId, bundled);
        return bundled;
    }
    const st = getState();
    const base = serverBase(st.settings.serverUrl);
    if (base && st.settings.token) {
        try {
            const remote = await fetchServerStyle(base, st.settings.token, styleId);
            if (remote.xml) {
                const doc = {
                    title: remote.title,
                    xml: remote.xml,
                    locales: remote.locales,
                };
                cacheDoc(styleId, doc);
                return doc;
            }
        }
        catch {
        }
    }
    return null;
}
let styleQuery = "";
let styleServerResults = [];
let styleSearchLoading = false;
let styleSaving = false;
let styleRequestId = 0;
let styleSearchTimer;
function styleSourceBadge(styleId) {
    if (bundledStyles.some((style) => style.id === styleId))
        return "bundled";
    if (cachedDoc(styleId))
        return "saved";
    return "server";
}
function renderStyleList() {
    const list = el("styleList");
    list.innerHTML = "";
    const term = styleQuery.trim().toLowerCase();
    const bundled = bundledStyles.filter((style) => !term ||
        style.title.toLowerCase().includes(term) ||
        style.id.toLowerCase().includes(term));
    const server = styleServerResults.filter((style) => !bundled.some((local) => local.id === style.id));
    const project = currentProject();
    const renderRow = (summary, source, downloadable) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
            "style-result" + (project?.styleId === summary.id ? " active" : "");
        button.disabled = styleSaving;
        button.innerHTML =
            `<span class="style-result-main">` +
                `<span class="style-result-title">${esc(summary.title)}</span>` +
                `<span class="style-result-meta">${esc(summary.id)} · ${source}</span>` +
                `</span>` +
                `<span class="style-result-action">${project?.styleId === summary.id
                    ? "Current"
                    : downloadable
                        ? "Download & use"
                        : "Use"}</span>`;
        button.addEventListener("click", () => void chooseStyle(summary));
        list.appendChild(button);
    };
    for (const style of bundled)
        renderRow(style, "bundled · offline", false);
    for (const style of server) {
        renderRow(style, cachedDoc(style.id) ? "saved" : "server", !cachedDoc(style.id) && !bundledStyles.some((local) => local.id === style.id));
    }
    if (styleSearchLoading) {
        const loading = document.createElement("p");
        loading.className = "subtle small";
        loading.textContent = "Searching server styles…";
        list.appendChild(loading);
    }
    if (bundled.length === 0 && server.length === 0 && !styleSearchLoading) {
        const empty = document.createElement("p");
        empty.className = "subtle small";
        empty.textContent = term
            ? "No styles match. Connect the server to search all 10,000+ CSL styles."
            : "No styles found.";
        list.appendChild(empty);
    }
}
async function loadServerStyles(query) {
    const requestId = ++styleRequestId;
    const st = getState();
    const base = serverBase(st.settings.serverUrl);
    if (!base || !st.settings.token) {
        styleServerResults = [];
        styleSearchLoading = false;
        renderStyleList();
        return;
    }
    styleSearchLoading = true;
    renderStyleList();
    try {
        const results = await searchServerStyles(base, st.settings.token, query);
        if (requestId === styleRequestId)
            styleServerResults = results;
    }
    catch {
        if (requestId === styleRequestId)
            styleServerResults = [];
    }
    finally {
        if (requestId === styleRequestId) {
            styleSearchLoading = false;
            renderStyleList();
        }
    }
}
function openStyleDialog() {
    styleQuery = "";
    styleServerResults = [];
    el("styleQuery").value = "";
    el("styleModal").hidden = false;
    renderStyleList();
    void loadServerStyles("");
}
function updateStyleQuery(value) {
    styleQuery = value;
    if (styleSearchTimer)
        clearTimeout(styleSearchTimer);
    styleSearchTimer = setTimeout(() => void loadServerStyles(value), 250);
    renderStyleList();
}
async function chooseStyle(summary) {
    const project = currentProject();
    if (!project || styleSaving)
        return;
    if (project.styleId === summary.id) {
        el("styleModal").hidden = true;
        return;
    }
    styleSaving = true;
    renderStyleList();
    try {
        let title = summary.title;
        if (!cachedDoc(summary.id)) {
            const doc = await ensureDoc(summary.id);
            if (!doc) {
                toast("Could not load that style (offline?).", "error");
                return;
            }
            title = doc.title || summary.title;
        }
        const st = getState();
        const target = st.projects.find((p) => p.id === project.id);
        if (target) {
            target.styleId = summary.id;
            target.styleTitle = title;
            target.updatedAt = nowIso();
        }
        await saveState(st);
        markDirty();
        el("styleModal").hidden = true;
        toast(`Citation style changed to ${title}.`, "success");
        renderProject();
    }
    finally {
        styleSaving = false;
        renderStyleList();
    }
}
function openProjectDialog(project) {
    editingProjectId = project ? project.id : null;
    el("projectModalTitle").textContent = project ? "Edit project" : "New project";
    el("projName").value = project ? project.name : "";
    el("projDesc").value = project ? project.description || "" : "";
    el("projectModal").hidden = false;
}
async function saveProjectDialog() {
    const st = getState();
    const name = el("projName").value.trim();
    const description = el("projDesc").value.trim().slice(0, 500);
    if (!name) {
        toast("Give your project a name.", "error");
        return;
    }
    if (editingProjectId) {
        const project = st.projects.find((p) => p.id === editingProjectId);
        if (project) {
            project.name = name;
            project.description = description;
            project.updatedAt = nowIso();
        }
    }
    else {
        const project = {
            id: uid(),
            name,
            description,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            serverId: null,
            ...defaultStyle(),
        };
        st.projects.push(project);
        st.refsByProject[project.id] = [];
    }
    await saveState(st);
    markDirty();
    el("projectModal").hidden = true;
    renderProjects();
    if (currentProjectId)
        renderProject();
    toast("Project saved.", "success");
}
async function deleteProject(id) {
    const st = getState();
    const project = st.projects.find((p) => p.id === id);
    if (!project)
        return;
    if (!confirm(`Delete "${project.name}" and all of its references?`))
        return;
    if (project.serverId &&
        !st.deletedServerProjectIds.includes(project.serverId)) {
        st.deletedServerProjectIds.push(project.serverId);
    }
    st.projects = st.projects.filter((p) => p.id !== id);
    delete st.refsByProject[id];
    if (currentProjectId === id) {
        currentProjectId = null;
        selected = new Set();
        show("projectsView");
    }
    await saveState(st);
    markDirty();
    renderProjects();
}
function openProject(id) {
    currentProjectId = id;
    selected = new Set();
    bibTab = "bib";
    const st = getState();
    st.settings.activeProjectId = id;
    void saveState(st);
    show("projectView");
    renderProject();
}
function fillTypeOptions() {
    el("typeFilter").innerHTML =
        '<option value="all">All types</option>' +
            referenceTypes.map((t) => `<option value="${t}">${typeLabels[t]}</option>`).join("");
    el("fType").innerHTML = referenceTypes.map((t) => `<option value="${t}">${typeLabels[t]}</option>`).join("");
}
function openRefDialog(ref, preset) {
    editingRefId = ref ? ref.id : null;
    el("refModalTitle").textContent = ref ? "Edit reference" : "New reference";
    el("refError").hidden = true;
    const draft = ref
        ? {
            ...ref,
            authors: ref.authors.map((a) => ({ ...a })),
            editors: (ref.editors ?? []).map((e) => ({ ...e })),
            tags: [...(ref.tags ?? [])],
        }
        : { ...emptyDraft("book"), ...(preset ?? {}) };
    el("fType").value = draft.type;
    el("fTitle").value = draft.title ?? "";
    el("fYear").value = draft.year ?? "";
    el("fAuthors").value = peopleToText(draft.authors);
    el("fEditors").value = peopleToText(draft.editors);
    el("fContainer").value = draft.containerTitle ?? "";
    el("fPublisher").value = draft.publisher ?? "";
    el("fPlace").value = draft.place ?? "";
    el("fVolume").value = draft.volume ?? "";
    el("fIssue").value = draft.issue ?? "";
    el("fPages").value = draft.pages ?? "";
    el("fEdition").value = draft.edition ?? "";
    el("fDoi").value = draft.doi ?? "";
    el("fUrl").value = draft.url ?? "";
    el("fAccessed").value = draft.accessedDate ?? "";
    el("fPubdate").value = draft.publicationDate ?? "";
    el("fTags").value = (draft.tags ?? []).join(", ");
    el("fNotes").value = draft.notes ?? "";
    el("refModal").hidden = false;
}
function readRefDraft() {
    const err = el("refError");
    const title = el("fTitle").value.trim();
    if (!title) {
        err.textContent = "A title is required.";
        err.hidden = false;
        return null;
    }
    const accessed = el("fAccessed").value.trim();
    if (accessed && !/^\d{4}-\d{2}-\d{2}$/.test(accessed)) {
        err.textContent = "Accessed date must be YYYY-MM-DD.";
        err.hidden = false;
        return null;
    }
    return {
        type: el("fType").value,
        title,
        year: el("fYear").value.trim(),
        authors: parsePeople(el("fAuthors").value),
        editors: parsePeople(el("fEditors").value),
        containerTitle: el("fContainer").value.trim(),
        publisher: el("fPublisher").value.trim(),
        place: el("fPlace").value.trim(),
        volume: el("fVolume").value.trim(),
        issue: el("fIssue").value.trim(),
        pages: el("fPages").value.trim(),
        edition: el("fEdition").value.trim(),
        doi: el("fDoi").value.trim(),
        url: el("fUrl").value.trim(),
        accessedDate: accessed || null,
        publicationDate: el("fPubdate").value.trim(),
        tags: el("fTags")
            .value.split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        notes: el("fNotes").value.trim(),
    };
}
async function saveRefDialog() {
    if (!currentProjectId)
        return;
    const draft = readRefDraft();
    if (!draft)
        return;
    const st = getState();
    const list = st.refsByProject[currentProjectId] ?? [];
    if (editingRefId) {
        const index = list.findIndex((ref) => ref.id === editingRefId);
        if (index >= 0)
            list[index] = { ...list[index], ...draft, updatedAt: nowIso() };
    }
    else {
        list.push({
            id: uid(),
            projectId: currentProjectId,
            ...draft,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        });
    }
    st.refsByProject[currentProjectId] = list;
    touchProject(currentProjectId);
    await saveState(st);
    markDirty();
    el("refModal").hidden = true;
    renderProject();
    toast("Reference saved.", "success");
}
async function deleteRefs(ids) {
    if (!currentProjectId || ids.length === 0)
        return;
    if (!confirm(ids.length === 1
        ? "Delete this reference?"
        : `Delete these ${ids.length} references?`))
        return;
    const st = getState();
    const doomed = new Set(ids);
    for (const ref of getRefs(currentProjectId)) {
        if (doomed.has(ref.id) &&
            ref.serverId &&
            !st.deletedServerRefIds.includes(ref.serverId)) {
            st.deletedServerRefIds.push(ref.serverId);
        }
    }
    st.refsByProject[currentProjectId] = getRefs(currentProjectId).filter((ref) => !doomed.has(ref.id));
    selected = new Set([...selected].filter((id) => !doomed.has(id)));
    touchProject(currentProjectId);
    await saveState(st);
    markDirty();
    renderProject();
    toast("Deleted.", "success");
}
async function handleImport() {
    const input = el("importInput");
    const value = input.value.trim();
    if (!value || importBusy)
        return;
    importBusy = true;
    try {
        const { source, draft } = await doLookup(value);
        input.value = "";
        openRefDialog(null, draft);
        toast(`Imported from ${source}. Review and save.`, "success");
    }
    catch (error) {
        toast(error instanceof Error ? error.message : "Import failed.", "error");
    }
    finally {
        importBusy = false;
    }
}
async function handleSaveTab() {
    try {
        const draft = await saveCurrentTab();
        openRefDialog(null, draft);
        toast("Tab captured. Review and save.", "success");
    }
    catch (error) {
        toast(error instanceof Error ? error.message : "Could not save this tab.", "error");
    }
}
async function exportCurrent() {
    const format = el("exportFormat").value;
    const entries = await currentEntries(selected.size ? selected : null);
    const project = currentProject();
    const base = (project ? project.name : "references")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60) || "references";
    const byId = new Map(getRefs(currentProjectId).map((ref) => [ref.id, ref]));
    const rows = entries
        .map((entry) => byId.get(entry.id))
        .filter((ref) => Boolean(ref));
    if (format === "ris") {
        download(`${base}.ris`, toRis(rows), "application/x-research-info-systems");
    }
    else if (format === "bibtex") {
        download(`${base}.bib`, toBibtex(rows), "application/x-bibtex");
    }
    else if (format === "html") {
        const items = entries.map((entry) => `      <li>${entry.html}</li>`).join("\n");
        download(`${base}.html`, "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\" />" +
            `<title>${esc(project ? project.name : "References")}</title></head>\n<body>\n` +
            `<h1>${esc(project ? project.name : "References")}</h1>\n<ul>\n${items}\n</ul>\n</body>\n</html>`, "text/html");
    }
    else {
        download(`${base}.txt`, entries.map((entry) => entry.plain).join("\n\n") + "\n", "text/plain");
    }
}
function syncReady() {
    const st = getState();
    return Boolean(serverBase(st.settings.serverUrl) && st.settings.token);
}
function fmtSyncTime(iso) {
    if (!iso)
        return "never";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "never";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function renderSyncStatus(note) {
    const st = getState();
    const base = serverBase(st.settings.serverUrl);
    let text;
    if (!base) {
        text = "Set a server URL to enable sync.";
    }
    else if (!st.settings.token) {
        text = `Server set (${base}). Log in once to connect.`;
    }
    else if (note) {
        text = note;
    }
    else if (dirty) {
        text = `Connected as ${st.settings.serverUser ?? "user"} — unsynced changes.`;
    }
    else {
        text = `Connected as ${st.settings.serverUser ?? "user"} — synced ${fmtSyncTime(st.settings.lastSyncedAt)}.`;
    }
    el("syncStatus").textContent = text;
    const active = st.projects.find((p) => p.id === st.settings.activeProjectId);
    el("quickSaveInfo").textContent = active
        ? `Quick-save shortcut (Ctrl+Shift+S) files new tabs into “${active.name}”.`
        : "Quick-save shortcut (Ctrl+Shift+S): open a project to choose where new tabs are saved.";
}
async function runPull(manual) {
    if (!syncReady() || syncing)
        return;
    syncing = true;
    if (!manual)
        renderSyncStatus("Syncing…");
    try {
        const st = getState();
        const result = await pullMerge(st, serverBase(st.settings.serverUrl), st.settings.token ?? "");
        await saveState(st);
        renderProjects();
        if (currentProjectId)
            renderProject();
        renderSyncStatus();
        if (manual)
            toast(`Synced ${result.projects} project(s).`, "success");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed.";
        if (manual) {
            toast(message, "error");
            renderSyncStatus();
        }
        else {
            renderSyncStatus(`Sync failed: ${message}`);
        }
    }
    finally {
        syncing = false;
    }
}
async function runPush(manual) {
    if (!syncReady() || syncing)
        return;
    if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = undefined;
    }
    syncing = true;
    if (!manual)
        renderSyncStatus("Syncing…");
    try {
        const st = getState();
        await pushAll(st, serverBase(st.settings.serverUrl), st.settings.token ?? "");
        dirty = false;
        st.needsPush = false;
        await saveState(st);
        renderSyncStatus();
        if (manual)
            toast("Pushed to server.", "success");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Push failed.";
        if (manual) {
            toast(message, "error");
            renderSyncStatus();
        }
        else {
            dirty = true;
            renderSyncStatus(`Sync failed: ${message}`);
        }
    }
    finally {
        syncing = false;
    }
}
function markDirty() {
    if (!syncReady())
        return;
    dirty = true;
    const st = getState();
    st.needsPush = true;
    void saveState(st);
    renderSyncStatus();
    if (pushTimer)
        clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void runPush(false), 4000);
}
const fallbackShortcuts = [
    {
        name: "save-tab",
        description: "Save the current tab as a reference in the active project",
        shortcut: "",
    },
];
function shortcutLabel(name) {
    if (name === "save-tab")
        return "Save current tab";
    return name || "Shortcut";
}
async function renderShortcuts() {
    const list = el("shortcutList");
    list.innerHTML = "";
    let commands = [];
    try {
        if (typeof chrome !== "undefined" && chrome.commands?.getAll) {
            commands = await chrome.commands.getAll();
        }
    }
    catch {
        commands = [];
    }
    if (commands.length === 0)
        commands = fallbackShortcuts;
    for (const command of commands) {
        const row = document.createElement("div");
        row.className = "cite-row";
        row.style.alignItems = "center";
        const label = document.createElement("div");
        label.style.minWidth = "0";
        const title = document.createElement("div");
        title.style.fontWeight = "650";
        title.textContent = shortcutLabel(command.name);
        const desc = document.createElement("div");
        desc.className = "subtle small";
        desc.textContent = command.description || "";
        label.appendChild(title);
        label.appendChild(desc);
        const chip = document.createElement("span");
        chip.className = "count-chip";
        chip.textContent = command.shortcut || "not set";
        row.appendChild(label);
        row.appendChild(chip);
        list.appendChild(row);
    }
}
document.addEventListener("DOMContentLoaded", () => {
    void (async () => {
        state = await loadState();
        applyTheme(state.settings.theme);
        fillTypeOptions();
        renderSyncStatus();
        el("serverUrl").value = state.settings.serverUrl ?? "";
        try {
            const storedSort = localStorage.getItem(projectSortKey);
            if (storedSort === "edited" ||
                storedSort === "name-az" ||
                storedSort === "name-za" ||
                storedSort === "refs" ||
                storedSort === "created") {
                el("projectSort").value = storedSort;
            }
        }
        catch {
        }
        el("themeSelect").addEventListener("change", (event) => {
            const value = event.currentTarget.value;
            if (!isTheme(value))
                return;
            const st = getState();
            st.settings.theme = value;
            applyTheme(value);
            void saveState(st);
        });
        let settingsReturn = "projectsView";
        el("settingsBtn").addEventListener("click", () => {
            settingsReturn = el("projectView").hidden ? "projectsView" : "projectView";
            show("settingsView");
            void renderShortcuts();
        });
        el("settingsBack").addEventListener("click", () => {
            if (settingsReturn === "projectView" && currentProject()) {
                show("projectView");
                renderProject();
            }
            else {
                show("projectsView");
                renderProjects();
            }
        });
        el("newProjectBtn").addEventListener("click", () => openProjectDialog(null));
        el("projectSort").addEventListener("change", (event) => {
            try {
                localStorage.setItem(projectSortKey, event.currentTarget.value);
            }
            catch {
            }
            renderProjects();
        });
        el("projCancel").addEventListener("click", () => {
            el("projectModal").hidden = true;
        });
        el("projSave").addEventListener("click", () => void saveProjectDialog());
        el("backBtn").addEventListener("click", () => {
            currentProjectId = null;
            selected = new Set();
            show("projectsView");
            renderProjects();
        });
        el("setActiveBtn").addEventListener("click", () => {
            if (!currentProjectId)
                return;
            const st = getState();
            st.settings.activeProjectId =
                st.settings.activeProjectId === currentProjectId ? null : currentProjectId;
            void saveState(st).then(() => {
                renderProject();
                renderSyncStatus();
            });
        });
        el("addRefBtn").addEventListener("click", () => openRefDialog(null));
        el("refCancel").addEventListener("click", () => {
            el("refModal").hidden = true;
        });
        el("refSave").addEventListener("click", () => void saveRefDialog());
        for (const id of ["searchInput", "typeFilter", "sortSelect"]) {
            el(id).addEventListener("input", renderProject);
            el(id).addEventListener("change", renderProject);
        }
        el("importBtn").addEventListener("click", () => void handleImport());
        el("importInput").addEventListener("keydown", (event) => {
            if (event.key === "Enter")
                void handleImport();
        });
        el("saveTabBtn").addEventListener("click", () => void handleSaveTab());
        el("tabBib").addEventListener("click", () => {
            bibTab = "bib";
            renderProject();
        });
        el("tabCite").addEventListener("click", () => {
            bibTab = "cite";
            renderProject();
        });
        el("styleBtn").addEventListener("click", openStyleDialog);
        el("styleClose").addEventListener("click", () => {
            el("styleModal").hidden = true;
        });
        el("styleModal").addEventListener("click", (event) => {
            if (event.target === el("styleModal"))
                el("styleModal").hidden = true;
        });
        el("styleQuery").addEventListener("input", (event) => updateStyleQuery(event.currentTarget.value));
        el("copyAllBtn").addEventListener("click", () => {
            void currentEntries(selected.size ? selected : null).then((entries) => {
                if (!entries.length) {
                    toast("Add a reference first.", "error");
                    return;
                }
                void copyText(entries.map((entry) => entry.plain).join("\n\n"), "Bibliography copied.");
            });
        });
        el("downloadBtn").addEventListener("click", () => void exportCurrent());
        el("copyBibSel").addEventListener("click", () => {
            void currentEntries(selected).then((entries) => copyText(entries.map((entry) => entry.plain).join("\n\n"), `Copied ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`));
        });
        el("clearSel").addEventListener("click", () => {
            selected = new Set();
            renderProject();
        });
        el("delSel").addEventListener("click", () => void deleteRefs([...selected]));
        el("dupSel").addEventListener("click", () => {
            if (!selected.size)
                return;
            const st = getState();
            const others = st.projects.filter((p) => p.id !== currentProjectId);
            if (!others.length) {
                toast("No other project to duplicate into.", "error");
                return;
            }
            const names = others.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
            const choice = prompt(`Duplicate ${selected.size} reference(s) into:\n${names}\nEnter number:`);
            const target = others[Number(choice) - 1];
            if (!target)
                return;
            const source = new Map(getRefs(currentProjectId).map((r) => [r.id, r]));
            const dest = getRefs(target.id);
            for (const id of selected) {
                const ref = source.get(id);
                if (ref) {
                    dest.push({
                        ...JSON.parse(JSON.stringify(ref)),
                        id: uid(),
                        projectId: target.id,
                        createdAt: nowIso(),
                        updatedAt: nowIso(),
                    });
                }
            }
            touchProject(target.id);
            void saveState(st).then(() => {
                toast(`Duplicated into “${target.name}”.`, "success");
                markDirty();
            });
        });
        el("serverUrl").addEventListener("change", (event) => {
            const st = getState();
            st.settings.serverUrl = event.currentTarget.value.trim();
            void saveState(st).then(() => renderSyncStatus());
        });
        el("loginBtn").addEventListener("click", () => {
            const st = getState();
            const base = serverBase(el("serverUrl").value.trim());
            const username = el("syncUser").value.trim();
            const password = el("syncPass").value;
            st.settings.serverUrl = base;
            renderSyncStatus("Connecting…");
            void mintToken(base, username, password)
                .then(async ({ token, username: name }) => {
                st.settings.token = token.token;
                st.settings.tokenId = token.id;
                st.settings.serverUser = name;
                el("syncPass").value = "";
                await saveState(st);
                renderSyncStatus();
                toast(`Connected as ${name}.`, "success");
                await runPull(true);
            })
                .catch((error) => {
                toast(error instanceof Error ? error.message : "Login failed.", "error");
                renderSyncStatus();
            });
        });
        el("logoutBtn").addEventListener("click", () => {
            const st = getState();
            const base = serverBase(st.settings.serverUrl);
            const token = st.settings.token ?? "";
            if (pushTimer) {
                clearTimeout(pushTimer);
                pushTimer = undefined;
            }
            dirty = false;
            void revokeToken(base, token).then(async () => {
                st.settings.token = null;
                st.settings.tokenId = null;
                st.settings.serverUser = null;
                st.settings.lastSyncedAt = null;
                await saveState(st);
                renderSyncStatus();
                toast("Disconnected.", "success");
            });
        });
        el("useKeyBtn").addEventListener("click", () => {
            const st = getState();
            const base = serverBase(el("serverUrl").value.trim());
            const pasted = el("apiKey").value.trim();
            st.settings.serverUrl = base;
            renderSyncStatus("Checking key…");
            void validateToken(base, pasted)
                .then(async ({ username, tokenId }) => {
                st.settings.token = pasted;
                st.settings.tokenId = tokenId;
                st.settings.serverUser = username;
                el("apiKey").value = "";
                el("syncPass").value = "";
                await saveState(st);
                renderSyncStatus();
                toast(`Connected as ${username}.`, "success");
                await runPull(true);
            })
                .catch((error) => {
                toast(error instanceof Error ? error.message : "Invalid key.", "error");
                renderSyncStatus();
            });
        });
        el("pullBtn").addEventListener("click", () => void runPull(true));
        el("pushBtn").addEventListener("click", () => void runPush(true));
        el("editShortcutsBtn").addEventListener("click", () => {
            void copyText("chrome://extensions/shortcuts", "Address copied — paste it into the address bar to edit shortcuts.");
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                if (!el("refModal").hidden) {
                    el("refModal").hidden = true;
                    return;
                }
                if (!el("projectModal").hidden) {
                    el("projectModal").hidden = true;
                    return;
                }
                if (!el("styleModal").hidden) {
                    el("styleModal").hidden = true;
                    return;
                }
                if (!el("settingsView").hidden) {
                    el("settingsBack").click();
                    return;
                }
                if (!el("projectView").hidden) {
                    el("backBtn").click();
                }
                return;
            }
            if (event.key === "/" && !el("projectView").hidden && el("refModal").hidden) {
                const target = event.target;
                if (target &&
                    (target.tagName === "INPUT" ||
                        target.tagName === "TEXTAREA" ||
                        target.tagName === "SELECT" ||
                        target.isContentEditable)) {
                    return;
                }
                event.preventDefault();
                el("searchInput").focus();
            }
        });
        el("exportAllBtn").addEventListener("click", () => {
            const st = getState();
            download("myref-backup.json", JSON.stringify({ projects: st.projects, refsByProject: st.refsByProject, exportedAt: nowIso() }, null, 2), "application/json");
        });
        el("wipeBtn").addEventListener("click", () => {
            if (!confirm("Delete ALL local projects and references on this device? (Server copies stay until the next sync pulls them back.)"))
                return;
            const st = getState();
            st.projects = [];
            st.refsByProject = {};
            st.deletedServerRefIds = [];
            st.deletedServerProjectIds = [];
            st.needsPush = false;
            dirty = false;
            currentProjectId = null;
            selected = new Set();
            void saveState(st).then(() => {
                show("projectsView");
                renderProjects();
                renderSyncStatus();
            });
        });
        renderProjects();
        try {
            chrome.action?.setBadgeText?.({ text: "" });
        }
        catch {
        }
        void (async () => {
            await runPull(false);
            if (getState().needsPush)
                await runPush(false);
        })();
        setInterval(() => {
            if (dirty)
                void runPush(false);
            else
                void runPull(false);
        }, 60000);
    })();
});
//# sourceMappingURL=app.js.map