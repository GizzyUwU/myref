import {
  createEffect,
  createSignal,
  Index,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { api, ApiError } from "../api";
import { toast } from "../store/toast";
import {
  emptyDraft,
  referenceTypes,
  toDraft,
  typeLabels,
  type Author,
  type Reference,
  type ReferenceDraft,
  type ReferenceType,
} from "../types";
import { Field } from "./Field";

function PeopleEditor(props: {
  label: string;
  people: Author[];
  onChange: (people: Author[]) => void;
}) {
  return (
    <div class="people-editor">
      <div class="people-head">
        <span class="field-label">{props.label}</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() =>
            props.onChange([...props.people, { family: "", given: "" }])
          }
        >
          Add person
        </button>
      </div>

      <Index each={props.people}>
        {(person, index) => (
          <div class="author-row">
            <input
              placeholder="Family name"
              value={person().family}
              onInput={(event) => {
                const value = event.currentTarget.value;
                props.onChange(
                  props.people.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, family: value }
                      : item,
                  ),
                );
              }}
            />
            <input
              placeholder="Given names / initials"
              value={person().given ?? ""}
              onInput={(event) => {
                const value = event.currentTarget.value;
                props.onChange(
                  props.people.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, given: value }
                      : item,
                  ),
                );
              }}
            />
            <button
              type="button"
              class="icon-button"
              aria-label={`Remove ${props.label.toLowerCase()}`}
              onClick={() =>
                props.onChange(
                  props.people.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            >
              ×
            </button>
          </div>
        )}
      </Index>

      <Show when={props.people.length === 0}>
        <p class="field-hint">
          No people added. That is fine for an organisation or unknown author.
        </p>
      </Show>
    </div>
  );
}

