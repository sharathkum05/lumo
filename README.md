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

## Status

Early development. See [ROADMAP.md](ROADMAP.md).

## Packages

| Package | What it does |
|---|---|
| `packages/core` | Data model, workflow engine, JQL parser |
| `packages/server` | HTTP server: native API + Jira-compatible `/rest/api/3` subset |
| `packages/client` | API client with Lumo and Jira Cloud backends |
| `packages/cli` | `lumo` command-line tool |
| `packages/mcp` | MCP server for AI agents |

## Development

Requires Node.js 22.18+ (TypeScript runs directly via Node's type stripping) and pnpm.

```sh
pnpm install
pnpm test
pnpm typecheck
```

## License

[AGPL-3.0](LICENSE)
