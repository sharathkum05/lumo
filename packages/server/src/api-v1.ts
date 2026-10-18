import { LumoError, type Comment, type IssueRecord, type Project, type User } from "@lumo/core";
import { intParam, obj, reply, optNullableString, optString, optStringArray, Router } from "./router.ts";
import type { LumoService, UpdateIssueInput } from "./service.ts";

// Lumo's native API. Its JSON shapes are the contract for @lumo/client; change them additively.

export const userView = (u: User) => ({ id: u.id, username: u.username, displayName: u.displayName, email: u.email });

export const projectView = (p: Project) => ({ id: p.id, key: p.key, name: p.name, description: p.description, leadId: p.leadId });

export function issueView(r: IssueRecord) {
  const i = r.issue;
  return {
    id: i.id,
    key: i.key,
    project: { key: r.project.key, name: r.project.name },
    type: i.type,
    summary: i.summary,
    description: i.description,
    status: { id: r.status.id, name: r.status.name, category: r.status.category },
    priority: i.priority,
    assignee: r.assignee ? userView(r.assignee) : null,
    reporter: r.reporter ? userView(r.reporter) : null,
    parent: r.parentKey,
    labels: i.labels,
    dueDate: i.dueDate,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    resolvedAt: i.resolvedAt,
  };
}

const commentView = (c: Comment & { author: User | null }) => ({
  id: c.id,
  body: c.body,
  author: c.author ? userView(c.author) : null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

function issueInput(body: Record<string, unknown>): UpdateIssueInput {
  return {
    summary: optString(body, "summary"),
    description: optString(body, "description"),
    type: optString(body, "type"),
    priority: optString(body, "priority"),
    assignee: optNullableString(body, "assignee"),
    labels: optStringArray(body, "labels"),
    dueDate: optNullableString(body, "dueDate"),
    parent: optNullableString(body, "parent"),
  };
}

function requireUser(user: User | null): User {
  if (!user) throw new LumoError("unauthorized", "Authentication required");
  return user;
}

export function apiV1(svc: LumoService): Router {
  const r = new Router("/api/v1");

  r.get("/health", () => ({ ok: true }), { public: true });
  r.get("/myself", ({ user }) => userView(requireUser(user)));

  r.get("/users", () => svc.listUsers().map(userView));
  r.post("/users", ({ body }) => {
    const b = obj(body);
    const user = svc.createUser({
      username: optString(b, "username") ?? "",
      displayName: optString(b, "displayName"),
      email: optString(b, "email") ?? "",
    });
    return reply(201, userView(user));
  });

  r.get("/projects", () => svc.listProjects().map(projectView));
  r.post("/projects", ({ body }) => {
    const b = obj(body);
    const project = svc.createProject({
      key: optString(b, "key") ?? "",
      name: optString(b, "name") ?? "",
      description: optString(b, "description"),
      lead: optNullableString(b, "lead"),
    });
    return reply(201, projectView(project));
  });
  r.get("/projects/:key", ({ params }) => {
    const project = svc.getProject(params.key!);
    const workflow = svc.getWorkflow(project.workflowId);
    return { ...projectView(project), statuses: workflow.statuses };
  });

  r.get("/search", ({ query, user }) => {
    const result = svc.search(query.get("jql") ?? "", user, intParam(query, "startAt", 0), intParam(query, "maxResults", 50));
    return { ...result, issues: result.issues.map(issueView) };
  });

  r.post("/issues", ({ body, user }) => {
    const b = obj(body);
    const record = svc.createIssue({ ...issueInput(b), project: optString(b, "project") ?? "", summary: optString(b, "summary") ?? "" }, user);
    return reply(201, issueView(record));
  });
  r.get("/issues/:key", ({ params }) => issueView(svc.getIssue(params.key!)));
  r.patch("/issues/:key", ({ params, body }) => issueView(svc.updateIssue(params.key!, issueInput(obj(body)))));
  r.delete("/issues/:key", ({ params }) => {
    svc.deleteIssue(params.key!);
    return reply(204);
  });

  r.get("/issues/:key/transitions", ({ params }) => {
    const { project } = svc.getIssue(params.key!);
    const statuses = svc.getWorkflow(project.workflowId).statuses;
    return svc.listTransitions(params.key!).map((t) => ({
      id: t.id,
      name: t.name,
      to: statuses.find((s) => s.id === t.to)!,
    }));
  });
  r.post("/issues/:key/transitions", ({ params, body }) => {
    const transition = optString(obj(body), "transition");
    if (!transition) throw new LumoError("invalid_input", '"transition" is required');
    return issueView(svc.transitionIssue(params.key!, transition));
  });

  r.get("/issues/:key/comments", ({ params }) => svc.listComments(params.key!).map(commentView));
  r.post("/issues/:key/comments", ({ params, body, user }) => {
    const author = requireUser(user);
    const comment = svc.addComment(params.key!, optString(obj(body), "body") ?? "", author);
    return reply(201, commentView({ ...comment, author }));
  });

  return r;
}
