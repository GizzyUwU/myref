import type { NewReference } from "../db/schema";
import type { referenceInput } from "./references";

export type ReferenceInput = typeof referenceInput.static;
export type ReferenceValues = Omit<NewReference, "projectId" | "userId">;
