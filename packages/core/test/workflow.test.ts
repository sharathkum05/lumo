import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableTransitions,
  defaultWorkflow,
  LumoError,
  parseIssueKey,
  resolveTransition,
  validateWorkflow,
} from "../src/index.ts";

test("default workflow is valid", () => {
  validateWorkflow(defaultWorkflow());
});

test("validateWorkflow rejects transitions to unknown statuses", () => {
  const wf = defaultWorkflow();
  wf.transitions.push({ id: "99", name: "Broken", from: ["todo"], to: "nowhere" });
  assert.throws(() => validateWorkflow(wf), LumoError);
});

test("available transitions from To Do", () => {
  const names = availableTransitions(defaultWorkflow(), "todo").map((t) => t.name);
  assert.deepEqual(names, ["Start", "Done"]);
});

test("global transition is not offered when already in its target status", () => {
  const names = availableTransitions(defaultWorkflow(), "done").map((t) => t.name);
  assert.deepEqual(names, ["Reopen"]);
});

test("resolveTransition accepts id, transition name or target status name", () => {
  const wf = defaultWorkflow();
  assert.equal(resolveTransition(wf, "todo", "11").to, "in_progress");
  assert.equal(resolveTransition(wf, "todo", "start").to, "in_progress");
  assert.equal(resolveTransition(wf, "in_progress", "In Review").to, "in_review");
});

test("resolveTransition explains what is available", () => {
  assert.throws(
    () => resolveTransition(defaultWorkflow(), "todo", "Reopen"),
    /Cannot apply "Reopen" from "To Do". Available: "Start", "Done"/,
  );
});

test("parseIssueKey", () => {
  assert.deepEqual(parseIssueKey("web-12"), { projectKey: "WEB", number: 12 });
  assert.equal(parseIssueKey("12"), null);
});
