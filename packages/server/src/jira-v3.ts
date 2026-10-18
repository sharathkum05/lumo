import {
  adfToText,
  ISSUE_TYPES,
  LumoError,
  PRIORITIES,
  type Comment,
  type IssueRecord,
  type Project,
  type Status,
  type StatusCategory,
  type Transition,
  textToAdf,
  type User,
} from "@lumo/core";
import { intParam, obj, reply, Router } from "./router.ts";
import type { LumoService, UpdateIssueInput } from "./service.ts";

// A subset of Jira Cloud's REST API v3, so existing Jira clients and scripts work against Lumo.
// Shapes follow Atlassian's public API documentation; see docs/jira-compat.md for what is covered.

const jiraError = (_status: number, message: string) => ({ errorMessages: [message], errors: {} });

const CATEGORIES: Record<StatusCategory, { id: number; key: string; name: string; colorName: string }> = {
  todo: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
  in_progress: { id: 4, key: "indeterminate", name: "In Progress", colorName: "yellow" },
  done: { id: 3, key: "done", name: "Done", colorName: "green" },
};

// Stable numeric ids, as Jira clients often send ids rather than names.
const typeId = (name: string) => String(10000 + ISSUE_TYPES.indexOf(name as never));
const priorityId = (name: string) => String(1 + PRIORITIES.indexOf(name as never));

/** Jira timestamps look like 2026-10-18T09:30:00.000+0000. */
const jiraTime = (iso: string | null) => (iso ? iso.replace("Z", "+0000") : null);

