import { adfToText, textToAdf } from "@lumo/core";
import { httpClient, type Request } from "./http.ts";
import {
  TrackerError,
  type CommentView,
  type IssueInput,
  type IssueView,
  type ProjectRef,
  type SearchPage,
  type StatusCategory,
  type TrackerClient,
  type TransitionView,
  type UserRef,
} from "./types.ts";

// Talks to Jira Cloud's REST API v3 (or any server that implements it, including Lumo's /rest/api/3).

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
    issuetype: { name: string };
    status: { id: string; name: string; statusCategory: { key: string } };
    priority?: { name: string } | null;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    project: { key: string; name: string };
    parent?: { key: string } | null;
    labels: string[];
    duedate: string | null;
    created: string;
    updated: string;
    resolutiondate: string | null;
  };
}

const ISSUE_FIELDS = [
  "summary",
  "description",
  "issuetype",
  "status",
  "priority",
  "assignee",
  "reporter",
  "project",
  "parent",
  "labels",
  "duedate",
  "created",
  "updated",
  "resolutiondate",
];

const CATEGORY: Record<string, StatusCategory> = { new: "todo", indeterminate: "in_progress", done: "done" };

export class JiraBackend implements TrackerClient {
  readonly backend = "jira";
  private readonly request: Request;

  constructor(opts: { baseUrl: string; email: string; token: string; fetch?: typeof fetch }) {
    this.request = httpClient({
      baseUrl: `${opts.baseUrl.replace(/\/+$/, "")}/rest/api/3`,
      authorization: `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString("base64")}`,
      errorMessage: (body) => {
        const b = body as { errorMessages?: string[]; errors?: Record<string, string> } | undefined;
        const parts = [...(b?.errorMessages ?? []), ...Object.entries(b?.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
        return parts.length ? parts.join("; ") : undefined;
      },
      fetch: opts.fetch,
    });
  }

  async myself() {
    return toUser((await this.request<JiraUser>("GET", "/myself"))!);
  }

  async listProjects(): Promise<ProjectRef[]> {
    const projects: ProjectRef[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.request<{ values: Array<{ id: string; key: string; name: string; description?: string }>; isLast: boolean }>(
        "GET",
        `/project/search?startAt=${startAt}&maxResults=50`,
      );
      projects.push(...page.values.map((p) => ({ id: p.id, key: p.key, name: p.name, description: p.description ?? "" })));
      if (page.isLast || page.values.length === 0) return projects;
      startAt += page.values.length;
    }
  }

  async search(jql: string, opts: { maxResults?: number; page?: string } = {}): Promise<SearchPage> {
    const res = await this.request<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>("POST", "/search/jql", {
      jql,
      maxResults: opts.maxResults ?? 50,
      fields: ISSUE_FIELDS,
      ...(opts.page ? { nextPageToken: opts.page } : {}),
    });
    const issues = res.issues.map(toIssue);
    return res.nextPageToken && !res.isLast ? { issues, nextPage: res.nextPageToken } : { issues };
  }

  async getIssue(key: string) {
    return toIssue(await this.request<JiraIssue>("GET", `/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(",")}`));
  }

  async createIssue(project: string, input: IssueInput & { summary: string }) {
    const fields = await this.toFields({ type: "Task", ...input });
    const created = await this.request<{ key: string }>("POST", "/issue", { fields: { project: { key: project }, ...fields } });
    return this.getIssue(created.key);
  }

  async updateIssue(key: string, input: IssueInput) {
    await this.request("PUT", `/issue/${encodeURIComponent(key)}`, { fields: await this.toFields(input) });
    return this.getIssue(key);
  }

  async listTransitions(key: string): Promise<TransitionView[]> {
    const res = await this.request<{ transitions: Array<{ id: string; name: string; to: { name: string } }> }>(
      "GET",
      `/issue/${encodeURIComponent(key)}/transitions`,
    );
    return res.transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name }));
  }

  async transitionIssue(key: string, transition: string) {
    // Jira only accepts transition ids, so resolve names the same way Lumo does.
    const options = await this.listTransitions(key);
    const wanted = transition.toLowerCase();
    const match =
      options.find((t) => t.id === transition) ??
      options.find((t) => t.name.toLowerCase() === wanted) ??
      options.find((t) => t.to.toLowerCase() === wanted);
    if (!match) {
      const names = options.map((t) => `"${t.name}"`).join(", ") || "none";
      throw new TrackerError(400, `400: Cannot apply "${transition}" to ${key}. Available: ${names}`);
    }
    await this.request("POST", `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
    return this.getIssue(key);
  }

  async listComments(key: string): Promise<CommentView[]> {
    const comments: CommentView[] = [];
    for (let startAt = 0; ; ) {
      const page = await this.request<{ comments: JiraComment[]; total: number }>(
        "GET",
        `/issue/${encodeURIComponent(key)}/comment?startAt=${startAt}&maxResults=100`,
      );
      comments.push(...page.comments.map(toComment));
      startAt += page.comments.length;
      if (startAt >= page.total || page.comments.length === 0) return comments;
    }
  }

  async addComment(key: string, body: string) {
    return toComment(await this.request<JiraComment>("POST", `/issue/${encodeURIComponent(key)}/comment`, { body: textToAdf(body) }));
  }

  private async toFields(input: IssueInput): Promise<Record<string, unknown>> {
    const f: Record<string, unknown> = {};
    if (input.summary !== undefined) f.summary = input.summary;
    if (input.description !== undefined) f.description = textToAdf(input.description);
    if (input.type !== undefined) f.issuetype = { name: input.type };
    if (input.priority !== undefined) f.priority = { name: input.priority };
    if (input.labels !== undefined) f.labels = input.labels;
    if (input.dueDate !== undefined) f.duedate = input.dueDate;
    if (input.parent !== undefined) f.parent = input.parent === null ? null : { key: input.parent };
    if (input.assignee !== undefined) f.assignee = input.assignee === null ? null : { accountId: await this.accountId(input.assignee) };
    return f;
  }

  /** Jira Cloud only accepts account ids, so look up usernames and emails. */
  private async accountId(ref: string): Promise<string> {
    const users = await this.request<JiraUser[]>("GET", `/user/search?query=${encodeURIComponent(ref)}`);
    const lower = ref.toLowerCase();
    const match =
      users.find((u) => u.accountId === ref) ??
      users.find((u) => u.emailAddress?.toLowerCase() === lower) ??
      users.find((u) => u.displayName.toLowerCase() === lower) ??
      (users.length === 1 ? users[0] : undefined);
    if (match) return match.accountId;
    // Not found by search: assume the caller passed an account id directly.
    if (users.length === 0) return ref;
    throw new TrackerError(400, `400: "${ref}" matches several users; use an account id or email`);
  }
}

interface JiraComment {
  id: string;
  body: unknown;
  author: JiraUser | null;
  created: string;
}

function toUser(u: JiraUser): UserRef {
  return { id: u.accountId, username: u.emailAddress ?? u.accountId, displayName: u.displayName, email: u.emailAddress ?? "" };
}

/** Jira returns 2026-10-18T09:30:00.000+0000; normalise to ISO 8601 with Z. */
function isoTime(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}

function toIssue(i: JiraIssue): IssueView {
  const f = i.fields;
  return {
    id: i.id,
    key: i.key,
    project: { key: f.project.key, name: f.project.name },
    type: f.issuetype.name,
    summary: f.summary,
    description: adfToText(f.description),
    status: { id: f.status.id, name: f.status.name, category: CATEGORY[f.status.statusCategory.key] ?? "todo" },
    priority: f.priority?.name ?? "",
    assignee: f.assignee ? toUser(f.assignee) : null,
    reporter: f.reporter ? toUser(f.reporter) : null,
    parent: f.parent?.key ?? null,
    labels: f.labels ?? [],
    dueDate: f.duedate,
    createdAt: isoTime(f.created)!,
    updatedAt: isoTime(f.updated)!,
    resolvedAt: isoTime(f.resolutiondate),
  };
}

function toComment(c: JiraComment): CommentView {
  return { id: c.id, body: adfToText(c.body), author: c.author ? toUser(c.author) : null, createdAt: isoTime(c.created)! };
}
