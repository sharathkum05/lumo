# Roadmap

## Phase 0 — Study Jira
- [ ] Document Jira's data model from the public REST v3 docs and HAR captures (no code copied)
- [ ] Record the request/response shapes Lumo must match in `docs/jira-compat.md`

## Phase 1 — Core and server
- [ ] Data model: projects, issues, issue types, statuses, workflows, comments, users
- [ ] Workflow engine with validated transitions
- [ ] JQL subset: `=`, `!=`, `IN`, `NOT IN`, `~`, `IS EMPTY`, `AND`/`OR`/`NOT`, `ORDER BY`, `currentUser()`
- [ ] SQLite storage (Postgres later)
- [ ] API tokens

## Phase 2 — CLI and MCP
- [ ] `lumo` CLI
- [ ] MCP server: `search_issues`, `get_issue`, `create_issue`, `update_issue`, `transition_issue`, `add_comment`, `list_projects`
- [ ] Jira Cloud backend for the client, so the same CLI/MCP works against real Jira

## Phase 3 — Jira compatibility
- [ ] `/rest/api/3` subset: issue, search, transitions, comment, project, myself
- [ ] `compat-tests/` run against both Jira Cloud and Lumo

## Phase 4 — Import and UI
- [ ] Jira Cloud importer with a fidelity report
- [ ] Minimal web UI: board, list, issue view

## Later
- Free OIDC/SAML SSO, SCIM, audit log
- Postgres
- Docs (Confluence-style)
