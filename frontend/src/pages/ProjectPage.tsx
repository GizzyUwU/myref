import { A, Navigate, useParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { api, ApiError, exportUrl } from "../api";
import { AppShell } from "../components/AppShell";
import { ReferenceDialog } from "../components/ReferenceDialog";
import { downloadUrl, referenceMeta } from "../format";
import { auth } from "../store/auth";
import { toast } from "../store/toast";
import {
  defaultBibFont,
  referenceTypes,
  typeLabels,
  emptyDraft,
  toDraft,
  type CslStyleSummary,
  type Project,
  type Reference,
  type ReferenceDraft,
  type ReferenceType,
} from "../types";

type ExportFormat = "text" | "html" | "ris" | "bibtex";

export function ProjectPage() {
  const params = useParams();
  const projectId = () => params.id ?? "";

  const [projectResource, { refetch: refetchProject }] = createResource(
    projectId,
    async (id) => (await api.project(id)).project,
  );

  const [referencesResource, { refetch: refetchReferences }] = createResource(
    projectId,
    async (id) => (await api.references(id)).references,
  );

  const [bibliographyResource, { refetch: refetchBibliography }] =
    createResource(projectId, async (id) => api.bibliography(id));

  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal<"all" | ReferenceType>("all");
  type SortKey =
    | "auto"
    | "pub-new"
    | "pub-old"
    | "title-az"
    | "title-za"
    | "added-new"
    | "added-old";
  const sortStorageKey = () => `myref:sort:${projectId()}`;
  const initialSort = (): SortKey => {
    try {
      const stored = localStorage.getItem(sortStorageKey());
      if (
        stored === "auto" ||
        stored === "pub-new" ||
        stored === "pub-old" ||
        stored === "title-az" ||
        stored === "title-za" ||
        stored === "added-new" ||
        stored === "added-old"
      )
        return stored;
    } catch {
    }
    return "auto";
  };
  const [sortKey, setSortKey] = createSignal<SortKey>(initialSort());
  function changeSort(value: SortKey) {
    setSortKey(value);
    try {
      localStorage.setItem(sortStorageKey(), value);
    } catch {
    }
  }
  createEffect(() => {
    projectId();
    setSortKey(initialSort());
  });
  const [tab, setTab] = createSignal<"bibliography" | "in-text">("bibliography");
  const [exportFormat, setExportFormat] = createSignal<ExportFormat>("text");
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Reference | null>(null);
  const [styleDialogOpen, setStyleDialogOpen] = createSignal(false);
  const [styleQuery, setStyleQuery] = createSignal("");
  const [styleResults, setStyleResults] = createSignal<CslStyleSummary[]>(
    [],
  );
  const [styleSearchLoading, setStyleSearchLoading] = createSignal(false);
  const [styleSaving, setStyleSaving] = createSignal(false);

  // Virtualized style list: the catalog holds ~11k styles, so only the
  // visible rows are mounted. Row heights are measured dynamically.
  let styleScrollEl!: HTMLDivElement;
  const styleVirtualizer = createVirtualizer({
    get count() {
      return styleResults().length;
    },
    getScrollElement: () => styleScrollEl,
    estimateSize: () => 84,
    overscan: 8,
    getItemKey: (index) => styleResults()[index]?.id ?? index,
  });

  const [importValue, setImportValue] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [importError, setImportError] = createSignal("");
  const [importedDraft, setImportedDraft] = createSignal<ReferenceDraft | null>(null);
  const [copyFont, setCopyFont] = createSignal(defaultBibFont);
  const [fontSaving, setFontSaving] = createSignal(false);

  createEffect(() => {
    const font = projectResource()?.fontFamily;
    if (font) setCopyFont(font);
  });

  async function changeFont(value: string) {
    const previous = copyFont();
    setCopyFont(value);
    try {
      localStorage.setItem(`myref:font:${projectId()}`, value);
    } catch {
    }
    if (value === projectResource()?.fontFamily) return;
    setFontSaving(true);
    try {
      await api.updateProject(projectId(), { fontFamily: value });
      void refetchProject();
    } catch (caught) {
      setCopyFont(previous);
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not save font.",
        "error",
      );
    } finally {
      setFontSaving(false);
    }
  }

  function pubTime(reference: Reference): number | null {
    const pub = (reference.publicationDate ?? "").trim();
    if (pub) {
      const parsed = Date.parse(pub);
      if (!Number.isNaN(parsed)) return parsed;
      const yearMatch = pub.match(/(\d{4})/);
      if (yearMatch) return Date.UTC(Number(yearMatch[1]), 0, 1);
    }
    const yearMatch = (reference.year ?? "").match(/(\d{4})/);
    if (yearMatch) return Date.UTC(Number(yearMatch[1]), 0, 1);
    return null;
  }

  function addedTime(reference: Reference): number {
    const parsed = Date.parse(reference.createdAt ?? "");
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const filteredReferences = createMemo(() => {
    const term = search().trim().toLowerCase();
    const filter = typeFilter();
    const sort = sortKey();

    const list = (referencesResource() ?? []).filter((reference) => {
      if (filter !== "all" && reference.type !== filter) return false;
      if (!term) return true;

      const haystack = [
        reference.title,
        reference.containerTitle,
        reference.publisher,
        reference.doi,
        reference.year,
        ...reference.authors.flatMap((author) => [
          author.family,
          author.given ?? "",
        ]),
        ...reference.tags,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });

    const sorted = [...list];
    switch (sort) {
      case "pub-new":
      case "pub-old": {
        const dir = sort === "pub-new" ? -1 : 1;
        sorted.sort((a, b) => {
          const ta = pubTime(a);
          const tb = pubTime(b);
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return (ta - tb) * dir;
        });
        break;
      }
      case "title-az":
        sorted.sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        );
        break;
      case "title-za":
        sorted.sort((a, b) =>
          b.title.localeCompare(a.title, undefined, { sensitivity: "base" }),
        );
        break;
      case "added-new":
        sorted.sort((a, b) => addedTime(b) - addedTime(a));
        break;
      case "added-old":
        sorted.sort((a, b) => addedTime(a) - addedTime(b));
        break;
      case "auto":
      default:
        break;
    }
    return sorted;
  });

  const bibliography = () => bibliographyResource();
  const entries = () => bibliography()?.entries ?? [];

  const citationFor = (referenceId: string) =>
    bibliography()?.citations.find((citation) => citation.id === referenceId)
      ?.inText ?? "";

  // Multi-select: checkboxes on each card feed a shared id set, so the
  // selection bar can copy just those references.
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(
    new Set<string>(),
  );
  const isSelected = (id: string) => selectedIds().has(id);

  function toggleSelected(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection(): void {
    setSelectedIds(new Set<string>());
  }

  // "Select all" targets the currently visible (filtered) references and
  // shows an indeterminate state for partial selection.
  let selectAllEl!: HTMLInputElement;

  function toggleSelectAllVisible(): void {
    const visible = filteredReferences();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = visible.every((reference) => prev.has(reference.id));
      for (const reference of visible) {
        if (allSelected) next.delete(reference.id);
        else next.add(reference.id);
      }
      return next;
    });
  }

  createEffect(() => {
    const visible = filteredReferences();
    const selected = selectedIds();
    if (!selectAllEl) return;
    const count = visible.filter((reference) =>
      selected.has(reference.id),
    ).length;
    selectAllEl.checked = visible.length > 0 && count === visible.length;
    selectAllEl.indeterminate = count > 0 && count < visible.length;
  });

  // Selection belongs to one project; drop it when navigating.
  createEffect(() => {
    projectId();
    clearSelection();
  });

  function selectedEntries() {
    const selected = selectedIds();
    if (selected.size === 0) return [];
    return entries().filter((entry) => selected.has(entry.id));
  }

  // Side panel follows the selection: when anything is checked, the
  // bibliography and in-text tabs show only the selected references.
  const visibleEntries = createMemo(() => {
    const selected = selectedIds();
    const all = entries();
    if (selected.size === 0) return all;
    return all.filter((entry) => selected.has(entry.id));
  });
  const visibleCitations = createMemo(() => {
    const selected = selectedIds();
    const all = bibliography()?.citations ?? [];
    if (selected.size === 0) return all;
    return all.filter((citation) => selected.has(citation.id));
  });

  function refreshAll() {
    void refetchReferences();
    void refetchBibliography();
    void refetchProject();
  }

  const looksLikeDoi = (value: string) =>
    /^10\.\d{4,9}\//i.test(value) ||
    /doi\.org/i.test(value) ||
    /^doi:/i.test(value);

  const looksLikeUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  async function doImport() {
    const value = importValue().trim();
    if (!value) return;

    setImporting(true);
    setImportError("");

    try {
      let result;
      if (looksLikeDoi(value)) {
        result = await api.lookupDoi(value);
      } else if (looksLikeUrl(value)) {
        result = await api.lookupUrl(value);
      } else {
        const isbn = value.replace(/[^0-9Xx]/g, "");
        if (isbn.length >= 10) {
          result = await api.lookupIsbn(value);
        } else if (value.startsWith("http")) {
          result = await api.lookupUrl(value);
        } else if (value.includes("doi.org")) {
          result = await api.lookupDoi(value);
        } else {
          result = await api.lookupIsbn(value);
        }
      }

      const ref = result.reference;
      const draft: ReferenceDraft = {
        type: ref.type ?? "website",
        title: ref.title ?? "",
        authors: (ref.authors ?? []).length ? ref.authors : [{ family: "", given: "" }],
        editors: ref.editors ?? [],
        year: ref.year ?? "",
        containerTitle: ref.containerTitle ?? "",
        publisher: ref.publisher ?? "",
        place: ref.place ?? "",
        edition: ref.edition ?? "",
        volume: ref.volume ?? "",
        issue: ref.issue ?? "",
        pages: ref.pages ?? "",
        doi: ref.doi ?? "",
        url: ref.url ?? value,
        accessedDate: ref.accessedDate ?? (ref.type === "website" ? new Date().toISOString().slice(0, 10) : null),
        publicationDate: ref.publicationDate ?? "",
        notes: ref.notes ?? "",
        tags: ref.tags ?? [],
      };
      setImportedDraft(draft);
      setEditing(null);
      setDialogOpen(true);
      toast(`Imported from ${result.source}. Review and save.`, "success");
    } catch (caught) {
      setImportError(
        caught instanceof ApiError
          ? caught.message
          : "Could not import from that URL or identifier.",
      );
    } finally {
      setImporting(false);
    }
  }

  function openCreate() {
    setImportedDraft(null);
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(reference: Reference) {
    setEditing(reference);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  let styleSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let styleRequestId = 0;

  async function loadStyles(query: string) {
    const requestId = ++styleRequestId;
    setStyleSearchLoading(true);

    try {
      const { styles } = await api.searchStyles(query);
      if (requestId === styleRequestId) {
        setStyleResults(styles);
        styleScrollEl?.scrollTo({ top: 0 });
      }
    } catch (caught) {
      if (requestId === styleRequestId) {
        toast(
          caught instanceof ApiError
            ? caught.message
            : "Could not search the official CSL styles.",
          "error",
        );
      }
    } finally {
      if (requestId === styleRequestId) setStyleSearchLoading(false);
    }
  }

  function openStyleDialog() {
    setStyleDialogOpen(true);
    setStyleQuery("");
    clearTimeout(styleSearchTimer);
    void loadStyles("");
  }

  function updateStyleQuery(value: string) {
    setStyleQuery(value);
    clearTimeout(styleSearchTimer);
    styleSearchTimer = setTimeout(() => void loadStyles(value), 250);
  }

  async function chooseStyle(style: CslStyleSummary) {
    if (style.id === projectResource()?.styleId || styleSaving()) return;

    setStyleSaving(true);
    try {
      await api.updateProject(projectId(), { styleId: style.id });
      toast(`Citation style changed to ${style.title}.`, "success");
      setStyleDialogOpen(false);
      refreshAll();
    } catch (caught) {
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not change the citation style.",
        "error",
      );
    } finally {
      setStyleSaving(false);
    }
  }

  async function copyText(value: string, message: string) {
    if (!value) {
      toast("That citation is not ready yet.", "info");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast(message, "success");
    } catch {
      toast("Could not copy to the clipboard.", "error");
    }
  }

  async function writeBibliography(
    items: { html: string; plain: string }[],
    successMessage: string,
  ): Promise<void> {
    const font = copyFont() || "Calibri, Arial, sans-serif";
    const html = items
      .map(
        (entry) =>
          `<div style="font-family: ${font.replace(/"/g, '&quot;')}; font-size: 12pt; line-height: 1.5;">${(entry.html || entry.plain).replace(/\n/g, "<br>")}</div>`,
      )
      .join("<br><br>");

    const plain = items.map((entry) => entry.plain).join("\n\n");

    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        const blob = new Blob([html], { type: "text/html" });
        const textBlob = new Blob([plain], { type: "text/plain" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": blob,
            "text/plain": textBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      toast(successMessage, "success");
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        toast("Bibliography copied as plain text.", "info");
      } catch {
        toast("Could not copy to the clipboard.", "error");
      }
    }
  }

  async function copyBibliography() {
    const items = entries();
    if (items.length === 0) {
      toast("Add a reference first.", "info");
      return;
    }

    await writeBibliography(items, "Bibliography copied.");
  }

  async function copySelectedBibliography() {
    const items = selectedEntries();
    if (items.length === 0) {
      toast("Select at least one reference first.", "info");
      return;
    }

    await writeBibliography(
      items,
      items.length === 1
        ? "Bibliography entry copied."
        : `Bibliography copied (${items.length} references).`,
    );
  }

  async function copySelectedInText() {
    const selected = selectedIds();
    if (selected.size === 0) {
      toast("Select at least one reference first.", "info");
      return;
    }

    const texts = (bibliography()?.citations ?? [])
      .filter((citation) => selected.has(citation.id))
      .map((citation) => citation.inText)
      .filter(Boolean);
    if (texts.length === 0) {
      toast("Those citations are not ready yet.", "info");
      return;
    }

    await copyText(
      texts.join("\n"),
      texts.length === 1
        ? "In-text citation copied."
        : `In-text citations copied (${texts.length}).`,
    );
  }

  function downloadBibliography() {
    if (entries().length === 0) {
      toast("Add a reference first.", "info");
      return;
    }
    downloadUrl(exportUrl(projectId(), exportFormat()));
  }

  const [duplicateOpen, setDuplicateOpen] = createSignal(false);
  const [duplicateTargets, setDuplicateTargets] = createSignal<Project[]>([]);
  const [duplicateLoading, setDuplicateLoading] = createSignal(false);
  const [duplicateSaving, setDuplicateSaving] = createSignal(false);

  async function openDuplicateDialog() {
    if (selectedIds().size === 0) return;
    setDuplicateOpen(true);
    setDuplicateLoading(true);
    try {
      const { projects } = await api.projects();
      setDuplicateTargets(projects.filter((p) => p.id !== projectId()));
    } catch (caught) {
      toast(
        caught instanceof ApiError ? caught.message : "Could not load projects.",
        "error",
      );
      setDuplicateOpen(false);
    } finally {
      setDuplicateLoading(false);
    }
  }

  async function duplicateSelected(project: Project) {
    const ids = [...selectedIds()];
    if (ids.length === 0) return;
    setDuplicateSaving(true);
    try {
      const result = await api.duplicateReferences({
        ids,
        projectId: project.id,
      });
      toast(
        result.references.length === 1
          ? `Duplicated 1 reference to “${project.name}”.`
          : `Duplicated ${result.references.length} references to “${project.name}”.`,
        "success",
      );
      setDuplicateOpen(false);
    } catch (caught) {
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not duplicate references.",
        "error",
      );
    } finally {
      setDuplicateSaving(false);
    }
  }
  async function removeSelected() {
    const ids = [...selectedIds()];
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      ids.length === 1
        ? "Delete this reference? This cannot be undone."
        : `Delete these ${ids.length} references? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      const result = await api.deleteReferences({ ids });
      const deleted = new Set(result.deleted);
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) if (!deleted.has(id)) next.add(id);
        return next;
      });
      toast(
        result.deleted.length === 1
          ? "Reference deleted."
          : `${result.deleted.length} references deleted.`,
        "success",
      );
      refreshAll();
    } catch (caught) {
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not delete references.",
        "error",
      );
    }
  }

  async function removeReference(reference: Reference) {
    const confirmed = window.confirm(`Delete "${reference.title}"?`);
    if (!confirmed) return;

    try {
      await api.deleteReference(reference.id);
      setSelectedIds((prev) => {
        if (!prev.has(reference.id)) return prev;
        const next = new Set(prev);
        next.delete(reference.id);
        return next;
      });
      toast("Reference deleted.", "success");
      refreshAll();
    } catch (caught) {
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not delete reference.",
        "error",
      );
    }
  }

  return (
    <Show when={auth.user()} fallback={<Navigate href="/login" />}>
      <AppShell>
        <Show
          when={projectResource()}
          fallback={
            <Show
              when={projectResource.error}
              fallback={
                <div class="loading-state">
                  <span class="spinner" />
                </div>
              }
            >
              <div class="panel empty-state">
                <h2>Project not found</h2>
                <p class="subtle">
                  It may have been deleted, or the link is incorrect.
                </p>
                <A href="/app" class="btn btn-ghost">
                  Back to projects
                </A>
              </div>
            </Show>
          }
        >
          {(project) => (
            <>
              <div class="workspace-head">
                <nav class="breadcrumb" aria-label="Breadcrumb">
                  <A href="/app">Projects</A>
                  <span>/</span>
                  <span>{project().name}</span>
                </nav>

                <div class="workspace-title-row">
                  <div>
                    <h1 class="page-title">{project().name}</h1>
                    <p class="subtle">
                      {project().description ||
                        "Add your sources and copy a formatted bibliography."}
                    </p>
                  </div>
                  <div class="workspace-actions">
                    <button
                      type="button"
                      class="btn btn-primary"
                      onClick={openCreate}
                    >
                      <span class="plus" aria-hidden="true">
                        +
                      </span>
                      Add reference
                    </button>
                  </div>
                </div>
              </div>

              <div class="workspace-layout">
                <section class="panel ref-panel">
                  <div style="display:flex; gap:8px; align-items:center; margin:12px 12px 0 12px;">
                    <input
                      value={importValue()}
                      onInput={(e)=>setImportValue(e.currentTarget.value)}
                      placeholder="Paste URL, DOI, or ISBN to import from metadata"
                      style="flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:8px;"
                    />
                    <button type="button" class="btn btn-ghost" disabled={importing() || !importValue().trim()} onClick={()=>void doImport()}>
                      {importing() ? "Fetching..." : "Import"}
                    </button>
                  </div>
                  <Show when={importError()}>
                    <p class="form-error" style="margin:6px 12px 0 12px;">{importError()}</p>
                  </Show>
                  <div class="toolbar">
                    <div class="search-wrap">
                      <svg
                        viewBox="0 0 24 24"
                        width="17"
                        height="17"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          cx="11"
                          cy="11"
                          r="6.5"
                          stroke="currentColor"
                          stroke-width="1.8"
                        />
                        <path
                          d="m16 16 4 4"
                          stroke="currentColor"
                          stroke-width="1.8"
                          stroke-linecap="round"
                        />
                      </svg>
                      <input
                        type="search"
                        value={search()}
                        onInput={(event) => setSearch(event.currentTarget.value)}
                        placeholder="Search title, author, DOI or tag"
                        aria-label="Search references"
                      />
                    </div>

                    <div class="toolbar-filters">
                      <select
                        class="filter-select"
                        value={typeFilter()}
                        onChange={(event) =>
                          setTypeFilter(
                            event.currentTarget.value as "all" | ReferenceType,
                          )
                        }
                        aria-label="Filter by reference type"
                      >
                        <option value="all">All types</option>
                        {referenceTypes.map((referenceType) => (
                          <option value={referenceType}>
                            {typeLabels[referenceType]}
                          </option>
                        ))}
                      </select>

                      <select
                        class="filter-select"
                        value={sortKey()}
                        onChange={(event) =>
                          changeSort(
                            event.currentTarget.value as
                              | "auto"
                              | "pub-new"
                              | "pub-old"
                              | "title-az"
                              | "title-za"
                              | "added-new"
                              | "added-old",
                          )
                        }
                        aria-label="Sort references"
                        title="Sort references"
                      >
                        <option value="auto">Auto sort</option>
                        <option value="pub-new">Publish date: newest first</option>
                        <option value="pub-old">Publish date: oldest first</option>
                        <option value="title-az">Title: A to Z</option>
                        <option value="title-za">Title: Z to A</option>
                        <option value="added-new">Date added: newest first</option>
                        <option value="added-old">Date added: oldest first</option>
                      </select>

                      <label class="select-all">
                        <input
                          ref={selectAllEl}
                          type="checkbox"
                          class="ref-select"
                          onChange={toggleSelectAllVisible}
                          aria-label="Select all visible references"
                        />
                        <span>All</span>
                      </label>

                      <span class="count-chip">
                        {filteredReferences().length} of{" "}
                        {referencesResource()?.length ?? 0}
                      </span>
                    </div>
                  </div>

                  <Show when={selectedIds().size > 0}>
                    <div class="selection-bar">
                      <span class="count-chip">
                        {selectedIds().size} selected
                      </span>
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        onClick={() => void copySelectedBibliography()}
                      >
                        Copy bibliography
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={openDuplicateDialog}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
                        onClick={() => void removeSelected()}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={() => void copySelectedInText()}
                      >
                        Copy in-text
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={clearSelection}
                      >
                        Clear
                      </button>
                    </div>
                  </Show>

                  <Show when={referencesResource.loading}>
                    <div class="loading-state compact">
                      <span class="spinner" />
                    </div>
                  </Show>

                  <Show
                    when={
                      !referencesResource.loading &&
                      filteredReferences().length === 0
                    }
                  >
                    <div class="ref-empty">
                      <h3>
                        {referencesResource()?.length
                          ? "No matching references"
                          : "No references yet"}
                      </h3>
                      <p class="subtle">
                        {referencesResource()?.length
                          ? "Try a different search or type filter."
                          : "Add a book, article, website or anything else you are citing."}
                      </p>
                      <Show when={!referencesResource()?.length}>
                        <button
                          type="button"
                          class="btn btn-primary"
                          onClick={openCreate}
                        >
                          Add your first reference
                        </button>
                      </Show>
                    </div>
                  </Show>

                  <div class="ref-list">
                    <For each={filteredReferences()}>
                      {(reference) => (
                        <article
                          class="ref-card"
                          classList={{ selected: isSelected(reference.id) }}
                        >
                          <input
                            type="checkbox"
                            class="ref-select"
                            checked={isSelected(reference.id)}
                            onChange={() => toggleSelected(reference.id)}
                            aria-label={`Select ${reference.title}`}
                          />
                          <span class={`type-badge type-${reference.type}`}>
                            {typeLabels[reference.type]}
                          </span>

                          <div class="ref-main">
                            <h3>{reference.title}</h3>
                            <p class="ref-meta">{referenceMeta(reference)}</p>
                            <Show when={reference.tags.length > 0}>
                              <div class="tag-row">
                                <For each={reference.tags.slice(0, 4)}>
                                  {(tag) => <span class="tag">{tag}</span>}
                                </For>
                              </div>
                            </Show>
                          </div>

                          <div class="ref-actions">
                            <button
                              type="button"
                              class="btn btn-ghost btn-sm"
                              onClick={() =>
                                void copyText(
                                  citationFor(reference.id),
                                  "In-text citation copied.",
                                )
                              }
                            >
                              Cite
                            </button>
                            <button
                              type="button"
                              class="btn btn-ghost btn-sm"
                              onClick={() => openEdit(reference)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              class="btn btn-danger btn-sm"
                              onClick={() => void removeReference(reference)}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      )}
                    </For>
                  </div>
                </section>

                <aside class="panel bib-panel">
                  <div class="bib-head">
                    <div class="bib-title-row">
                      <h2>References</h2>
                      <button
                        type="button"
                        class="style-chip style-chip-button"
                        title={`${project().styleTitle} — click to change`}
                        onClick={openStyleDialog}
                      >
                        {project().styleTitle}
                      </button>
                    </div>

                    <div class="bib-tabs" role="tablist">
                      <button
                        type="button"
                        classList={{ active: tab() === "bibliography" }}
                        onClick={() => setTab("bibliography")}
                        role="tab"
                        aria-selected={tab() === "bibliography"}
                      >
                        Bibliography
                      </button>
                      <button
                        type="button"
                        classList={{ active: tab() === "in-text" }}
                        onClick={() => setTab("in-text")}
                        role="tab"
                        aria-selected={tab() === "in-text"}
                      >
                        In-text
                      </button>
                    </div>
                  </div>

                  <div class="bib-body">
                    <Show when={bibliographyResource.loading}>
                      <div class="loading-state compact">
                        <span class="spinner" />
                      </div>
                    </Show>

                    <Show when={tab() === "bibliography"}>
                      <Show when={copyFont()}>
                        <style>{`.bib-panel .bib-entry, .bib-panel .bib-body { font-family: ${copyFont()}; font-size: 12pt; line-height: 1.6; }`}</style>
                      </Show>
                      <Show when={visibleEntries().length === 0}>
                        <p class="subtle" style={`font-family: ${copyFont()}; font-size: 12pt;`}>
                          {selectedIds().size > 0
                            ? "None of the selected references have formatted entries yet."
                            : "Your formatted bibliography will appear here."}
                        </p>
                      </Show>
                      <For each={visibleEntries()}>
                        {(entry) => (
                          <div class="bib-entry" innerHTML={entry.html} style={`font-family: ${copyFont()}; font-size: 12pt; line-height: 1.6;`} />
                        )}
                      </For>
                    </Show>

                    <Show when={tab() === "in-text"}>
                      <Show when={visibleCitations().length === 0}>
                        <p class="subtle">
                          {selectedIds().size > 0
                            ? "None of the selected references have citations yet."
                            : "In-text citations will appear here."}
                        </p>
                      </Show>
                      <For each={visibleCitations()}>
                        {(citation) => (
                          <div class="citation-row">
                            <code>{citation.inText}</code>
                            <button
                              type="button"
                              class="btn btn-ghost btn-sm"
                              onClick={() =>
                                void copyText(
                                  citation.inText,
                                  "In-text citation copied.",
                                )
                              }
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>

                  <div class="bib-foot" style="flex-wrap: wrap; gap: 6px;">
                    <select
                      value={copyFont()}
                      onChange={(e) => void changeFont(e.currentTarget.value)}
                      disabled={fontSaving()}
                      style="padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border);"
                      title="Font for this project — saved automatically"
                    >
                      <option value="Calibri, 'Calibri Light', Arial, sans-serif">Calibri</option>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="Times New Roman, Times, serif">Times New Roman</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="Cambria, serif">Cambria</option>
                      <option value="'Palatino Linotype', Palatino, serif">Palatino</option>
                    </select>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      onClick={copyBibliography}
                    >
                      Copy all
                    </button>

                    <select
                      class="filter-select"
                      value={exportFormat()}
                      onChange={(event) =>
                        setExportFormat(
                          event.currentTarget.value as ExportFormat,
                        )
                      }
                      aria-label="Export format"
                    >
                      <option value="text">.txt</option>
                      <option value="html">.html</option>
                      <option value="ris">.ris</option>
                      <option value="bibtex">.bib</option>
                    </select>

                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={downloadBibliography}
                    >
                      Download
                    </button>
                  </div>

                  <p class="bib-note">
                    Rendered with citeproc-js ·{" "}
                    <a
                      href={bibliography()?.styleSource ?? project().styleSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      official CSL style
                    </a>
                  </p>
                </aside>
              </div>
            </>
          )}
        </Show>
      </AppShell>

      <ReferenceDialog
        open={dialogOpen()}
        projectId={projectId()}
        reference={editing()}
        initialDraft={importedDraft()}
        onClose={() => {
          closeDialog();
          setImportedDraft(null);
        }}
        onSaved={() => {
          closeDialog();
          setImportedDraft(null);
          setImportValue("");
          refreshAll();
        }}
      />

      <Show when={duplicateOpen()}>
        <Portal>
          <div
            class="modal-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setDuplicateOpen(false);
              }
            }}
          >
            <div class="modal modal-small" role="dialog" aria-modal="true">
              <header class="modal-header">
                <div>
                  <h2>Duplicate to project</h2>
                  <p class="subtle">
                    Copy {selectedIds().size}{" "}
                    {selectedIds().size === 1 ? "reference" : "references"}{" "}
                    to another project.
                  </p>
                </div>
                <button
                  type="button"
                  class="icon-button"
                  onClick={() => setDuplicateOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div class="modal-body">
                <Show when={duplicateLoading()}>
                  <div class="loading-state compact">
                    <span class="spinner" />
                  </div>
                </Show>

                <Show
                  when={!duplicateLoading() && duplicateTargets().length === 0}
                >
                  <p class="subtle">
                    No other projects yet — create one from the dashboard
                    first.
                  </p>
                </Show>

                <div class="style-list">
                  <For each={duplicateTargets()}>
                    {(target) => (
                      <button
                        type="button"
                        class="style-result"
                        disabled={duplicateSaving()}
                        onClick={() => void duplicateSelected(target)}
                      >
                        <span class="style-result-main">
                          <span class="style-result-title">
                            {target.name}
                          </span>
                          <span class="style-result-meta">
                            {target.referenceCount}{" "}
                            {target.referenceCount === 1
                              ? "reference"
                              : "references"}
                          </span>
                        </span>
                        <span class="style-result-action">
                          {duplicateSaving() ? "Copying..." : "Duplicate"}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <footer class="modal-footer">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => setDuplicateOpen(false)}
                >
                  Cancel
                </button>
              </footer>
            </div>
          </div>
        </Portal>
      </Show>

      <Show when={styleDialogOpen()}>
        <Portal>
          <div
            class="modal-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setStyleDialogOpen(false);
              }
            }}
          >
            <div class="modal style-modal" role="dialog" aria-modal="true">
              <header class="modal-header">
                <div>
                  <h2>Citation style</h2>
                  <p class="subtle">
                    Styles come from the official CSL repository and are
                    validated with citeproc-js before use.
                  </p>
                </div>
                <button
                  type="button"
                  class="icon-button"
                  onClick={() => setStyleDialogOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div class="modal-body">
                <div class="search-wrap style-search">
                  <svg
                    viewBox="0 0 24 24"
                    width="17"
                    height="17"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="11"
                      cy="11"
                      r="6.5"
                      stroke="currentColor"
                      stroke-width="1.8"
                    />
                    <path
                      d="m16 16 4 4"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                  </svg>
                  <input
                    type="search"
                    value={styleQuery()}
                    onInput={(event) =>
                      updateStyleQuery(event.currentTarget.value)
                    }
                    placeholder="Search 10,000+ CSL styles"
                    aria-label="Search citation styles"
                    autofocus
                  />
                </div>

                <Show when={styleSearchLoading()}>
                  <div class="loading-state compact">
                    <span class="spinner" />
                  </div>
                </Show>

                <Show when={!styleSearchLoading() && styleResults().length === 0}>
                  <p class="subtle">No styles found.</p>
                </Show>

                <Show
                  when={!styleSearchLoading() && styleResults().length > 0}
                >
                  <p class="subtle small" style={{ margin: "0 0 8px" }}>
                    {styleResults().length.toLocaleString()} styles
                    {styleQuery().trim()
                      ? ` matching “${styleQuery().trim()}”`
                      : " — type to filter"}
                  </p>
                </Show>

                <div class="style-list" ref={styleScrollEl}>
                  <div
                    class="style-virtual-sizer"
                    style={{ height: `${styleVirtualizer.getTotalSize()}px` }}
                  >
                    <For each={styleVirtualizer.getVirtualItems()}>
                      {(virtualRow) => {
                        const result = styleResults()[virtualRow.index];
                        if (!result) return null;
                        return (
                          <div
                            class="style-virtual-row"
                            data-index={virtualRow.index}
                            ref={styleVirtualizer.measureElement}
                            style={{
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <button
                              type="button"
                              class="style-result"
                              classList={{
                                active:
                                  result.id === projectResource()?.styleId,
                              }}
                              disabled={styleSaving()}
                              onClick={() => void chooseStyle(result)}
                            >
                              <span class="style-result-main">
                                <span class="style-result-title">
                                  {result.title}
                                  <Show when={result.isDefault}>
                                    <span class="style-result-badge">
                                      Default
                                    </span>
                                  </Show>
                                </span>
                                <span class="style-result-meta">
                                  {result.id}
                                  {result.format ? ` · ${result.format}` : ""}
                                  {result.dependent ? " · dependent" : ""}
                                  {result.updated
                                    ? ` · updated ${result.updated.slice(0, 10)}`
                                    : ""}
                                </span>
                              </span>
                              <span class="style-result-action">
                                {result.id === projectResource()?.styleId
                                  ? "Current"
                                  : styleSaving()
                                    ? "Applying..."
                                    : "Use"}
                              </span>
                            </button>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>

              <footer class="modal-footer">
                <a
                  class="btn btn-ghost"
                  href="https://github.com/citation-style-language/styles"
                  target="_blank"
                  rel="noreferrer"
                >
                  Official CSL repository
                </a>
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={() => setStyleDialogOpen(false)}
                >
                  Close
                </button>
              </footer>
            </div>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}
