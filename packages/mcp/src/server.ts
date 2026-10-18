import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { IssueInput, IssueView, TrackerClient } from "@lumo/client";

const INSTRUCTIONS = `Tools for an issue tracker (Lumo, or Jira Cloud through the same interface).

Find issues with search_issues using JQL, e.g.:
  project = WEB AND statusCategory != Done ORDER BY priority DESC
  assignee = currentUser() AND updated >= -7d
  text ~ "login error" AND type = Bug
Fields: project, key, summary, description, text, type, status, statusCategory (To Do, In Progress, Done),
priority (Highest, High, Medium, Low, Lowest), assignee, reporter, labels, parent, created, updated, resolved, due.

To change an issue's status use transition_issue; it accepts a transition name or the target status name.
Call list_transitions first if unsure what is allowed. Issue keys look like WEB-12.`;

const fieldShape = {
  summary: z.string().max(255).optional().describe("One-line title"),
  description: z.string().optional().describe("Plain-text description"),
  type: z.string().optional().describe("Epic, Story, Task, Bug or Subtask"),
  priority: z.string().optional().describe("Highest, High, Medium, Low or Lowest"),
  assignee: z.string().nullable().optional().describe("Username, email or account id; null to unassign"),
  labels: z.array(z.string()).optional().describe("Replaces all labels"),
  dueDate: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear"),
  parent: z.string().nullable().optional().describe("Parent issue key, e.g. an epic"),
};

/** A compact issue for list results; get_issue returns the full record. */
function brief(i: IssueView) {
  return {
    key: i.key,
    summary: i.summary,
    type: i.type,
    status: i.status.name,
    priority: i.priority,
    assignee: i.assignee?.displayName ?? null,
    updated: i.updatedAt,
  };
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Tool errors are returned to the model, not thrown, so it can correct itself (e.g. fix JQL syntax). */
async function attempt(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await fn());
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
  }
}

function issueInput(args: z.infer<z.ZodObject<typeof fieldShape>>): IssueInput {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as IssueInput;
}

export function createMcpServer(client: TrackerClient): McpServer {
  const server = new McpServer({ name: "lumo", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

  server.registerTool(
    "whoami",
    { title: "Current user", description: "Returns the user the tracker is authenticated as.", annotations: readOnly },
    () => attempt(() => client.myself()),
  );

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "Lists projects with their keys.", annotations: readOnly },
    () => attempt(async () => (await client.listProjects()).map((p) => ({ key: p.key, name: p.name }))),
  );

  server.registerTool(
    "search_issues",
    {
      title: "Search issues",
      description: "Searches issues with JQL. Returns compact results; use get_issue for full details.",
      inputSchema: {
        jql: z.string().describe("JQL query; empty matches everything"),
        maxResults: z.number().int().min(1).max(100).optional().describe("Default 25"),
        page: z.string().optional().describe("nextPage value from a previous call"),
      },
      annotations: readOnly,
    },
    ({ jql, maxResults, page }) =>
      attempt(async () => {
        const res = await client.search(jql, { maxResults: maxResults ?? 25, ...(page ? { page } : {}) });
        return { issues: res.issues.map(brief), ...(res.nextPage ? { nextPage: res.nextPage } : {}) };
      }),
  );

  server.registerTool(
    "get_issue",
    {
      title: "Get issue",
      description: "Returns all fields of an issue, optionally with its comments.",
      inputSchema: { key: z.string().describe("Issue key, e.g. WEB-12"), includeComments: z.boolean().optional() },
      annotations: readOnly,
    },
    ({ key, includeComments }) =>
      attempt(async () => {
        const issue = await client.getIssue(key);
        if (!includeComments) return issue;
        const comments = await client.listComments(key);
        return { ...issue, comments: comments.map((c) => ({ author: c.author?.displayName ?? null, created: c.createdAt, body: c.body })) };
      }),
  );

  server.registerTool(
    "create_issue",
    {
      title: "Create issue",
      description: "Creates an issue and returns it.",
      inputSchema: { project: z.string().describe("Project key, e.g. WEB"), ...fieldShape, summary: z.string().min(1).max(255) },
      annotations: write,
    },
    ({ project, summary, ...rest }) => attempt(() => client.createIssue(project, { ...issueInput(rest), summary })),
  );

  server.registerTool(
    "update_issue",
    {
      title: "Update issue",
      description: "Changes the given fields of an issue; omitted fields are left as they are. Use transition_issue for status.",
      inputSchema: { key: z.string(), ...fieldShape },
      annotations: { ...write, idempotentHint: true },
    },
    ({ key, ...rest }) => attempt(() => client.updateIssue(key, issueInput(rest))),
  );

  server.registerTool(
    "list_transitions",
    {
      title: "List transitions",
      description: "Lists the workflow transitions available for an issue right now.",
      inputSchema: { key: z.string() },
      annotations: readOnly,
    },
    ({ key }) => attempt(() => client.listTransitions(key)),
  );

  server.registerTool(
    "transition_issue",
    {
      title: "Transition issue",
      description: 'Moves an issue through its workflow. Accepts a transition id, transition name or target status name (e.g. "Done").',
      inputSchema: { key: z.string(), transition: z.string() },
      annotations: write,
    },
    ({ key, transition }) => attempt(async () => brief(await client.transitionIssue(key, transition))),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description: "Adds a plain-text comment to an issue.",
      inputSchema: { key: z.string(), body: z.string().min(1) },
      annotations: write,
    },
    ({ key, body }) => attempt(() => client.addComment(key, body)),
  );

  return server;
}
