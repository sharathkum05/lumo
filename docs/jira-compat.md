# Jira REST API compatibility

Lumo serves a subset of the Jira Cloud REST API v3 under `/rest/api/3`, written from Atlassian's
public API documentation. Point a Jira client at your Lumo base URL and authenticate the same way
you would with Jira Cloud: `Basic base64(email:api_token)`, or `Bearer <token>`.

Errors use Jira's shape: `{ "errorMessages": ["..."], "errors": {} }`.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /serverInfo` | Public. Reports `deploymentType: "Cloud"` |
| `GET /myself` | |
| `GET /user?accountId=` | `accountId` is the Lumo user id |
| `GET /user/search?query=`, `GET /users/search` | |
| `GET /project`, `GET /project/search`, `GET /project/{key}` | |
| `GET /project/{key}/statuses` | |
| `GET /priority`, `GET /issuetype` | |
| `GET`/`POST /search` | Legacy offset pagination (`startAt`, `maxResults`, `total`) |
| `GET`/`POST /search/jql` | Token pagination (`nextPageToken`, `isLast`); returns only ids unless `fields` is given |
| `POST /issue` | `project`, `summary`, `issuetype`, `description`, `priority`, `assignee`, `labels`, `duedate`, `parent` |
| `GET /issue/{key}?fields=` | |
| `PUT /issue/{key}` | `fields` only; `update` operations are not supported yet |
| `DELETE /issue/{key}` | |
| `GET`/`POST /issue/{key}/transitions` | |
| `GET`/`POST /issue/{key}/comment` | |

Fields can be referenced the ways Jira allows: `{ "name": ... }`, `{ "id": ... }`, `{ "key": ... }`
or `{ "accountId": ... }`. Issue type ids are `10000`+ (Epic, Story, Task, Bug, Subtask) and priority
ids are `1`–`5` (Highest to Lowest).

## Differences from Jira

- **Rich text.** Descriptions and comments are stored as plain text. ADF input is flattened (paragraphs,
  line breaks and lists survive); output is simple paragraph ADF.
- **JQL.** See the supported subset in the README. Unsupported fields and functions return a 400.
- **Not yet supported:** custom fields, sprints, boards (Agile API), worklogs, attachments, issue links,
  `update` operations on `PUT /issue`, `expand`, changelogs, webhooks.
