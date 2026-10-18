# Roadmap

## Phase 0 — Study Jira
- [ ] Document Jira's data model from the public REST v3 docs and HAR captures (no code copied)
- [ ] Record the request/response shapes Lumo must match in `docs/jira-compat.md`

## Phase 1 — Core and server
- [x] Data model: projects, issues, issue types, statuses, workflows, comments, users
- [x] Workflow engine with validated transitions
- [x] JQL subset: `=`, `!=`, `IN`, `NOT IN`, `~`, `IS EMPTY`, `AND`/`OR`/`NOT`, `ORDER BY`, `currentUser()`
- [x] SQLite storage (Postgres later)
- [x] API tokens

## Phase 2 — CLI and MCP
- [x] `lumo` CLI
- [x] MCP server: `search_issues`, `get_issue`, `create_issue`, `update_issue`, `transition_issue`, `add_comment`, `list_projects`
- [x] Jira Cloud backend for the client, so the same CLI/MCP works against real Jira

## Phase 3 — Jira compatibility
- [x] `/rest/api/3` subset: issue, search, transitions, comment, project, myself
- [x] Client contract tests run the Jira backend against Lumo
- [ ] Run the same contract tests against a real Jira Cloud site
- [ ] Verify an existing open-source Jira CLI works unchanged against Lumo

## Next up
- [ ] Users, roles and project permissions (currently any authenticated user can do anything)
- [ ] Create users, projects and tokens from the CLI
- [ ] Compile JQL to SQL instead of filtering in memory
- [ ] Custom workflows per project
- [ ] Build step so packages can be published to npm

## Phase 4 — Import and UI
- [ ] Jira Cloud importer with a fidelity report
- [ ] Minimal web UI: board, list, issue view

## Later
- Free OIDC/SAML SSO, SCIM, audit log
- Postgres
- Docs (Confluence-style)
