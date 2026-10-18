import { test } from "node:test";
import assert from "node:assert/strict";
import { adfToText, textToAdf } from "@lumo/core";
import { startServer } from "./helpers.ts";

const adf = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

test("ADF round-trips paragraphs and line breaks", () => {
  const text = "First line\nsecond line\n\nNew paragraph";
  assert.equal(adfToText(textToAdf(text)), text);
  assert.equal(textToAdf(""), null);
  assert.equal(adfToText("plain v2 string"), "plain v2 string");
  assert.equal(
    adfToText({
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
      ],
    }),
    "- a",
  );
});

test("create, read, update and delete issues the Jira way", async () => {
  const { call, svc } = await startServer();
  const raj = svc.findUser("raj")!;

  const created = await call("POST", "/rest/api/3/issue", {
    fields: {
      project: { key: "WEB" },
      summary: "Checkout fails",
      issuetype: { name: "Bug" },
      description: adf("Steps to reproduce"),
      priority: { id: "2" },
      assignee: { accountId: raj.id },
      labels: ["checkout"],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.key, "WEB-1");
  assert.match(created.body.self, /^http:\/\/127\.0\.0\.1:\d+\/rest\/api\/3\/issue\//);

  const { body: issue } = await call("GET", "/rest/api/3/issue/WEB-1");
  assert.equal(issue.fields.summary, "Checkout fails");
  assert.equal(issue.fields.issuetype.name, "Bug");
  assert.equal(issue.fields.priority.name, "High");
  assert.equal(issue.fields.assignee.accountId, raj.id);
  assert.equal(issue.fields.status.statusCategory.key, "new");
  assert.deepEqual(issue.fields.description, adf("Steps to reproduce"));
  assert.match(issue.fields.created, /\+0000$/);

  const subset = await call("GET", "/rest/api/3/issue/WEB-1?fields=summary,status");
  assert.deepEqual(Object.keys(subset.body.fields).sort(), ["status", "summary"]);

  assert.equal((await call("PUT", "/rest/api/3/issue/WEB-1", { fields: { summary: "Checkout fails on Safari", assignee: null } })).status, 204);
  const updated = (await call("GET", "/rest/api/3/issue/WEB-1")).body;
  assert.equal(updated.fields.summary, "Checkout fails on Safari");
  assert.equal(updated.fields.assignee, null);

  assert.equal((await call("DELETE", "/rest/api/3/issue/WEB-1")).status, 204);
  const missing = await call("GET", "/rest/api/3/issue/WEB-1");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { errorMessages: ['Issue "WEB-1" does not exist'], errors: {} });
});

test("transitions", async () => {
  const { call } = await startServer();
  await call("POST", "/rest/api/3/issue", { fields: { project: { key: "WEB" }, summary: "Task", issuetype: { name: "Task" } } });

  const { body } = await call("GET", "/rest/api/3/issue/WEB-1/transitions");
  const start = body.transitions.find((t: { name: string }) => t.name === "Start");
  assert.equal(start.to.name, "In Progress");
  assert.equal(start.to.statusCategory.key, "indeterminate");

  assert.equal((await call("POST", "/rest/api/3/issue/WEB-1/transitions", { transition: { id: start.id } })).status, 204);
  assert.equal((await call("GET", "/rest/api/3/issue/WEB-1")).body.fields.status.name, "In Progress");
  assert.equal((await call("POST", "/rest/api/3/issue/WEB-1/transitions", { transition: { id: "51" } })).status, 400);
});

test("comments use ADF bodies", async () => {
  const { call } = await startServer();
  await call("POST", "/rest/api/3/issue", { fields: { project: { key: "WEB" }, summary: "Task", issuetype: { id: "10002" } } });
  const posted = await call("POST", "/rest/api/3/issue/WEB-1/comment", { body: adf("Looks good") });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.author.emailAddress, "ana@example.com");

  const list = await call("GET", "/rest/api/3/issue/WEB-1/comment");
  assert.equal(list.body.total, 1);
  assert.deepEqual(list.body.comments[0].body, adf("Looks good"));
});

test("legacy /search and token-paginated /search/jql", async () => {
  const { call } = await startServer();
  for (let i = 1; i <= 3; i++) {
    await call("POST", "/rest/api/3/issue", { fields: { project: { key: "WEB" }, summary: `Task ${i}`, issuetype: { name: "Task" } } });
  }

  const legacy = await call("POST", "/rest/api/3/search", { jql: "project = WEB ORDER BY key", maxResults: 2, fields: ["summary"] });
  assert.equal(legacy.body.total, 3);
  assert.deepEqual(legacy.body.issues.map((i: { key: string }) => i.key), ["WEB-1", "WEB-2"]);
  assert.deepEqual(Object.keys(legacy.body.issues[0].fields), ["summary"]);

  const page1 = await call("GET", `/rest/api/3/search/jql?jql=${encodeURIComponent("project = WEB ORDER BY key")}&maxResults=2&fields=summary`);
  assert.equal(page1.body.isLast, false);
  assert.equal(page1.body.issues.length, 2);
  const page2 = await call("POST", "/rest/api/3/search/jql", { jql: "project = WEB ORDER BY key", maxResults: 2, nextPageToken: page1.body.nextPageToken });
  assert.equal(page2.body.isLast, true);
  assert.equal(page2.body.nextPageToken, undefined);
  assert.equal(page2.body.issues[0].key, "WEB-3");
  // /search/jql returns only ids unless fields are requested, like Jira Cloud.
  assert.deepEqual(page2.body.issues[0].fields, {});
});

test("projects, myself and serverInfo", async () => {
  const { call } = await startServer();
  assert.equal((await call("GET", "/rest/api/3/myself")).body.emailAddress, "ana@example.com");
  assert.equal((await call("GET", "/rest/api/3/serverInfo", undefined, { authorization: "" })).body.deploymentType, "Cloud");
  const projects = await call("GET", "/rest/api/3/project");
  assert.deepEqual(projects.body.map((p: { key: string }) => p.key), ["WEB"]);
  const project = await call("GET", "/rest/api/3/project/WEB");
  assert.equal(project.body.lead.emailAddress, "ana@example.com");
  assert.equal((await call("GET", "/rest/api/3/project/search")).body.isLast, true);
});

test("Jira error format for unauthenticated requests", async () => {
  const { call } = await startServer();
  const res = await call("GET", "/rest/api/3/myself", undefined, { authorization: "" });
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { errorMessages: ["Authentication required"], errors: {} });
});
