import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultWorkflow,
  searchIssues,
  userIdentities,
  type Issue,
  type IssueRecord,
  type JqlContext,
  type Project,
  type User,
} from "../src/index.ts";

const wf = defaultWorkflow();
const status = (id: string) => wf.statuses.find((s) => s.id === id)!;

const ana: User = { id: "u1", username: "ana", displayName: "Ana Silva", email: "ana@example.com" };
const raj: User = { id: "u2", username: "raj", displayName: "Raj Patel", email: "raj@example.com" };

const web: Project = {
  id: "p1",
  key: "WEB",
  name: "Website",
  description: "",
  leadId: null,
  workflowId: wf.id,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const api: Project = { ...web, id: "p2", key: "API", name: "Backend API" };

function record(project: Project, n: number, over: Partial<Issue> & { statusId?: string } = {}, assignee: User | null = null): IssueRecord {
  const issue: Issue = {
    id: `${project.key}-${n}`,
    key: `${project.key}-${n}`,
    projectId: project.id,
    number: n,
    type: "Task",
    summary: `Issue ${n}`,
    description: "",
    statusId: "todo",
    priority: "Medium",
    assigneeId: assignee?.id ?? null,
    reporterId: null,
    parentId: null,
    labels: [],
    dueDate: null,
    createdAt: `2026-10-${String(n).padStart(2, "0")}T12:00:00.000Z`,
    updatedAt: `2026-10-${String(n).padStart(2, "0")}T12:00:00.000Z`,
    resolvedAt: null,
    ...over,
  };
  return { issue, project, status: status(issue.statusId), assignee, reporter: null, parentKey: null };
}

const records: IssueRecord[] = [
  record(web, 1, { summary: "Login page crashes on Safari", type: "Bug", priority: "Highest", labels: ["frontend", "safari"] }, ana),
  record(web, 2, { summary: "Add dark mode", statusId: "in_progress", labels: ["frontend"] }, raj),
  record(web, 10, { summary: "Update footer links", statusId: "done", priority: "Low" }),
  record(api, 3, { summary: "Rate limit login endpoint", priority: "High", dueDate: "2026-10-20" }, ana),
];

const ctx: JqlContext = { currentUser: userIdentities(ana), now: new Date("2026-10-15T00:00:00.000Z") };
const keys = (jql: string) => searchIssues(records, jql, ctx).map((r) => r.issue.key);

test("project filter, default newest-first order", () => {
  assert.deepEqual(keys("project = WEB"), ["WEB-10", "WEB-2", "WEB-1"]);
});

test("project matches by name too, case-insensitively", () => {
  assert.deepEqual(keys('project = "backend api"'), ["API-3"]);
});

test("currentUser() and user identities", () => {
  assert.deepEqual(keys("assignee = currentUser() ORDER BY key"), ["API-3", "WEB-1"]);
  assert.deepEqual(keys('assignee = "Raj Patel"'), ["WEB-2"]);
  assert.deepEqual(keys("assignee = raj@example.com"), ["WEB-2"]);
});

test("!= skips empty values, like Jira", () => {
  assert.deepEqual(keys("assignee != ana"), ["WEB-2"]);
});

test("IS EMPTY / IS NOT EMPTY", () => {
  assert.deepEqual(keys("assignee is empty"), ["WEB-10"]);
  assert.deepEqual(keys("due is not empty"), ["API-3"]);
});

test("status, statusCategory and IN lists", () => {
  assert.deepEqual(keys('status = "In Progress"'), ["WEB-2"]);
  assert.deepEqual(keys("statusCategory != Done ORDER BY key"), ["API-3", "WEB-1", "WEB-2"]);
  assert.deepEqual(keys('status in ("To Do", Done) ORDER BY key'), ["API-3", "WEB-1", "WEB-10"]);
  assert.deepEqual(keys("status not in (Done)"), ["API-3", "WEB-2", "WEB-1"]);
});

test("text search with ~ matches all words", () => {
  assert.deepEqual(keys('summary ~ "login" ORDER BY key'), ["API-3", "WEB-1"]);
  assert.deepEqual(keys('text ~ "login safari"'), ["WEB-1"]);
  assert.deepEqual(keys("summary !~ login ORDER BY key"), ["WEB-2", "WEB-10"]);
});

test("labels are multi-valued", () => {
  assert.deepEqual(keys("labels = frontend ORDER BY key"), ["WEB-1", "WEB-2"]);
  assert.deepEqual(keys("labels in (safari)"), ["WEB-1"]);
});

test("priority compares by rank", () => {
  assert.deepEqual(keys("priority > Medium ORDER BY priority DESC"), ["WEB-1", "API-3"]);
  assert.deepEqual(keys("priority <= Low"), ["WEB-10"]);
  assert.throws(() => keys("priority = Urgent"), /The value "Urgent" does not exist for field "priority"/);
});

test("dates: bare dates cover the whole day, relative offsets use now", () => {
  assert.deepEqual(keys("created = 2026-10-02"), ["WEB-2"]);
  assert.deepEqual(keys("created >= 2026-10-03 ORDER BY key"), ["API-3", "WEB-10"]);
  assert.deepEqual(keys("created > 2026-10-02 ORDER BY key"), ["API-3", "WEB-10"]);
  assert.deepEqual(keys("created < 2026-10-02"), ["WEB-1"]);
  assert.deepEqual(keys("created >= -7d"), ["WEB-10"]);
  assert.deepEqual(keys("due <= endOfDay(4d)"), []);
  assert.deepEqual(keys("due <= endOfDay(5d)"), ["API-3"]);
});

test("key ordering is numeric within a project", () => {
  assert.deepEqual(keys("project = WEB ORDER BY key ASC"), ["WEB-1", "WEB-2", "WEB-10"]);
});

test("boolean logic", () => {
  assert.deepEqual(keys("(project = API OR type = Bug) AND NOT assignee = raj ORDER BY key"), ["API-3", "WEB-1"]);
});

test("unknown fields and functions are reported", () => {
  assert.throws(() => keys("sprint = 5"), /Field "sprint" does not exist/);
  assert.throws(() => keys("assignee = membersOf(devs)"), /Unknown function "membersOf\(\)"/);
});
