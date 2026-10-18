// Domain types shared by every Lumo package.

/** Jira groups statuses into three categories; boards and JQL `statusCategory` rely on them. */
export type StatusCategory = "todo" | "in_progress" | "done";

export const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ISSUE_TYPES = ["Epic", "Story", "Task", "Bug", "Subtask"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export interface User {
  id: string;
  /** Login handle, e.g. "sharath". Unique. */
  username: string;
  displayName: string;
  email: string;
}

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface Transition {
  id: string;
  name: string;
  /** Status ids this transition can start from. An empty list means "from any status". */
  from: string[];
  to: string;
}

export interface Workflow {
  id: string;
  name: string;
  statuses: Status[];
  transitions: Transition[];
  /** Status a newly created issue starts in. */
  initialStatusId: string;
}

export interface Project {
  id: string;
  /** Uppercase key used in issue keys, e.g. "WEB" in "WEB-12". */
  key: string;
  name: string;
  description: string;
  leadId: string | null;
  workflowId: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  /** Human key, e.g. "WEB-12". */
  key: string;
  projectId: string;
  number: number;
  type: IssueType;
  summary: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string | null;
  parentId: string | null;
  labels: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface Comment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY.test(key);
}

export function formatIssueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

export function parseIssueKey(key: string): { projectKey: string; number: number } | null {
  const match = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(key.toUpperCase());
  if (!match) return null;
  return { projectKey: match[1]!, number: Number(match[2]) };
}
