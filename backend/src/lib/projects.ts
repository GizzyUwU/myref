import { and, eq } from "drizzle-orm";
import { validate } from "uuid";
import { db } from "../db";
import { projectMembers, projects, type Project } from "../db/schema";
import { notFound } from "./http";
import type { ProjectRole } from "./projects.types";

export function isUuid(value: string): boolean {
  return validate(value);
}

export async function getOwnedProject(
  userId: string,
  projectId: string,
): Promise<Project> {
  if (!isUuid(projectId)) notFound("Project not found.");

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) notFound("Project not found.");
  return project;
}

export async function getAccessibleProject(
  userId: string,
  projectId: string,
): Promise<{ project: Project; role: ProjectRole }> {
  if (!isUuid(projectId)) notFound("Project not found.");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) notFound("Project not found.");
  if (project.userId === userId) return { project, role: "owner" };

  const [membership] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) notFound("Project not found.");
  return { project, role: "member" };
}

export async function accessibleProjectIds(userId: string): Promise<Set<string>> {
  const owned = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId));
  const member = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return new Set([
    ...owned.map((row) => row.id),
    ...member.map((row) => row.projectId),
  ]);
}
