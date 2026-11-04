import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const REFERENCE_TYPES = [
  "book",
  "chapter",
  "journal",
  "website",
  "report",
  "thesis",
  "newspaper",
  "film",
  "other",
] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export type Author = {
  family: string;
  given?: string;
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    uniqueIndex("users_username_lower_unique").on(
      sql`lower(${table.username})`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    styleId: text("style_id").notNull().default("harvard-the-university-of-northampton"),
    styleTitle: text("style_title").notNull().default("The University of Northampton (author-date/Harvard)"),
    styleSource: text("style_source").notNull().default("https://www.zotero.org/styles/harvard-the-university-of-northampton"),
    fontFamily: text("font_family").notNull().default("Calibri, 'Calibri Light', Arial, sans-serif"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("projects_user_idx").on(table.userId)],
);

export const references = pgTable(
  "references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<ReferenceType>().notNull().default("book"),
    title: text("title").notNull(),
    authors: jsonb("authors")
      .$type<Author[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    editors: jsonb("editors")
      .$type<Author[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    year: text("year").notNull().default(""),
    containerTitle: text("container_title").notNull().default(""),
    publisher: text("publisher").notNull().default(""),
    place: text("place").notNull().default(""),
    edition: text("edition").notNull().default(""),
    volume: text("volume").notNull().default(""),
    issue: text("issue").notNull().default(""),
    pages: text("pages").notNull().default(""),
    doi: text("doi").notNull().default(""),
    url: text("url").notNull().default(""),
    accessedDate: date("accessed_date"),
    publicationDate: text("publication_date").notNull().default(""),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("references_project_idx").on(table.projectId),
    index("references_user_idx").on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ReferenceRow = typeof references.$inferSelect;
export type NewReference = typeof references.$inferInsert;
