import { Navigate, useNavigate } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { api, ApiError } from "../api";
import { AppShell } from "../components/AppShell";
import { ProjectDialog } from "../components/ProjectDialog";
import { formatDate } from "../format";
import { auth } from "../store/auth";
import { toast } from "../store/toast";
import type { Project } from "../types";

type ProjectSort = "edited" | "name-az" | "name-za" | "refs" | "created";

const projectSortKey = "myref:project-sort";

function initialProjectSort(): ProjectSort {
  try {
    const stored = localStorage.getItem(projectSortKey);
    if (
      stored === "edited" ||
      stored === "name-az" ||
      stored === "name-za" ||
      stored === "refs" ||
      stored === "created"
    )
      return stored;
  } catch {
  }
  return "edited";
}

function sortProjects(list: Project[], sort: ProjectSort): Project[] {
  const arr = [...list];
  switch (sort) {
    case "name-az":
      arr.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      break;
    case "name-za":
      arr.sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
      );
      break;
    case "refs":
      arr.sort((a, b) => b.referenceCount - a.referenceCount);
      break;
    case "created":
      arr.sort(
        (a, b) =>
          Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
      );
      break;
    case "edited":
    default:
      arr.sort(
        (a, b) =>
          Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""),
      );
  }
  return arr;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [projectList, { refetch }] = createResource(async () => {
    const result = await api.projects();
    return result.projects;
  });

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<Project | null>(null);
  const [sort, setSort] = createSignal<ProjectSort>(initialProjectSort());

  function changeSort(value: ProjectSort) {
    setSort(value);
    try {
      localStorage.setItem(projectSortKey, value);
    } catch {
    }
  }

  const sortedProjects = createMemo(() => sortProjects(projectList() ?? [], sort()));

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setDialogOpen(true);
  }

  async function removeProject(project: Project) {
    const confirmed = window.confirm(
      `Delete "${project.name}" and all of its references? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await api.deleteProject(project.id);
      toast("Project deleted.", "success");
      void refetch();
    } catch (caught) {
      toast(
        caught instanceof ApiError
          ? caught.message
          : "Could not delete project.",
        "error",
      );
    }
  }

  return (
    <Show when={auth.user()} fallback={<Navigate href="/login" />}>
      <AppShell>
        <section class="page-head">
          <div>
            <p class="eyebrow">Your workspace</p>
            <h1 class="page-title">Projects</h1>
            <p class="subtle">
              Keep every assignment&apos;s sources in one tidy place.
            </p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <select
              value={sort()}
              onChange={(event) =>
                changeSort(event.currentTarget.value as ProjectSort)
              }
              aria-label="Sort projects"
              title="Sort projects"
              style="width: auto;"
            >
              <option value="edited">Last edited</option>
              <option value="created">Newest</option>
              <option value="name-az">Name: A to Z</option>
              <option value="name-za">Name: Z to A</option>
              <option value="refs">Most references</option>
            </select>
            <button type="button" class="btn btn-primary" onClick={openCreate}>
              <span class="plus" aria-hidden="true">
                +
              </span>
              New project
            </button>
          </div>
        </section>

        <Show when={projectList.loading}>
          <div class="loading-state">
            <span class="spinner" />
          </div>
        </Show>

        <Show when={projectList.error}>
          <div class="panel empty-state">
            <h2>We could not load your projects</h2>
            <p class="subtle">Check that the API is running, then refresh.</p>
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => void refetch()}
            >
              Try again
            </button>
          </div>
        </Show>

        <Show when={!projectList.loading && projectList()?.length === 0}>
          <div class="panel empty-state">
            <div class="empty-icon" aria-hidden="true">
              +
            </div>
            <h2>No projects yet</h2>
            <p class="subtle">
              Create a project for each essay, report or dissertation. Your
              references and bibliography stay together.
            </p>
            <button type="button" class="btn btn-primary" onClick={openCreate}>
              Create your first project
            </button>
          </div>
        </Show>

        <div class="project-grid">
          <For each={sortedProjects()}>
            {(project) => (
              <article
                class="project-card"
                role="link"
                tabindex="0"
                onClick={() => navigate(`/app/projects/${project.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/app/projects/${project.id}`);
                  }
                }}
              >
                <div class="project-card-top">
                  <span class="project-icon" aria-hidden="true">
                    {project.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span class="project-count">
                    {project.referenceCount}{" "}
                    {project.referenceCount === 1 ? "reference" : "references"}
                  </span>
                </div>

                <div class="project-card-body">
                  <h2>{project.name}</h2>
                  <p class="project-desc">
                    {project.description || "No description yet."}
                  </p>
                </div>

                <div class="project-footer">
                  <span class="subtle small">
                    Updated {formatDate(project.updatedAt)}
                  </span>
                  <div class="card-actions">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(project);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        void removeProject(project);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )}
          </For>
        </div>
      </AppShell>

      <ProjectDialog
        open={dialogOpen()}
        project={editing()}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void refetch()}
      />
    </Show>
  );
}