export function jiraV3(svc: LumoService): Router {
  const r = new Router("/rest/api/3", jiraError);

  const userJson = (base: string, u: User | null) =>
    u && {
      self: `${base}/rest/api/3/user?accountId=${u.id}`,
      accountId: u.id,
      accountType: "atlassian",
      emailAddress: u.email,
      displayName: u.displayName,
      active: true,
      timeZone: "UTC",
    };

  const projectJson = (base: string, p: Project) => ({
    self: `${base}/rest/api/3/project/${p.id}`,
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    projectTypeKey: "software",
    simplified: false,
    style: "classic",
  });

  const statusJson = (base: string, s: Status) => ({
    self: `${base}/rest/api/3/status/${s.id}`,
    id: s.id,
    name: s.name,
    statusCategory: CATEGORIES[s.category],
  });

  const issueJson = (base: string, rec: IssueRecord, fields: Set<string> | null) => {
    const i = rec.issue;
    const all: Record<string, unknown> = {
      summary: i.summary,
      description: textToAdf(i.description),
      issuetype: { id: typeId(i.type), name: i.type, subtask: i.type === "Subtask" },
      status: statusJson(base, rec.status),
      priority: { id: priorityId(i.priority), name: i.priority },
      assignee: userJson(base, rec.assignee),
      reporter: userJson(base, rec.reporter),
      project: { id: rec.project.id, key: rec.project.key, name: rec.project.name },
      labels: i.labels,
      duedate: i.dueDate,
      created: jiraTime(i.createdAt),
      updated: jiraTime(i.updatedAt),
      resolutiondate: jiraTime(i.resolvedAt),
      parent: rec.parentKey ? { key: rec.parentKey } : null,
    };
    const selected = fields ? Object.fromEntries(Object.entries(all).filter(([k]) => fields.has(k))) : all;
    return { id: i.id, key: i.key, self: `${base}/rest/api/3/issue/${i.id}`, fields: selected };
  };

  const commentJson = (base: string, issueId: string, c: Comment, author: User | null) => ({
    self: `${base}/rest/api/3/issue/${issueId}/comment/${c.id}`,
    id: c.id,
    author: userJson(base, author),
    updateAuthor: userJson(base, author),
    body: textToAdf(c.body),
    created: jiraTime(c.createdAt),
    updated: jiraTime(c.updatedAt),
  });

  const transitionJson = (base: string, rec: IssueRecord, t: Transition) => {
    const to = svc.getWorkflow(rec.project.workflowId).statuses.find((s) => s.id === t.to)!;
    return {
      id: t.id,
      name: t.name,
      to: statusJson(base, to),
      hasScreen: false,
      isGlobal: t.from.length === 0,
      isInitial: false,
      isAvailable: true,
      isConditional: false,
    };
  };

  // --- Server and users ---

  r.get(
    "/serverInfo",
    ({ baseUrl }) => ({ baseUrl, version: "1001.0.0", deploymentType: "Cloud", serverTitle: "Lumo", buildNumber: 100000 }),
    { public: true },
  );
  r.get("/myself", ({ baseUrl, user }) => userJson(baseUrl, user));
  r.get("/user", ({ baseUrl, query }) => userJson(baseUrl, svc.getUser(query.get("accountId") ?? "")));
  r.get("/users/search", ({ baseUrl }) => svc.listUsers().map((u) => userJson(baseUrl, u)));
  r.get("/user/search", ({ baseUrl, query }) => {
    const q = (query.get("query") ?? "").toLowerCase();
    return svc
      .listUsers()
      .filter((u) => [u.username, u.displayName, u.email].some((s) => s.toLowerCase().includes(q)))
      .map((u) => userJson(baseUrl, u));
  });

  // --- Projects ---

  r.get("/project", ({ baseUrl }) => svc.listProjects().map((p) => projectJson(baseUrl, p)));
  r.get("/project/search", ({ baseUrl, query }) => {
    const all = svc.listProjects();
    const startAt = intParam(query, "startAt", 0);
    const maxResults = intParam(query, "maxResults", 50);
    const values = all.slice(startAt, startAt + maxResults).map((p) => projectJson(baseUrl, p));
    return { startAt, maxResults, total: all.length, isLast: startAt + values.length >= all.length, values };
  });
  r.get("/project/:key", ({ baseUrl, params }) => {
    const p = svc.getProject(params.key!);
    return {
      ...projectJson(baseUrl, p),
      lead: userJson(baseUrl, p.leadId ? svc.findUser(p.leadId) : null),
      issueTypes: ISSUE_TYPES.map((t) => ({ id: typeId(t), name: t, subtask: t === "Subtask" })),
    };
  });
  r.get("/project/:key/statuses", ({ baseUrl, params }) => {
    const statuses = svc.getWorkflow(svc.getProject(params.key!).workflowId).statuses.map((s) => statusJson(baseUrl, s));
    return ISSUE_TYPES.map((t) => ({ id: typeId(t), name: t, subtask: t === "Subtask", statuses }));
  });
  r.get("/priority", () => PRIORITIES.map((p) => ({ id: priorityId(p), name: p })));
  r.get("/issuetype", () => ISSUE_TYPES.map((t) => ({ id: typeId(t), name: t, subtask: t === "Subtask" })));

  // --- Search ---

  const search = (baseUrl: string, user: User | null, jql: string, startAt: number, maxResults: number, fields: Set<string> | null) => {
    const result = svc.search(jql, user, startAt, maxResults);
    return { ...result, issues: result.issues.map((rec) => issueJson(baseUrl, rec, fields)) };
  };

  // Legacy offset search. Atlassian is retiring it in favour of /search/jql, but many tools still call it.
  r.get("/search", ({ baseUrl, user, query }) =>
    search(baseUrl, user, query.get("jql") ?? "", intParam(query, "startAt", 0), intParam(query, "maxResults", 50), fieldsParam(query.get("fields"))),
  );
  r.post("/search", ({ baseUrl, user, body }) => {
    const b = obj(body);
    return search(baseUrl, user, String(b.jql ?? ""), Number(b.startAt ?? 0), Number(b.maxResults ?? 50), fieldsParam(b.fields));
  });

  // Token-paginated search, the current Jira Cloud endpoint.
  const searchJql = (baseUrl: string, user: User | null, jql: string, token: string | null, maxResults: number, fields: unknown) => {
    const startAt = token ? decodePageToken(token) : 0;
    const result = search(baseUrl, user, jql, startAt, maxResults, fieldsParam(fields) ?? new Set(["id"]));
    const next = startAt + result.issues.length;
    return {
      issues: result.issues,
      isLast: next >= result.total,
      ...(next < result.total ? { nextPageToken: Buffer.from(String(next)).toString("base64url") } : {}),
    };
  };
  r.get("/search/jql", ({ baseUrl, user, query }) =>
    searchJql(baseUrl, user, query.get("jql") ?? "", query.get("nextPageToken"), intParam(query, "maxResults", 50), query.get("fields")),
  );
  r.post("/search/jql", ({ baseUrl, user, body }) => {
    const b = obj(body);
    return searchJql(baseUrl, user, String(b.jql ?? ""), typeof b.nextPageToken === "string" ? b.nextPageToken : null, Number(b.maxResults ?? 50), b.fields);
  });

  // --- Issues ---

  r.post("/issue", ({ baseUrl, body, user }) => {
    const fields = obj(obj(body).fields);
    const project = obj(fields.project ?? {});
    const ref = String(project.key ?? project.id ?? "");
    if (!ref) throw new LumoError("invalid_input", "Field 'project' is required");
    const rec = svc.createIssue(
      { ...updateFields(fields), project: ref, summary: String(fields.summary ?? ""), type: refName(fields.issuetype, typeFromId) ?? "Task" },
      user,
    );
    return reply(201, { id: rec.issue.id, key: rec.issue.key, self: `${baseUrl}/rest/api/3/issue/${rec.issue.id}` });
  });
  r.get("/issue/:key", ({ baseUrl, params, query }) => issueJson(baseUrl, svc.getIssue(params.key!), fieldsParam(query.get("fields"))));
  r.put("/issue/:key", ({ params, body }) => {
    svc.updateIssue(params.key!, updateFields(obj(obj(body).fields ?? {})));
    return reply(204);
  });
  r.delete("/issue/:key", ({ params }) => {
    svc.deleteIssue(params.key!);
    return reply(204);
  });

  r.get("/issue/:key/transitions", ({ baseUrl, params }) => {
    const rec = svc.getIssue(params.key!);
    return { expand: "transitions", transitions: svc.listTransitions(params.key!).map((t) => transitionJson(baseUrl, rec, t)) };
  });
  r.post("/issue/:key/transitions", ({ params, body }) => {
    const t = obj(obj(body).transition ?? {});
    const ref = t.id ?? t.name;
    if (ref === undefined) throw new LumoError("invalid_input", "'transition' must have an 'id'");
    svc.transitionIssue(params.key!, String(ref));
    return reply(204);
  });

  r.get("/issue/:key/comment", ({ baseUrl, params, query }) => {
    const rec = svc.getIssue(params.key!);
    const all = svc.listComments(params.key!);
    const startAt = intParam(query, "startAt", 0);
    const maxResults = intParam(query, "maxResults", 50);
    const comments = all.slice(startAt, startAt + maxResults).map((c) => commentJson(baseUrl, rec.issue.id, c, c.author));
    return { startAt, maxResults, total: all.length, comments };
  });
  r.post("/issue/:key/comment", ({ baseUrl, params, body, user }) => {
    if (!user) throw new LumoError("unauthorized", "Authentication required");
    const rec = svc.getIssue(params.key!);
    const comment = svc.addComment(params.key!, adfToText(obj(body).body), user);
    return reply(201, commentJson(baseUrl, rec.issue.id, comment, user));
  });

  return r;
}

