// Backend-neutral shapes. They mirror Lumo's /api/v1 views, and the Jira backend maps into them.

export type StatusCategory = "todo" | "in_progress" | "done";

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  email: string;
}

export interface ProjectRef {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface IssueView {
  id: string;
  key: string;
  project: { key: string; name: string };
  type: string;
  summary: string;
  description: string;
  status: { id: string; name: string; category: StatusCategory };
  priority: string;
  assignee: UserRef | null;
  reporter: UserRef | null;
  parent: string | null;
  labels: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface TransitionView {
  id: string;
  name: string;
  /** Target status name. */
  to: string;
}

export interface CommentView {
  id: string;
  body: string;
  author: UserRef | null;
  createdAt: string;
}

export interface IssueInput {
  summary?: string;
  description?: string;
  type?: string;
  priority?: string;
  /** Username, email or account id. null unassigns. */
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
  parent?: string | null;
}

export interface SearchPage {
  issues: IssueView[];
  /** Pass back as `page` to fetch the next page. Absent on the last page. */
  nextPage?: string;
}

/** What the CLI and MCP server need from an issue tracker. */
export interface TrackerClient {
  readonly backend: "lumo" | "jira";
  myself(): Promise<UserRef>;
  listProjects(): Promise<ProjectRef[]>;
  search(jql: string, opts?: { maxResults?: number; page?: string }): Promise<SearchPage>;
  getIssue(key: string): Promise<IssueView>;
  createIssue(project: string, input: IssueInput & { summary: string }): Promise<IssueView>;
  updateIssue(key: string, input: IssueInput): Promise<IssueView>;
  listTransitions(key: string): Promise<TransitionView[]>;
  /** Accepts a transition id, a transition name or the target status name. */
  transitionIssue(key: string, transition: string): Promise<IssueView>;
  listComments(key: string): Promise<CommentView[]>;
  addComment(key: string, body: string): Promise<CommentView>;
}

export class TrackerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TrackerError";
    this.status = status;
  }
}
