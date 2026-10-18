import { DatabaseSync } from "node:sqlite";

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    definition TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    lead_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    issue_counter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX issues_project ON issues(project_id);
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX comments_issue ON comments(issue_id);
  `,
];

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}
