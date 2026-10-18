import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { createApp, LumoService, openDatabase } from "@lumo/server";
import { createClient, type TrackerClient } from "../src/index.ts";

// The same contract runs through both backends. The Jira backend talks to Lumo's /rest/api/3,
// so this also checks that Lumo's Jira compatibility is good enough for a real Jira client.

async function start(backend: "lumo" | "jira"): Promise<TrackerClient> {
  const svc = new LumoService(openDatabase(":memory:"));
  const ana = svc.createUser({ username: "ana", displayName: "Ana Silva", email: "ana@example.com" });
  svc.createUser({ username: "raj", displayName: "Raj Patel", email: "raj@example.com" });
  svc.createProject({ key: "WEB", name: "Website" });
  const token = svc.createApiToken(ana.id, "test");
  const server = createApp(svc);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return createClient({ backend, url, token, email: "ana@example.com" });
}

for (const backend of ["lumo", "jira"] as const) {
  describe(`${backend} backend`, () => {
    test("myself and projects", async () => {
      const client = await start(backend);
      assert.equal((await client.myself()).email, "ana@example.com");
      assert.deepEqual((await client.listProjects()).map((p) => p.key), ["WEB"]);
    });

    test("create, get and update an issue", async () => {
      const client = await start(backend);
      const created = await client.createIssue("WEB", {
        summary: "Fix login",
        type: "Bug",
        description: "Steps:\n1. open page\n\nExpected: works",
        priority: "High",
        assignee: "raj@example.com",
        labels: ["auth"],
        dueDate: "2026-11-01",
      });
      assert.equal(created.key, "WEB-1");
      assert.equal(created.type, "Bug");
      assert.equal(created.priority, "High");
      assert.equal(created.assignee?.email, "raj@example.com");
      assert.equal(created.description, "Steps:\n1. open page\n\nExpected: works");
      assert.equal(created.status.category, "todo");
      assert.equal(created.dueDate, "2026-11-01");
      assert.match(created.createdAt, /Z$/);

      const updated = await client.updateIssue("WEB-1", { summary: "Fix login on Safari", assignee: null });
      assert.equal(updated.summary, "Fix login on Safari");
      assert.equal(updated.assignee, null);
      assert.equal((await client.getIssue("WEB-1")).labels[0], "auth");
    });

    test("transitions by name or target status", async () => {
      const client = await start(backend);
      await client.createIssue("WEB", { summary: "Ship" });
      assert.deepEqual((await client.listTransitions("WEB-1")).map((t) => `${t.name} -> ${t.to}`), ["Start -> In Progress", "Done -> Done"]);
      assert.equal((await client.transitionIssue("WEB-1", "start")).status.name, "In Progress");
      const done = await client.transitionIssue("WEB-1", "Done");
      assert.equal(done.status.category, "done");
      assert.ok(done.resolvedAt);
      await assert.rejects(client.transitionIssue("WEB-1", "Start"), /Cannot apply "Start"/);
    });

    test("search with JQL and pagination", async () => {
      const client = await start(backend);
      for (let i = 1; i <= 3; i++) await client.createIssue("WEB", { summary: `Task ${i}`, assignee: i === 2 ? "raj" : "ana" });
      const mine = await client.search("assignee = currentUser() ORDER BY key");
      assert.deepEqual(mine.issues.map((i) => i.key), ["WEB-1", "WEB-3"]);
      assert.equal(mine.issues[0]?.summary, "Task 1");

      const first = await client.search("project = WEB ORDER BY key", { maxResults: 2 });
      assert.equal(first.issues.length, 2);
      assert.ok(first.nextPage);
      const second = await client.search("project = WEB ORDER BY key", { maxResults: 2, page: first.nextPage! });
      assert.deepEqual(second.issues.map((i) => i.key), ["WEB-3"]);
      assert.equal(second.nextPage, undefined);

      await assert.rejects(client.search("project ="), /400/);
    });

    test("comments", async () => {
      const client = await start(backend);
      await client.createIssue("WEB", { summary: "Discuss" });
      const c = await client.addComment("WEB-1", "First line\nsecond line");
      assert.equal(c.author?.email, "ana@example.com");
      const all = await client.listComments("WEB-1");
      assert.deepEqual(all.map((x) => x.body), ["First line\nsecond line"]);
    });

    test("missing issues are errors", async () => {
      const client = await start(backend);
      await assert.rejects(client.getIssue("WEB-99"), /404/);
    });
  });
}
