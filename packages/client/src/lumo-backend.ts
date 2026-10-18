import { httpClient, type Request } from "./http.ts";
import type { CommentView, IssueInput, IssueView, ProjectRef, SearchPage, TrackerClient, TransitionView, UserRef } from "./types.ts";

/** Talks to a Lumo server's native /api/v1. */
export class LumoBackend implements TrackerClient {
  readonly backend = "lumo";
  private readonly request: Request;

  constructor(opts: { baseUrl: string; token: string; fetch?: typeof fetch }) {
    this.request = httpClient({
      baseUrl: `${opts.baseUrl.replace(/\/+$/, "")}/api/v1`,
      authorization: `Bearer ${opts.token}`,
      errorMessage: (body) => (body as { error?: string } | undefined)?.error,
      fetch: opts.fetch,
    });
  }

  myself() {
    return this.request<UserRef>("GET", "/myself");
  }

  listProjects() {
    return this.request<ProjectRef[]>("GET", "/projects");
  }

  async search(jql: string, opts: { maxResults?: number; page?: string } = {}): Promise<SearchPage> {
    const startAt = Number(opts.page ?? 0);
    const maxResults = opts.maxResults ?? 50;
    const params = new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(maxResults) });
    const res = await this.request<{ total: number; issues: IssueView[] }>("GET", `/search?${params}`);
    const next = startAt + res.issues.length;
    return next < res.total ? { issues: res.issues, nextPage: String(next) } : { issues: res.issues };
  }

  getIssue(key: string) {
    return this.request<IssueView>("GET", `/issues/${encodeURIComponent(key)}`);
  }

  createIssue(project: string, input: IssueInput & { summary: string }) {
    return this.request<IssueView>("POST", "/issues", { ...input, project });
  }

  updateIssue(key: string, input: IssueInput) {
    return this.request<IssueView>("PATCH", `/issues/${encodeURIComponent(key)}`, input);
  }

  async listTransitions(key: string): Promise<TransitionView[]> {
    const transitions = await this.request<Array<{ id: string; name: string; to: { name: string } }>>(
      "GET",
      `/issues/${encodeURIComponent(key)}/transitions`,
    );
    return transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name }));
  }

  transitionIssue(key: string, transition: string) {
    return this.request<IssueView>("POST", `/issues/${encodeURIComponent(key)}/transitions`, { transition });
  }

  listComments(key: string) {
    return this.request<CommentView[]>("GET", `/issues/${encodeURIComponent(key)}/comments`);
  }

  addComment(key: string, body: string) {
    return this.request<CommentView>("POST", `/issues/${encodeURIComponent(key)}/comments`, { body });
  }
}
