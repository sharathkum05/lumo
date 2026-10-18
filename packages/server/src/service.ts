import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  availableTransitions,
  defaultWorkflow,
  findStatus,
  formatIssueKey,
  ISSUE_TYPES,
  isValidProjectKey,
  LumoError,
  PRIORITIES,
  resolveTransition,
  searchIssues,
  userIdentities,
  validateWorkflow,
  type Comment,
  type Issue,
  type IssueRecord,
  type IssueType,
  type Priority,
  type Project,
  type Transition,
  type User,
  type Workflow,
} from "@lumo/core";

export interface CreateIssueInput {
  project: string;
  summary: string;
  type?: string;
  description?: string;
  priority?: string;
  /** User id, username or email. */
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
  /** Parent issue key. */
  parent?: string | null;
}

export type UpdateIssueInput = Partial<Omit<CreateIssueInput, "project">>;

export interface SearchResult {
  total: number;
  startAt: number;
  maxResults: number;
  issues: IssueRecord[];
}

type Row = Record<string, SQLInputValue>;

const now = () => new Date().toISOString();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** All business rules live here; the HTTP layers only translate requests and responses. */
export class LumoService {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- Users and tokens ---

  userCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
  }

  createUser(input: { username: string; displayName?: string; email: string }): User {
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) {
      throw new LumoError("invalid_input", "Username must be 2-40 letters, digits, dots, dashes or underscores");
    }
    if (!/^[^@\s]+@[^@\s]+$/.test(input.email)) throw new LumoError("invalid_input", "Invalid email address");
    const user: User = { id: randomUUID(), username, displayName: input.displayName?.trim() || username, email: input.email };
    try {
      this.db
        .prepare("INSERT INTO users (id, username, display_name, email, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(user.id, user.username, user.displayName, user.email, now());
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new LumoError("conflict", "Username or email already in use");
      throw err;
    }
    return user;
  }

  listUsers(): User[] {
    return (this.db.prepare("SELECT * FROM users ORDER BY username").all() as Row[]).map(toUser);
  }

  /** Finds a user by id, username or email. */
  findUser(ref: string): User | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ? OR username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE")
      .get(ref, ref, ref) as Row | undefined;
    return row ? toUser(row) : null;
  }

  getUser(ref: string): User {
    const user = this.findUser(ref);
    if (!user) throw new LumoError("not_found", `User "${ref}" does not exist`);
    return user;
  }

  /** Returns the plaintext token. Only its hash is stored, so it cannot be shown again. */
  createApiToken(userId: string, name: string): string {
    const token = `lumo_${randomBytes(24).toString("base64url")}`;
    this.db
      .prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), userId, name, hashToken(token), now());
    return token;
  }

  authenticate(token: string): User | null {
    const hash = hashToken(token);
    const row = this.db
      .prepare("SELECT users.* FROM api_tokens JOIN users ON users.id = api_tokens.user_id WHERE token_hash = ?")
      .get(hash) as Row | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?").run(now(), hash);
    return toUser(row);
  }

  // --- Projects ---

  createProject(input: { key: string; name: string; description?: string; lead?: string | null }): Project {
    const key = input.key.trim().toUpperCase();
    if (!isValidProjectKey(key)) {
      throw new LumoError("invalid_input", "Project key must be 2-10 characters: a letter, then letters or digits");
    }
    if (!input.name?.trim()) throw new LumoError("invalid_input", "Project name is required");
    const lead = input.lead ? this.getUser(input.lead) : null;
    const workflow = defaultWorkflow(randomUUID());
    validateWorkflow(workflow);
    const project: Project = {
      id: randomUUID(),
      key,
      name: input.name.trim(),
      description: input.description ?? "",
      leadId: lead?.id ?? null,
      workflowId: workflow.id,
      createdAt: now(),
    };
    this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM projects WHERE key = ?").get(key)) {
        throw new LumoError("conflict", `Project key "${key}" is already in use`);
      }
      this.db.prepare("INSERT INTO workflows (id, definition) VALUES (?, ?)").run(workflow.id, JSON.stringify(workflow));
      this.db
        .prepare("INSERT INTO projects (id, key, name, description, lead_id, workflow_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(project.id, project.key, project.name, project.description, project.leadId, project.workflowId, project.createdAt);
    });
    return project;
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY key").all() as Row[]).map(toProject);
  }

  /** Finds a project by id or key. */
  getProject(ref: string): Project {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ? OR key = ?").get(ref, ref.toUpperCase()) as
      | Row
      | undefined;
    if (!row) throw new LumoError("not_found", `Project "${ref}" does not exist`);
    return toProject(row);
  }

  getWorkflow(id: string): Workflow {
    const row = this.db.prepare("SELECT definition FROM workflows WHERE id = ?").get(id) as { definition: string } | undefined;
    if (!row) throw new LumoError("not_found", `Workflow "${id}" does not exist`);
    return JSON.parse(row.definition) as Workflow;
  }

  // --- Issues ---

  createIssue(input: CreateIssueInput, reporter: User | null): IssueRecord {
    const project = this.getProject(input.project);
    const workflow = this.getWorkflow(project.workflowId);
    const summary = requireSummary(input.summary);
    const fields = {
      type: parseType(input.type ?? "Task"),
      priority: parsePriority(input.priority ?? "Medium"),
      assigneeId: input.assignee ? this.getUser(input.assignee).id : null,
      parentId: input.parent ? this.getIssue(input.parent).issue.id : null,
      labels: parseLabels(input.labels ?? []),
      dueDate: parseDueDate(input.dueDate ?? null),
    };
    const id = randomUUID();
    this.transaction(() => {
      const { issue_counter: number } = this.db
        .prepare("UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = ? RETURNING issue_counter")
        .get(project.id) as { issue_counter: number };
      const ts = now();
      this.db
        .prepare(
          `INSERT INTO issues (id, key, project_id, number, type, summary, description, status_id, priority,
             assignee_id, reporter_id, parent_id, labels, due_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          formatIssueKey(project.key, number),
          project.id,
          number,
          fields.type,
          summary,
          input.description ?? "",
          workflow.initialStatusId,
          fields.priority,
          fields.assigneeId,
          reporter?.id ?? null,
          fields.parentId,
          JSON.stringify(fields.labels),
          fields.dueDate,
          ts,
          ts,
        );
    });
    return this.getIssue(id);
  }

  /** Finds an issue by id or key. */
  getIssue(ref: string): IssueRecord {
    const row = this.db.prepare("SELECT * FROM issues WHERE id = ? OR key = ?").get(ref, ref.toUpperCase()) as
      | Row
      | undefined;
    if (!row) throw new LumoError("not_found", `Issue "${ref}" does not exist`);
    return this.toRecord(toIssue(row));
  }

  updateIssue(ref: string, input: UpdateIssueInput): IssueRecord {
    const { issue } = this.getIssue(ref);
    const sets: string[] = [];
    const values: SQLInputValue[] = [];
    const set = (column: string, value: SQLInputValue) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (input.summary !== undefined) set("summary", requireSummary(input.summary));
    if (input.description !== undefined) set("description", input.description);
    if (input.type !== undefined) set("type", parseType(input.type));
    if (input.priority !== undefined) set("priority", parsePriority(input.priority));
    if (input.assignee !== undefined) set("assignee_id", input.assignee ? this.getUser(input.assignee).id : null);
    if (input.labels !== undefined) set("labels", JSON.stringify(parseLabels(input.labels)));
    if (input.dueDate !== undefined) set("due_date", parseDueDate(input.dueDate));
    if (input.parent !== undefined) {
      const parent = input.parent ? this.getIssue(input.parent).issue : null;
      if (parent?.id === issue.id) throw new LumoError("invalid_input", "An issue cannot be its own parent");
      set("parent_id", parent?.id ?? null);
    }
    if (sets.length > 0) {
      set("updated_at", now());
      this.db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...values, issue.id);
    }
    return this.getIssue(issue.id);
  }

  deleteIssue(ref: string): void {
    const { issue } = this.getIssue(ref);
    this.db.prepare("DELETE FROM issues WHERE id = ?").run(issue.id);
  }

  listTransitions(ref: string): Transition[] {
    const { issue, project } = this.getIssue(ref);
    return availableTransitions(this.getWorkflow(project.workflowId), issue.statusId);
  }

  /** Applies a transition by id, transition name or target status name. */
  transitionIssue(ref: string, transition: string): IssueRecord {
    const { issue, project } = this.getIssue(ref);
    const workflow = this.getWorkflow(project.workflowId);
    const t = resolveTransition(workflow, issue.statusId, transition);
    const done = findStatus(workflow, t.to).category === "done";
    const ts = now();
    this.db
      .prepare("UPDATE issues SET status_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
      .run(t.to, done ? (issue.resolvedAt ?? ts) : null, ts, issue.id);
    return this.getIssue(issue.id);
  }

  search(jql: string, viewer: User | null, startAt = 0, maxResults = 50): SearchResult {
    // Evaluates in memory. Fine for thousands of issues; compile JQL to SQL when that stops being true.
    const rows = this.db.prepare("SELECT * FROM issues").all() as Row[];
    const records = rows.map((r) => this.toRecord(toIssue(r)));
    const matched = searchIssues(records, jql, {
      currentUser: viewer ? userIdentities(viewer) : null,
      now: new Date(),
    });
    const limit = Math.min(Math.max(maxResults, 0), 100);
    return { total: matched.length, startAt, maxResults: limit, issues: matched.slice(startAt, startAt + limit) };
  }

  // --- Comments ---

  addComment(ref: string, body: string, author: User): Comment {
    const { issue } = this.getIssue(ref);
    if (!body.trim()) throw new LumoError("invalid_input", "Comment body is required");
    const ts = now();
    const comment: Comment = { id: randomUUID(), issueId: issue.id, authorId: author.id, body, createdAt: ts, updatedAt: ts };
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO comments (id, issue_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(comment.id, comment.issueId, comment.authorId, comment.body, ts, ts);
      this.db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(ts, issue.id);
    });
    return comment;
  }

  listComments(ref: string): Array<Comment & { author: User | null }> {
    const { issue } = this.getIssue(ref);
    const rows = this.db.prepare("SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at").all(issue.id) as Row[];
    return rows.map((r) => {
      const c = toComment(r);
      return { ...c, author: this.findUser(c.authorId) };
    });
  }

  // --- Helpers ---

  private toRecord(issue: Issue): IssueRecord {
    const project = this.getProject(issue.projectId);
    const workflow = this.getWorkflow(project.workflowId);
    const parent = issue.parentId
      ? (this.db.prepare("SELECT key FROM issues WHERE id = ?").get(issue.parentId) as { key: string } | undefined)
      : undefined;
    return {
      issue,
      project,
      status: findStatus(workflow, issue.statusId),
      assignee: issue.assigneeId ? this.findUser(issue.assigneeId) : null,
      reporter: issue.reporterId ? this.findUser(issue.reporterId) : null,
      parentKey: parent?.key ?? null,
    };
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

function requireSummary(summary: string | undefined): string {
  const s = summary?.trim();
  if (!s) throw new LumoError("invalid_input", "Summary is required");
  if (s.length > 255) throw new LumoError("invalid_input", "Summary must be 255 characters or fewer");
  return s;
}

function parseType(type: string): IssueType {
  const match = ISSUE_TYPES.find((t) => t.toLowerCase() === type.toLowerCase().replace("-", ""));
  if (!match) throw new LumoError("invalid_input", `Issue type must be one of: ${ISSUE_TYPES.join(", ")}`);
  return match;
}

function parsePriority(priority: string): Priority {
  const match = PRIORITIES.find((p) => p.toLowerCase() === priority.toLowerCase());
  if (!match) throw new LumoError("invalid_input", `Priority must be one of: ${PRIORITIES.join(", ")}`);
  return match;
}

function parseLabels(labels: string[]): string[] {
  for (const l of labels) {
    if (!/^\S{1,255}$/.test(l)) throw new LumoError("invalid_input", `Label "${l}" must be non-empty and contain no spaces`);
  }
  return [...new Set(labels)];
}

function parseDueDate(due: string | null): string | null {
  if (due === null || due === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) {
    throw new LumoError("invalid_input", "Due date must be YYYY-MM-DD");
  }
  return due;
}

const str = (v: SQLInputValue | undefined) => (v === null || v === undefined ? null : String(v));

function toUser(r: Row): User {
  return { id: String(r.id), username: String(r.username), displayName: String(r.display_name), email: String(r.email) };
}

function toProject(r: Row): Project {
  return {
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    description: String(r.description),
    leadId: str(r.lead_id),
    workflowId: String(r.workflow_id),
    createdAt: String(r.created_at),
  };
}

function toIssue(r: Row): Issue {
  return {
    id: String(r.id),
    key: String(r.key),
    projectId: String(r.project_id),
    number: Number(r.number),
    type: r.type as IssueType,
    summary: String(r.summary),
    description: String(r.description),
    statusId: String(r.status_id),
    priority: r.priority as Priority,
    assigneeId: str(r.assignee_id),
    reporterId: str(r.reporter_id),
    parentId: str(r.parent_id),
    labels: JSON.parse(String(r.labels)) as string[],
    dueDate: str(r.due_date),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    resolvedAt: str(r.resolved_at),
  };
}

function toComment(r: Row): Comment {
  return {
    id: String(r.id),
    issueId: String(r.issue_id),
    authorId: String(r.author_id),
    body: String(r.body),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
