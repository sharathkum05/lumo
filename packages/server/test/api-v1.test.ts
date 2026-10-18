import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.ts";

test("health is public, everything else needs a token", async () => {
  const { call } = await startServer();
  assert.equal((await call("GET", "/api/v1/health", undefined, { authorization: "" })).status, 200);
  const res = await call("GET", "/api/v1/projects", undefined, { authorization: "Bearer lumo_nope" });
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "Authentication required" });
});

test("Jira-style Basic auth (email:token)", async () => {
  const { call, token } = await startServer();
  const basic = (login: string) => ({ authorization: `Basic ${Buffer.from(`${login}:${token}`).toString("base64")}` });
  assert.equal((await call("GET", "/api/v1/myself", undefined, basic("ana@example.com"))).body.username, "ana");
  assert.equal((await call("GET", "/api/v1/myself", undefined, basic("raj@example.com"))).status, 401);
});

test("issue lifecycle over HTTP", async () => {
  const { call } = await startServer();

  const created = await call("POST", "/api/v1/issues", { project: "WEB", summary: "Fix login", type: "Bug", assignee: "ana" });
  assert.equal(created.status, 201);
  assert.equal(created.body.key, "WEB-1");
  assert.equal(created.body.status.name, "To Do");
  assert.equal(created.body.reporter.username, "ana");

  const patched = await call("PATCH", "/api/v1/issues/WEB-1", { priority: "High", labels: ["auth"] });
  assert.equal(patched.body.priority, "High");
  assert.deepEqual(patched.body.labels, ["auth"]);

  const transitions = await call("GET", "/api/v1/issues/WEB-1/transitions");
  assert.deepEqual(transitions.body.map((t: { name: string }) => t.name), ["Start", "Done"]);
  const moved = await call("POST", "/api/v1/issues/WEB-1/transitions", { transition: "In Progress" });
  assert.equal(moved.body.status.name, "In Progress");

  const comment = await call("POST", "/api/v1/issues/WEB-1/comments", { body: "On it" });
  assert.equal(comment.status, 201);
  assert.equal((await call("GET", "/api/v1/issues/WEB-1/comments")).body[0].author.username, "ana");

  const search = await call("GET", `/api/v1/search?jql=${encodeURIComponent("assignee = currentUser() AND status = 'In Progress'")}`);
  assert.equal(search.body.total, 1);
  assert.equal(search.body.issues[0].key, "WEB-1");

  assert.equal((await call("DELETE", "/api/v1/issues/WEB-1")).status, 204);
  assert.equal((await call("GET", "/api/v1/issues/WEB-1")).status, 404);
});

test("errors map to HTTP statuses", async () => {
  const { call } = await startServer();
  assert.equal((await call("POST", "/api/v1/issues", { project: "WEB" })).status, 400);
  assert.equal((await call("POST", "/api/v1/projects", { key: "WEB", name: "Dup" })).status, 409);
  assert.equal((await call("GET", "/api/v1/search?jql=project%20%3D")).status, 400);
  assert.equal((await call("PUT", "/api/v1/projects")).status, 405);
  assert.equal((await call("GET", "/api/v1/nope")).status, 404);
  assert.equal((await call("POST", "/api/v1/issues", { project: "WEB", summary: 5 })).body.error, '"summary" must be a string');
});

test("invalid JSON is a 400", async () => {
  const { base, token } = await startServer();
  const res = await fetch(`${base}/api/v1/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{nope",
  });
  assert.equal(res.status, 400);
});
