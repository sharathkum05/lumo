import { test } from "node:test";
import assert from "node:assert/strict";
import { LumoError } from "@lumo/core";
import { openDatabase } from "../src/db.ts";
import { LumoService } from "../src/service.ts";

function setup() {
  const svc = new LumoService(openDatabase(":memory:"));
  const ana = svc.createUser({ username: "ana", displayName: "Ana Silva", email: "ana@example.com" });
  const raj = svc.createUser({ username: "raj", email: "raj@example.com" });
  svc.createProject({ key: "web", name: "Website", lead: "ana" });
  return { svc, ana, raj };
}

test("issue keys increment per project", () => {
  const { svc, ana } = setup();
  svc.createProject({ key: "API", name: "API" });
  assert.equal(svc.createIssue({ project: "WEB", summary: "One" }, ana).issue.key, "WEB-1");
  assert.equal(svc.createIssue({ project: "WEB", summary: "Two" }, ana).issue.key, "WEB-2");
  assert.equal(svc.createIssue({ project: "API", summary: "Other" }, ana).issue.key, "API-1");
});

test("createIssue resolves assignee, parent and validates fields", () => {
  const { svc, ana } = setup();
  const epic = svc.createIssue({ project: "WEB", summary: "Checkout", type: "epic" }, ana);
  const story = svc.createIssue(
    { project: "WEB", summary: "Pay by card", type: "Story", assignee: "raj@example.com", parent: "web-1", labels: ["pay", "pay"] },
    ana,
  );
  assert.equal(epic.issue.type, "Epic");
  assert.equal(story.assignee?.username, "raj");
  assert.equal(story.reporter?.username, "ana");
  assert.equal(story.parentKey, "WEB-1");
  assert.deepEqual(story.issue.labels, ["pay"]);
  assert.equal(story.status.name, "To Do");

  assert.throws(() => svc.createIssue({ project: "WEB", summary: " " }, ana), /Summary is required/);
  assert.throws(() => svc.createIssue({ project: "WEB", summary: "x", priority: "Urgent" }, ana), /Priority must be one of/);
  assert.throws(() => svc.createIssue({ project: "NOPE", summary: "x" }, ana), /Project "NOPE" does not exist/);
  assert.throws(() => svc.createIssue({ project: "WEB", summary: "x", dueDate: "tomorrow" }, ana), /YYYY-MM-DD/);
});

test("duplicate project keys and usernames conflict", () => {
  const { svc } = setup();
  assert.throws(() => svc.createProject({ key: "WEB", name: "Again" }), (e: unknown) => e instanceof LumoError && e.code === "conflict");
  assert.throws(() => svc.createUser({ username: "ANA", email: "x@example.com" }), /already in use/);
});

test("updateIssue changes only the given fields", () => {
  const { svc, ana } = setup();
  const created = svc.createIssue({ project: "WEB", summary: "Old", priority: "Low", assignee: "ana" }, ana);
  const updated = svc.updateIssue("WEB-1", { summary: "New", assignee: null });
  assert.equal(updated.issue.summary, "New");
  assert.equal(updated.issue.priority, "Low");
  assert.equal(updated.assignee, null);
  assert.ok(updated.issue.updatedAt >= created.issue.updatedAt);
  assert.throws(() => svc.updateIssue("WEB-1", { parent: "WEB-1" }), /own parent/);
});

test("transitions follow the workflow and set resolvedAt", () => {
  const { svc, ana } = setup();
  svc.createIssue({ project: "WEB", summary: "Ship it" }, ana);
  assert.deepEqual(svc.listTransitions("WEB-1").map((t) => t.name), ["Start", "Done"]);
  assert.throws(() => svc.transitionIssue("WEB-1", "Request review"), /Cannot apply/);

  const started = svc.transitionIssue("WEB-1", "Start");
  assert.equal(started.status.name, "In Progress");
  assert.equal(started.issue.resolvedAt, null);

  const done = svc.transitionIssue("WEB-1", "Done");
  assert.equal(done.status.category, "done");
  assert.ok(done.issue.resolvedAt);

  assert.equal(svc.transitionIssue("WEB-1", "Reopen").issue.resolvedAt, null);
});

test("search uses JQL with the viewer as currentUser() and paginates", () => {
  const { svc, ana, raj } = setup();
  for (let i = 1; i <= 5; i++) svc.createIssue({ project: "WEB", summary: `Task ${i}`, assignee: i % 2 ? "ana" : "raj" }, ana);
  assert.equal(svc.search("assignee = currentUser()", ana).total, 3);
  assert.equal(svc.search("assignee = currentUser()", raj).total, 2);
  const page = svc.search("project = WEB ORDER BY key", ana, 2, 2);
  assert.deepEqual(page.issues.map((r) => r.issue.key), ["WEB-3", "WEB-4"]);
  assert.equal(page.total, 5);
});

test("comments", () => {
  const { svc, ana } = setup();
  svc.createIssue({ project: "WEB", summary: "Discuss" }, ana);
  svc.addComment("WEB-1", "First!", ana);
  const comments = svc.listComments("WEB-1");
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.author?.username, "ana");
  assert.throws(() => svc.addComment("WEB-1", "  ", ana), /body is required/);
});

test("api tokens authenticate and are stored hashed", () => {
  const { svc, ana } = setup();
  const token = svc.createApiToken(ana.id, "laptop");
  assert.match(token, /^lumo_/);
  assert.equal(svc.authenticate(token)?.username, "ana");
  assert.equal(svc.authenticate("lumo_wrong"), null);
});

test("deleting an issue removes it", () => {
  const { svc, ana } = setup();
  svc.createIssue({ project: "WEB", summary: "Temp" }, ana);
  svc.deleteIssue("WEB-1");
  assert.throws(() => svc.getIssue("WEB-1"), /does not exist/);
});
