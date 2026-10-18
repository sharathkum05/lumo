import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { createClient } from "@lumo/client";
import { createApp, LumoService, openDatabase } from "@lumo/server";
import { parse, run } from "../src/cli.ts";

async function setup() {
  const svc = new LumoService(openDatabase(":memory:"));
  const ana = svc.createUser({ username: "ana", displayName: "Ana Silva", email: "ana@example.com" });
  svc.createProject({ key: "WEB", name: "Website" });
  const token = svc.createApiToken(ana.id, "test");
  const server = createApp(svc);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const client = createClient({ backend: "lumo", url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token });

  return async (...argv: string[]) => {
    const out: string[] = [];
    await run(parse(argv), () => client, { out: (s) => out.push(s), err: (s) => out.push(s) });
    return out.join("\n");
  };
}

test("help needs no configuration", async () => {
  const out: string[] = [];
  await run(parse(["--help"]), () => assert.fail("client should not be created"), { out: (s) => out.push(s), err: () => {} });
  assert.match(out[0]!, /^lumo — the open-source Jira alternative/);
});

test("end-to-end workflow", async () => {
  const lumo = await setup();

  assert.equal(await lumo("whoami"), "Ana Silva <ana@example.com>");
  assert.equal(await lumo("projects"), "KEY  NAME\nWEB  Website");

  assert.equal(await lumo("create", "-p", "WEB", "-s", "Fix login", "-t", "Bug", "-P", "High", "-a", "ana", "-l", "auth", "-l", "web"), "Created WEB-1: Fix login");
  const view = await lumo("view", "WEB-1");
  assert.match(view, /^WEB-1  Fix login/);
  assert.match(view, /Priority:  High/);
  assert.match(view, /Labels:    auth, web/);

  assert.equal(await lumo("edit", "WEB-1", "--unassign"), "Updated WEB-1");
  assert.match(await lumo("view", "WEB-1"), /Assignee:  Unassigned/);

  assert.match(await lumo("move", "WEB-1"), /11  Start\s+In Progress/);
  assert.equal(await lumo("move", "WEB-1", "In", "Progress"), "WEB-1 is now In Progress");

  assert.equal(await lumo("comment", "WEB-1", "Working", "on", "it"), "Commented on WEB-1");
  assert.match(await lumo("comments", "WEB-1"), /Ana Silva · .*\n  Working on it/);

  const search = await lumo("search", "status", "=", '"In Progress"');
  assert.match(search, /^KEY\s+TYPE\s+STATUS/);
  assert.match(search, /WEB-1\s+Bug\s+In Progress\s+High\s+-\s+Fix login/);

  const json = JSON.parse(await lumo("search", "project = WEB", "--json"));
  assert.equal(json.issues[0].key, "WEB-1");
});

test("usage errors", async () => {
  const lumo = await setup();
  await assert.rejects(lumo("create", "-p", "WEB"), /--summary is required/);
  await assert.rejects(lumo("edit", "WEB-1"), /Nothing to change/);
  await assert.rejects(lumo("frobnicate"), /Unknown command "frobnicate"/);
  await assert.rejects(lumo("view"), /Missing <KEY>/);
});
