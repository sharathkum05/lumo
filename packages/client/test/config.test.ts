import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/index.ts";

function withConfig(contents: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "lumo-config-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

test("environment variables alone are enough", () => {
  const env = { LUMO_CONFIG: "/nonexistent/config.json", LUMO_URL: "http://localhost:8080", LUMO_TOKEN: "t" };
  assert.deepEqual(loadConfig({ env }), { backend: "lumo", url: "http://localhost:8080", token: "t", email: undefined });
});

test("profiles, with env overriding", () => {
  const LUMO_CONFIG = withConfig({
    default: "work",
    profiles: {
      work: { backend: "jira", url: "https://acme.atlassian.net", token: "jt", email: "me@acme.com" },
      home: { url: "http://localhost:8080", token: "lt" },
    },
  });
  assert.equal(loadConfig({ env: { LUMO_CONFIG } }).backend, "jira");
  assert.equal(loadConfig({ env: { LUMO_CONFIG }, profile: "home" }).token, "lt");
  assert.equal(loadConfig({ env: { LUMO_CONFIG, LUMO_TOKEN: "override" } }).token, "override");
  assert.throws(() => loadConfig({ env: { LUMO_CONFIG }, profile: "nope" }), /Profile "nope"/);
});

test("reports what is missing", () => {
  const env = { LUMO_CONFIG: "/nonexistent/config.json", LUMO_BACKEND: "jira", LUMO_URL: "https://x" };
  assert.throws(() => loadConfig({ env }), /Missing token \(LUMO_TOKEN\), email \(LUMO_EMAIL\)/);
});