export function ReferenceDialog(props: {
  open: boolean;
  projectId: string;
  reference?: Reference | null;
  initialDraft?: ReferenceDraft | null;
  onClose: () => void;
  onSaved: (reference: Reference) => void;
}) {
  const [draft, setDraft] = createSignal<ReferenceDraft>(emptyDraft());
  const [tagsText, setTagsText] = createSignal("");
  const [importValue, setImportValue] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(() => {
    if (props.open) {
      const initial = props.reference
        ? toDraft(props.reference)
        : props.initialDraft
          ? props.initialDraft
          : emptyDraft();
      setDraft(initial);
      setTagsText((initial.tags ?? []).join(", "));
      setImportValue("");
      setError("");
      setSaving(false);
    }
  });

  const type = () => draft().type;

  function update<K extends keyof ReferenceDraft>(
    key: K,
    value: ReferenceDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setPeople(kind: "authors" | "editors", people: Author[]) {
    setDraft((current) =>
      kind === "authors"
        ? { ...current, authors: people }
        : { ...current, editors: people },
    );
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

  async function importRecord() {
    const value = importValue().trim();
    if (!value) return;

    setImporting(true);
    setError("");

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
        } else {
          result = await api.lookupIsbn(value);
        }
      }

      setDraft((current) => ({
        ...current,
        ...result.reference,
        type: result.reference.type ?? current.type,
        authors: result.reference.authors.length
          ? result.reference.authors
          : current.authors,
        editors: result.reference.editors ?? current.editors,
      }));
      setTagsText((result.reference.tags ?? []).join(", "));
      toast(
        `Imported from ${result.source}. Check the details before saving.`,
        "success",
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not import that record.",
      );
    } finally {
      setImporting(false);
    }
  }

  function changeType(next: ReferenceType) {
    setDraft((current) => ({
      ...current,
      type: next,
      accessedDate:
        next === "website" && !current.accessedDate
          ? new Date().toISOString().slice(0, 10)
          : current.accessedDate,
    }));
  }

  function showContainer() {
    return ["chapter", "journal", "website", "newspaper", "other"].includes(
      type(),
    );
  }

  function containerLabel() {
    switch (type()) {
      case "chapter":
        return "Book title";
      case "journal":
        return "Journal title";
      case "website":
        return "Website name";
      case "newspaper":
        return "Newspaper title";
      default:
        return "Container / source title";
    }
  }

  function publisherLabel() {
    switch (type()) {
      case "thesis":
        return "Institution";
      case "film":
        return "Production company";
      case "report":
        return "Publisher / organisation";
      default:
        return "Publisher";
    }
  }

  async function submit() {
    const current = draft();
    const title = current.title.trim();
    if (!title) {
      setError("A title is required.");
      return;
    }

    const payload: ReferenceDraft = {
      ...current,
      title,
      authors: current.authors
        .map((author) => ({
          family: author.family.trim(),
          given: (author.given ?? "").trim(),
        }))
        .filter((author) => author.family),
      editors: current.editors
        .map((editor) => ({
          family: editor.family.trim(),
          given: (editor.given ?? "").trim(),
        }))
        .filter((editor) => editor.family),
      year: current.year.trim(),
      containerTitle: current.containerTitle.trim(),
      publisher: current.publisher.trim(),
      place: current.place.trim(),
      edition: current.edition.trim(),
      volume: current.volume.trim(),
      issue: current.issue.trim(),
      pages: current.pages.trim(),
      doi: current.doi.trim(),
      url: current.url.trim(),
      accessedDate: current.accessedDate || null,
      publicationDate: current.publicationDate.trim(),
      notes: current.notes.trim(),
      tags: tagsText()
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    setSaving(true);
    setError("");

    try {
      const result = props.reference
        ? await api.updateReference(props.reference.id, payload)
        : await api.createReference(props.projectId, payload);

      toast(
        props.reference ? "Reference updated." : "Reference added.",
        "success",
      );
      props.onSaved(result.reference);
      props.onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save this reference.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <div class="modal" role="dialog" aria-modal="true">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <header class="modal-header">
                <div>
                  <h2>
                    {props.reference ? "Edit reference" : "Add a reference"}
                  </h2>
                  <p class="subtle">
                    Your project's official CSL style is applied
                    automatically.
                  </p>
                </div>
                <button
                  type="button"
                  class="icon-button"
                  onClick={props.onClose}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div class="modal-body">
                <div class="import-box" style="display:flex; flex-direction:row; align-items:center; gap:12px; flex-wrap:nowrap;">
                  <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                    <label class="field-label">Import from URL, DOI or ISBN</label>
                    <input
                      value={importValue()}
                      onInput={(event) =>
                        setImportValue(event.currentTarget.value)
                      }
                      placeholder="https://example.com/page or 10.1080/… or 978-1-…"
                      style="width:100%;"
                    />
                    <p class="field-hint" style="margin:0;">Optional. Paste a URL, DOI (10.xxxx/...) or ISBN to autofill metadata.</p>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost"
                    disabled={importing() || !importValue().trim()}
                    onClick={() => void importRecord()}
                    style="flex-shrink:0; align-self:flex-end; margin-bottom:22px;"
                  >
                    {importing() ? "Fetching..." : "Fetch details"}
                  </button>
                </div>

                <div class="form-grid">
                  <Field label="Reference type">
                    <select
                      style="width: 100%;"
                      value={type()}
                      onChange={(event) =>
                        changeType(event.currentTarget.value as ReferenceType)
                      }
                    >
                      {referenceTypes.map((referenceType) => (
                        <option value={referenceType}>
                          {typeLabels[referenceType]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Year" hint="Leave blank for no date.">
                    <input
                      style="width: 100%;"
                      value={draft().year}
                      onInput={(event) =>
                        update("year", event.currentTarget.value)
                      }
                      placeholder="2024"
                      inputmode="numeric"
                      maxLength={20}
                    />
                  </Field>

                  <Field label="Title" class="span-2">
                    <input
                      value={draft().title}
                      onInput={(event) =>
                        update("title", event.currentTarget.value)
                      }
                      placeholder="Title of the work"
                      maxLength={1000}
                      required
                    />
                  </Field>

                  <div class="span-2">
                    <PeopleEditor
                      label={type() === "film" ? "Directors" : "Authors"}
                      people={draft().authors}
                      onChange={(people) => setPeople("authors", people)}
                    />
                  </div>

                  <Show when={type() === "chapter"}>
                    <div class="span-2">
                      <PeopleEditor
                        label="Editors"
                        people={draft().editors}
                        onChange={(people) => setPeople("editors", people)}
                      />
                    </div>
                  </Show>

                  <Show when={showContainer()}>
                    <Field label={containerLabel()} class="span-2">
                      <input
                        value={draft().containerTitle}
                        onInput={(event) =>
                          update("containerTitle", event.currentTarget.value)
                        }
                        placeholder="e.g. Journal of Marketing"
                        maxLength={1000}
                      />
                    </Field>
                  </Show>

                  <Show when={["book", "chapter", "other"].includes(type())}>
                    <Field label="Edition" hint="e.g. 2nd, or leave blank.">
                      <input
                        value={draft().edition}
                        onInput={(event) =>
                          update("edition", event.currentTarget.value)
                        }
                        placeholder="2nd"
                        maxLength={100}
                      />
                    </Field>
                  </Show>

                  <Show
                    when={[
                      "book",
                      "chapter",
                      "report",
                      "thesis",
                      "film",
                      "other",
                    ].includes(type())}
                  >
                    <Field label={publisherLabel()}>
                      <input
                        value={draft().publisher}
                        onInput={(event) =>
                          update("publisher", event.currentTarget.value)
                        }
                        placeholder="Publisher or organisation"
                        maxLength={500}
                      />
                    </Field>

                    <Field label="Place">
                      <input
                        value={draft().place}
                        onInput={(event) =>
                          update("place", event.currentTarget.value)
                        }
                        placeholder="London"
                        maxLength={500}
                      />
                    </Field>
                  </Show>

                  <Show when={["journal", "other"].includes(type())}>
                    <Field label="Volume">
                      <input
                        value={draft().volume}
                        onInput={(event) =>
                          update("volume", event.currentTarget.value)
                        }
                        placeholder="12"
                        maxLength={50}
                      />
                    </Field>

                    <Field label="Issue">
                      <input
                        value={draft().issue}
                        onInput={(event) =>
                          update("issue", event.currentTarget.value)
                        }
                        placeholder="3"
                        maxLength={50}
                      />
                    </Field>
                  </Show>

                  <Show
                    when={["chapter", "journal", "newspaper", "other"].includes(
                      type(),
                    )}
                  >
                    <Field label="Pages">
                      <input
                        value={draft().pages}
                        onInput={(event) =>
                          update("pages", event.currentTarget.value)
                        }
                        placeholder="45–58"
                        maxLength={100}
                      />
                    </Field>
                  </Show>

                  <Show when={["journal", "other"].includes(type())}>
                    <Field label="DOI">
                      <input
                        value={draft().doi}
                        onInput={(event) =>
                          update("doi", event.currentTarget.value)
                        }
                        placeholder="10.1080/…"
                        maxLength={500}
                      />
                    </Field>
                  </Show>

                  <Show when={["newspaper", "other"].includes(type())}>
                    <Field label="Publication date">
                      <input
                        value={draft().publicationDate}
                        onInput={(event) =>
                          update("publicationDate", event.currentTarget.value)
                        }
                        placeholder="2 November 2026"
                        maxLength={100}
                      />
                    </Field>
                  </Show>

                  <Show when={type() !== "film"}>
                    <Field label="URL" class="span-2">
                      <input
                        value={draft().url}
                        onInput={(event) =>
                          update("url", event.currentTarget.value)
                        }
                        placeholder="https://…"
                        maxLength={2000}
                      />
                    </Field>
                  </Show>

                  <Show when={["website", "other"].includes(type())}>
                    <Field label="Accessed date">
                      <input
                        type="date"
                        value={draft().accessedDate ?? ""}
                        onInput={(event) =>
                          update(
                            "accessedDate",
                            event.currentTarget.value || null,
                          )
                        }
                      />
                    </Field>
                  </Show>
                </div>

                <details class="advanced">
                  <summary>Notes and tags</summary>
                  <div class="advanced-body">
                    <Field label="Annotation / Notes">
                      <textarea
                        value={draft().notes}
                        onInput={(event) =>
                          update("notes", event.currentTarget.value)
                        }
                        placeholder="Annotation or notes (e.g., why you are citing this, useful quotes)…"
                        rows={3}
                        maxLength={5000}
                      />
                    </Field>
                    <Field
                      label="Tags"
                      hint="Separate tags with commas."
                      class="span-2"
                    >
                      <input
                        value={tagsText()}
                        onInput={(event) =>
                          setTagsText(event.currentTarget.value)
                        }
                        placeholder="methodology, reading list"
                      />
                    </Field>
                  </div>
                </details>

                <Show when={error()}>
                  <p class="form-error">{error()}</p>
                </Show>
              </div>

              <footer class="modal-footer">
                <button
                  type="button"
                  class="btn btn-ghost"
                  onClick={props.onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn btn-primary"
                  disabled={saving()}
                >
                  {saving()
                    ? "Saving..."
                    : props.reference
                      ? "Save changes"
                      : "Add reference"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
