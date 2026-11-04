import { and, eq } from "drizzle-orm";
import { validate } from "uuid";
import { db } from "../db";
import { projects, type Project } from "../db/schema";
import { notFound } from "./http";

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
