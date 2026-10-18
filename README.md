# Lumo

**The open-source Jira alternative.** Self-hosted. Jira-API compatible. Built for AI agents.

Lumo is an issue tracker you run yourself. It speaks a subset of Jira's REST API, so existing
Jira scripts and tools keep working, and it ships with a CLI and an MCP server so Claude (or any
MCP-capable agent) can search, create, transition and comment on issues.

> Lumo is an independent project and is not affiliated with or endorsed by Atlassian.
> "Jira" is a trademark of Atlassian; it is used here only to describe compatibility.

## Why

- **Atlassian Data Center is winding down.** Self-hosted teams need somewhere to go.
- **Agents are first-class.** The CLI and MCP server are core, not plugins.
- **One client, two backends.** The Lumo CLI and MCP server can point at a Lumo server *or* at
  Jira Cloud, so teams can adopt the tooling today and migrate later.
- **No SSO tax.** Enterprise basics stay free.

## Quick start

Requires Node.js 22.18+ and pnpm. TypeScript runs directly through Node's type stripping, so there is no build step.

```sh
pnpm install
pnpm server
# Created user "admin" (admin@localhost.local).
# API token (shown once, save it now): lumo_...
# Lumo listening on http://127.0.0.1:8080
```

Server settings: `LUMO_DB` (SQLite file, default `lumo.db`), `PORT` (8080), `HOST` (127.0.0.1),
`LUMO_ADMIN_USERNAME` and `LUMO_ADMIN_EMAIL` for the first user.

Create a project, then use the CLI:

```sh
export LUMO_URL=http://127.0.0.1:8080 LUMO_TOKEN=lumo_...
curl -X POST $LUMO_URL/api/v1/projects -H "authorization: Bearer $LUMO_TOKEN" -d '{"key":"WEB","name":"Website"}'

pnpm lumo create -p WEB -s "Login page crashes on Safari" -t Bug -P Highest -a admin
pnpm lumo move WEB-1 "In Progress"
pnpm lumo search 'project = WEB AND statusCategory != Done ORDER BY priority DESC'
```

```
KEY    TYPE   STATUS       PRIORITY  ASSIGNEE       SUMMARY
WEB-1  Bug    In Progress  Highest   Administrator  Login page crashes on Safari
```

## Deploy

- **Docker:** `docker build -t lumo . && docker run -p 8080:8080 -v lumo-data:/data lumo`
- **Fly.io:** `fly deploy` with a volume for SQLite; quickest way to a demo. See [docs/deploy-fly.md](docs/deploy-fly.md).
- **AWS:** one EC2 instance with Docker Compose and automatic HTTPS. See [docs/deploy-aws.md](docs/deploy-aws.md).

## Connect Claude (MCP)

```sh
claude mcp add lumo \
  -e LUMO_URL=http://127.0.0.1:8080 -e LUMO_TOKEN=lumo_... \
  -- node --disable-warning=ExperimentalWarning /path/to/lumo/packages/mcp/src/main.ts
```

Then ask Claude things like *"what's assigned to me that isn't done?"* or *"file a bug for the
Safari login crash and start working on it"*.

Tools: `whoami`, `list_projects`, `search_issues`, `get_issue`, `create_issue`, `update_issue`,
`list_transitions`, `transition_issue`, `add_comment`.

### Using it with Jira Cloud

The same CLI and MCP server work against Jira Cloud:

```sh
export LUMO_BACKEND=jira LUMO_URL=https://your-site.atlassian.net LUMO_EMAIL=you@company.com LUMO_TOKEN=<atlassian api token>
```

Or keep several in `~/.config/lumo/config.json` and pick one with `--profile` (CLI) or
`--profile=<name>` (MCP):

```json
{
  "default": "lumo",
  "profiles": {
    "lumo": { "url": "http://127.0.0.1:8080", "token": "lumo_..." },
    "jira": { "backend": "jira", "url": "https://acme.atlassian.net", "email": "me@acme.com", "token": "..." }
  }
}
```

## JQL

Lumo implements a JQL subset: `AND`, `OR`, `NOT`, parentheses, `=`, `!=`, `~`, `!~`, `>`, `>=`, `<`, `<=`,
`IN`, `NOT IN`, `IS [NOT] EMPTY`, `ORDER BY`, and the functions `currentUser()`, `now()`, `startOfDay()`
and `endOfDay()` (with offsets like `startOfDay(-7d)`). Relative dates such as `created >= -2w` work too.

Fields: `project`, `key`, `summary`, `description`, `text`, `type`, `status`, `statusCategory`,
`priority`, `assignee`, `reporter`, `labels`, `parent`, `created`, `updated`, `resolved`, `due`.

## Jira API compatibility

Lumo serves `/rest/api/3` with Jira's JSON shapes and auth (`Basic email:token`). See
[docs/jira-compat.md](docs/jira-compat.md) for covered endpoints and known gaps. The client
contract tests run the Jira backend against Lumo, so compatibility is tested on every change.

## Packages

| Package | What it does |
|---|---|
| `packages/core` | Data model, workflow engine, JQL parser and evaluator, ADF conversion |
| `packages/server` | SQLite storage, native `/api/v1`, Jira-compatible `/rest/api/3` |
| `packages/client` | `TrackerClient` with Lumo and Jira Cloud backends, config loading |
| `packages/cli` | `lumo` command-line tool |
| `packages/mcp` | MCP server for AI agents |

## Development

```sh
pnpm test        # node:test across all packages
pnpm typecheck   # tsc -b
```

See [ROADMAP.md](ROADMAP.md) for what's next.

## License

[AGPL-3.0](LICENSE)