/** Jira identifies things as {id}, {name}, {key} or {accountId}; return whichever is present as a string. */
function refName(value: unknown, fromId?: (id: string) => string | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  const o = obj(value);
  if (typeof o.name === "string") return o.name;
  if (o.id !== undefined) return fromId?.(String(o.id)) ?? String(o.id);
  for (const k of ["key", "accountId", "emailAddress"]) if (typeof o[k] === "string") return o[k] as string;
  return undefined;
}

const typeFromId = (id: string) => ISSUE_TYPES[Number(id) - 10000];
const priorityFromId = (id: string) => PRIORITIES[Number(id) - 1];

function updateFields(f: Record<string, unknown>): UpdateIssueInput {
  const out: UpdateIssueInput = {};
  if ("summary" in f) out.summary = String(f.summary ?? "");
  if ("description" in f) out.description = adfToText(f.description);
  if ("issuetype" in f) out.type = refName(f.issuetype, typeFromId);
  if ("priority" in f) out.priority = refName(f.priority, priorityFromId);
  if ("assignee" in f) out.assignee = f.assignee === null ? null : (refName(f.assignee) ?? null);
  if ("labels" in f) {
    if (!Array.isArray(f.labels)) throw new LumoError("invalid_input", "Field 'labels' must be an array");
    out.labels = f.labels.map(String);
  }
  if ("duedate" in f) out.dueDate = f.duedate === null ? null : String(f.duedate);
  if ("parent" in f) out.parent = f.parent === null ? null : (refName(f.parent) ?? null);
  return out;
}

/** `fields=summary,status` or ["summary","status"]; `*all` / `*navigable` / absent mean everything. */
function fieldsParam(value: unknown): Set<string> | null {
  if (value === null || value === undefined || value === "") return null;
  const list = Array.isArray(value) ? value.map(String) : String(value).split(",");
  const names = list.map((s) => s.trim()).filter(Boolean);
  if (names.some((n) => n === "*all" || n === "*navigable")) return null;
  return new Set(names);
}

function decodePageToken(token: string): number {
  const n = Number(Buffer.from(token, "base64url").toString("utf8"));
  if (!Number.isInteger(n) || n < 0) throw new LumoError("invalid_input", "Invalid nextPageToken");
  return n;
}
