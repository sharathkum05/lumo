import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "@lumo/client";
import { createApp, LumoService, openDatabase } from "@lumo/server";
import { createMcpServer } from "../src/server.ts";

async function connect() {
  const svc = new LumoService(openDatabase(":memory:"));
  const ana = svc.createUser({ username: "ana", displayName: "Ana Silva", email: "ana@example.com" });
  svc.createProject({ key: "WEB", name: "Website" });
  const token = svc.createApiToken(ana.id, "test");
  const http = createApp(svc);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const tracker = createClient({ backend: "lumo", url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, token });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(tracker);
  await server.connect(serverSide);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
  after(async () => {
    await mcp.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content[0]!.text;
    return { isError: res.isError ?? false, text, data: res.isError ? null : JSON.parse(text) };
  };
}

test("exposes the expected tools with read-only hints", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(createClient({ backend: "lumo", url: "http://127.0.0.1:1", token: "x" })).connect(serverSide);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["whoami", "list_projects", "search_issues", "get_issue", "create_issue", "update_issue", "list_transitions", "transition_issue", "add_comment"],
  );
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
  assert.deepEqual(readOnly, ["whoami", "list_projects", "search_issues", "get_issue", "list_transitions"]);
  assert.match(mcp.getInstructions() ?? "", /JQL/);
  await mcp.close();
});

test("an agent can run an issue through its lifecycle", async () => {
  const call = await connect();

  assert.equal((await call("whoami")).data.username, "ana");
  assert.deepEqual((await call("list_projects")).data, [{ key: "WEB", name: "Website" }]);

  const created = await call("create_issue", { project: "WEB", summary: "Fix login", type: "Bug", priority: "High", assignee: "ana" });
  assert.equal(created.data.key, "WEB-1");

  const found = await call("search_issues", { jql: "assignee = currentUser() AND statusCategory != Done" });
  assert.deepEqual(found.data.issues.map((i: { key: string }) => i.key), ["WEB-1"]);
  assert.equal(found.data.issues[0].status, "To Do");

  assert.equal((await call("update_issue", { key: "WEB-1", labels: ["auth"] })).data.labels[0], "auth");
  assert.deepEqual((await call("list_transitions", { key: "WEB-1" })).data.map((t: { to: string }) => t.to), ["In Progress", "Done"]);
  assert.equal((await call("transition_issue", { key: "WEB-1", transition: "In Progress" })).data.status, "In Progress");

  await call("add_comment", { key: "WEB-1", body: "Fixed in #42" });
  const full = await call("get_issue", { key: "WEB-1", includeComments: true });
  assert.equal(full.data.comments[0].body, "Fixed in #42");
});

test("errors come back as tool errors the model can read", async () => {
  const call = await connect();
  const bad = await call("search_issues", { jql: "project =" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Expected a value at end of query/);

  await call("create_issue", { project: "WEB", summary: "Task" });
  const wrong = await call("transition_issue", { key: "WEB-1", transition: "Reopen" });
  assert.equal(wrong.isError, true);
  assert.match(wrong.text, /Available: "Start", "Done"/);
});
