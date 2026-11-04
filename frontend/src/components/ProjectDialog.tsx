import {
  createEffect,
  createSignal,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { api, ApiError } from "../api";
import { toast } from "../store/toast";
import type { Project } from "../types";
import { Field } from "./Field";

export function ProjectDialog(props: {
  open: boolean;
  project?: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (props.open) {
      setName(props.project?.name ?? "");
      setDescription(props.project?.description ?? "");
      setError("");
      setSaving(false);
    }
  });

  async function submit() {
    const projectName = name().trim();
    if (!projectName) {
      setError("Give your project a name.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const result = props.project
        ? await api.updateProject(props.project.id, {
            name: projectName,
            description: description().trim(),
          })
        : await api.createProject({
            name: projectName,
            description: description().trim(),
          });

      toast(props.project ? "Project updated." : "Project created.", "success");
      props.onSaved(result.project);
      props.onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save project.",
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
          <div class="modal modal-small" role="dialog" aria-modal="true">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <header class="modal-header">
                <div>
                  <h2>{props.project ? "Edit project" : "New project"}</h2>
                  <p class="subtle">
                    Projects keep references for one assignment together.
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
                <Field label="Project name">
                  <input
                    value={name()}
                    onInput={(event) => setName(event.currentTarget.value)}
                    placeholder="e.g. Dissertation — Chapter 2"
                    maxLength={120}
                    autofocus
                  />
                </Field>

                <Field label="Description" hint="Optional.">
                  <textarea
                    value={description()}
                    onInput={(event) =>
                      setDescription(event.currentTarget.value)
                    }
                    placeholder="What is this project for?"
                    rows={3}
                    maxLength={500}
                  />
                </Field>

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
                <button type="submit" class="btn btn-primary" disabled={saving()}>
                  {saving()
                    ? "Saving..."
                    : props.project
                      ? "Save changes"
                      : "Create project"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
