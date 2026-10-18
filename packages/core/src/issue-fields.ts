import type { Issue, Project, Status, User } from "./model.ts";
import { PRIORITIES } from "./model.ts";
import type { FieldDef, JqlContext, Scalar } from "./jql/evaluate.ts";
import { compileJql } from "./jql/evaluate.ts";
import { parseJql } from "./jql/parser.ts";

/** An issue joined with the records JQL needs to match on names rather than ids. */
export interface IssueRecord {
  issue: Issue;
  project: Project;
  status: Status;
  assignee: User | null;
  reporter: User | null;
  parentKey: string | null;
}

const CATEGORY_NAMES = { todo: "To Do", in_progress: "In Progress", done: "Done" } as const;

/** Values that identify a user in JQL: `assignee = sharath`, `= "Sharath Kumar"` or `= sharath@example.com`. */
export function userIdentities(user: User): string[] {
  return [user.id, user.username, user.displayName, user.email];
}

const user = (u: User | null): Scalar[] => (u ? userIdentities(u) : []);

export const ISSUE_FIELDS: FieldDef<IssueRecord>[] = [
  {
    names: ["project"],
    type: "string",
    get: (r) => [r.project.key, r.project.name, r.project.id],
    sortValue: (r) => r.project.key,
  },
  {
    names: ["key", "issuekey", "id"],
    type: "string",
    get: (r) => [r.issue.key, r.issue.id],
    // WEB-9 sorts before WEB-10.
    sortValue: (r) => `${r.project.key}-${String(r.issue.number).padStart(10, "0")}`,
  },
  { names: ["summary"], type: "text", get: (r) => r.issue.summary },
  { names: ["description"], type: "text", get: (r) => r.issue.description },
  { names: ["text"], type: "text", get: (r) => `${r.issue.summary}\n${r.issue.description}` },
  { names: ["type", "issuetype"], type: "string", get: (r) => r.issue.type },
  { names: ["status"], type: "string", get: (r) => [r.status.name, r.status.id] },
  {
    names: ["statusCategory"],
    type: "string",
    get: (r) => [CATEGORY_NAMES[r.status.category], r.status.category],
  },
  // PRIORITIES is listed highest first; ordinal order is lowest first.
  { names: ["priority"], type: "ordinal", order: [...PRIORITIES].reverse(), get: (r) => r.issue.priority },
  { names: ["assignee"], type: "string", get: (r) => user(r.assignee), sortValue: (r) => r.assignee?.displayName ?? null },
  { names: ["reporter"], type: "string", get: (r) => user(r.reporter), sortValue: (r) => r.reporter?.displayName ?? null },
  { names: ["labels", "label"], type: "string", get: (r) => r.issue.labels },
  { names: ["parent"], type: "string", get: (r) => r.parentKey },
  { names: ["created", "createdDate"], type: "date", get: (r) => r.issue.createdAt },
  { names: ["updated", "updatedDate"], type: "date", get: (r) => r.issue.updatedAt },
  { names: ["resolved", "resolutionDate"], type: "date", get: (r) => r.issue.resolvedAt },
  { names: ["due", "duedate"], type: "date", get: (r) => r.issue.dueDate },
];

/** Filters and sorts issues with a JQL query. Defaults to newest first, like Jira. */
export function searchIssues(records: IssueRecord[], jql: string, ctx: JqlContext): IssueRecord[] {
  const query = parseJql(jql);
  if (query.orderBy.length === 0) query.orderBy.push({ field: "created", direction: "desc" });
  const compiled = compileJql(query, ISSUE_FIELDS, ctx);
  return records.filter(compiled.matches).sort(compiled.compare);
}
