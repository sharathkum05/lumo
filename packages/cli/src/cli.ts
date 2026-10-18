import { parseArgs, type ParseArgsConfig } from "node:util";
import type { IssueInput, IssueView, TrackerClient } from "@lumo/client";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const HELP = `lumo — the open-source Jira alternative

Usage: lumo <command> [options]

Commands:
  whoami                         Show the authenticated user
  projects                       List projects
  search <jql>                   Search issues with JQL
  view <KEY>                     Show an issue
  create                         Create an issue (--project, --summary required)
  edit <KEY>                     Change issue fields
  move <KEY> [transition]        Transition an issue; lists transitions if none given
  comment <KEY> <text>           Add a comment
  comments <KEY>                 List comments

Issue fields (create, edit):
  -p, --project <KEY>     -s, --summary <text>     -d, --description <text>
  -t, --type <type>       -P, --priority <name>    -a, --assignee <user>
  -l, --label <name>      --due <YYYY-MM-DD>       --parent <KEY>
  --unassign              --no-labels

Global options:
  --profile <name>   Use a profile from the config file
  --json             Print JSON instead of text
  -n, --limit <n>    Maximum results for search (default 20)
  -h, --help         Show this help

Configure with LUMO_URL and LUMO_TOKEN (plus LUMO_BACKEND=jira and LUMO_EMAIL for Jira Cloud),
or profiles in ~/.config/lumo/config.json.`;

const OPTIONS = {
  project: { type: "string", short: "p" },
  summary: { type: "string", short: "s" },
  description: { type: "string", short: "d" },
  type: { type: "string", short: "t" },
  priority: { type: "string", short: "P" },
  assignee: { type: "string", short: "a" },
  label: { type: "string", short: "l", multiple: true },
  due: { type: "string" },
  parent: { type: "string" },
  unassign: { type: "boolean" },
  "no-labels": { type: "boolean" },
  profile: { type: "string" },
  json: { type: "boolean" },
  limit: { type: "string", short: "n" },
  help: { type: "boolean", short: "h" },
} satisfies ParseArgsConfig["options"];

export function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

export type Parsed = ReturnType<typeof parse>;

export class UsageError extends Error {}

