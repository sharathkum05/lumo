# Deploying Lumo on Fly.io

Fly.io runs the Docker image on one small VM with a persistent volume for SQLite, and gives you
`https://<app>.fly.dev` with TLS out of the box. It is the quickest way to get a demo instance online.

## Cost

A `shared-cpu-1x` machine with 512 MB and a 1 GB volume costs a few dollars a month. With
`auto_stop_machines = "stop"` (the default in `fly.toml`) the machine stops when idle and you pay
mostly for the volume; the first request after idle takes about a second.

## First deploy

```sh
brew install flyctl
fly auth login

# Pick a unique app name and update `app` in fly.toml to match.
fly apps create <your-app-name>

# The volume must be in the same region as primary_region (bom = Mumbai).
fly volumes create lumo_data --region bom --size 1

fly deploy
```

## Get the admin token

On first start Lumo prints a one-time admin API token:

```sh
fly logs | grep "API token"
```

Then:

```sh
export LUMO_URL=https://<your-app-name>.fly.dev LUMO_TOKEN=lumo_...
pnpm lumo whoami
```

To set the admin's email before the first start: `fly secrets set LUMO_ADMIN_EMAIL=you@example.com`.

## Updates

```sh
fly deploy
```

The database stays on the `lumo_data` volume across deploys.

## Backups

Fly takes daily volume snapshots and keeps them for 5 days by default (`fly volumes snapshots list`).
For longer retention, copy the database out periodically:

```sh
fly ssh sftp get /data/lumo.db ./lumo-backup.db
```

## Limits

- **One machine only.** SQLite on a single volume cannot be shared across machines, so do not run
  `fly scale count 2`. Horizontal scaling needs Postgres support (on the roadmap).
- **No roles or permissions yet.** Every authenticated user can change everything; only hand out
  tokens to people you trust.

## Tear down

```sh
fly apps destroy <your-app-name>   # also deletes its volumes
```