/** Runs one command. `getClient` is lazy so `--help` works without configuration. */
export async function run(parsed: Parsed, getClient: () => TrackerClient, io: Io): Promise<void> {
  const { values: opts, positionals } = parsed;
  const [command, ...args] = positionals;
  if (opts.help || !command || command === "help") {
    io.out(HELP);
    return;
  }
  const print = (value: unknown, text: () => string) => io.out(opts.json ? JSON.stringify(value, null, 2) : text());
  const arg = (i: number, name: string) => {
    const v = args[i];
    if (!v) throw new UsageError(`Missing <${name}>. Run "lumo --help".`);
    return v;
  };

  switch (command) {
    case "whoami": {
      const me = await getClient().myself();
      return print(me, () => `${me.displayName} <${me.email}>`);
    }
    case "projects": {
      const projects = await getClient().listProjects();
      return print(projects, () => table(["KEY", "NAME"], projects.map((p) => [p.key, p.name])) || "No projects.");
    }
    case "search": {
      const jql = args.join(" ");
      const limit = opts.limit ? Number(opts.limit) : 20;
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a positive integer");
      const { issues, nextPage } = await getClient().search(jql, { maxResults: limit });
      return print({ issues, nextPage }, () => {
        if (issues.length === 0) return "No issues found.";
        const rows = issues.map((i) => [i.key, i.type, i.status.name, i.priority, i.assignee?.displayName ?? "-", truncate(i.summary, 60)]);
        const more = nextPage ? `\n(more results; raise --limit to see them)` : "";
        return table(["KEY", "TYPE", "STATUS", "PRIORITY", "ASSIGNEE", "SUMMARY"], rows) + more;
      });
    }
    case "view": {
      const issue = await getClient().getIssue(arg(0, "KEY"));
      return print(issue, () => formatIssue(issue));
    }
    case "create": {
      if (!opts.project) throw new UsageError("--project is required");
      if (!opts.summary) throw new UsageError("--summary is required");
      const issue = await getClient().createIssue(opts.project, { ...fieldInput(opts), summary: opts.summary });
      return print(issue, () => `Created ${issue.key}: ${issue.summary}`);
    }
    case "edit": {
      const input = fieldInput(opts);
      if (Object.keys(input).length === 0) throw new UsageError("Nothing to change. Pass fields such as --summary or --assignee.");
      const issue = await getClient().updateIssue(arg(0, "KEY"), input);
      return print(issue, () => `Updated ${issue.key}`);
    }
    case "move": {
      const key = arg(0, "KEY");
      const client = getClient();
      const transition = args.slice(1).join(" ");
      if (!transition) {
        const transitions = await client.listTransitions(key);
        return print(transitions, () => table(["ID", "TRANSITION", "TO"], transitions.map((t) => [t.id, t.name, t.to])) || "No transitions available.");
      }
      const issue = await client.transitionIssue(key, transition);
      return print(issue, () => `${issue.key} is now ${issue.status.name}`);
    }
    case "comment": {
      const key = arg(0, "KEY");
      const body = args.slice(1).join(" ");
      if (!body) throw new UsageError("Missing <text>.");
      const comment = await getClient().addComment(key, body);
      return print(comment, () => `Commented on ${key}`);
    }
    case "comments": {
      const comments = await getClient().listComments(arg(0, "KEY"));
      return print(comments, () =>
        comments.length === 0
          ? "No comments."
          : comments.map((c) => `${c.author?.displayName ?? "Unknown"} · ${c.createdAt.slice(0, 16).replace("T", " ")}\n${indent(c.body)}`).join("\n\n"),
      );
    }
    default:
      throw new UsageError(`Unknown command "${command}". Run "lumo --help".`);
  }
}

function fieldInput(opts: Parsed["values"]): IssueInput {
  const input: IssueInput = {};
  if (opts.summary !== undefined) input.summary = opts.summary;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.type !== undefined) input.type = opts.type;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.assignee !== undefined) input.assignee = opts.assignee;
  if (opts.unassign) input.assignee = null;
  if (opts.label !== undefined) input.labels = opts.label;
  if (opts["no-labels"]) input.labels = [];
  if (opts.due !== undefined) input.dueDate = opts.due || null;
  if (opts.parent !== undefined) input.parent = opts.parent || null;
  return input;
}

export function formatIssue(i: IssueView): string {
  const lines = [
    `${i.key}  ${i.summary}`,
    "",
    `Type:      ${i.type}`,
    `Status:    ${i.status.name}`,
    `Priority:  ${i.priority}`,
    `Assignee:  ${i.assignee?.displayName ?? "Unassigned"}`,
    `Reporter:  ${i.reporter?.displayName ?? "-"}`,
  ];
  if (i.labels.length) lines.push(`Labels:    ${i.labels.join(", ")}`);
  if (i.parent) lines.push(`Parent:    ${i.parent}`);
  if (i.dueDate) lines.push(`Due:       ${i.dueDate}`);
  lines.push(`Created:   ${i.createdAt.slice(0, 16).replace("T", " ")}`, `Updated:   ${i.updatedAt.slice(0, 16).replace("T", " ")}`);
  if (i.description) lines.push("", indent(i.description));
  return lines.join("\n");
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => (r[c] ?? "").length)));
  const line = (cells: string[]) => cells.map((cell, c) => (c === cells.length - 1 ? cell : cell.padEnd(widths[c]!))).join("  ");
  return [line(headers), ...rows.map(line)].join("\n");
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const indent = (s: string) => s.split("\n").map((l) => `  ${l}`).join("\n");
