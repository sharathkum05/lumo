# Deploying Lumo on AWS

Lumo stores its data in SQLite, which needs a real local disk. The simplest reliable setup on AWS is
**one EC2 instance** running Docker Compose: Lumo plus [Caddy](https://caddyserver.com), which gets and
renews an HTTPS certificate automatically.

```
Internet ──443──▶ EC2 (t4g.small, Amazon Linux 2023)
                   ├─ caddy  : TLS, reverse proxy
                   └─ lumo   : Node.js server ── /data/lumo.db (EBS volume)
```

## Why not ECS, App Runner or Lambda (yet)?

| Option | Problem today |
|---|---|
| App Runner, Lightsail containers, Lambda | No persistent disk, so the SQLite file would be lost on redeploy |
| ECS Fargate + EFS | EFS is a network file system; SQLite's locking is unreliable on it |
| ECS Fargate + RDS Postgres | The right setup for larger teams, once Lumo supports Postgres (on the roadmap) |

## Cost (ap-south-1, on demand)

| Item | Approx. per month |
|---|---|
| t4g.small (2 vCPU, 2 GB, ARM) | ~$12 |
| 20 GB gp3 EBS | ~$2 |
| Public IPv4 / Elastic IP | ~$3.60 |
| **Total** | **~$18** |

Check whether your account still has free-tier credits; t4g.micro also works for a small team.

## Launch

Prerequisites: the AWS CLI configured for your account (`aws configure` or SSO).

```sh
AWS_REGION=ap-south-1 ./deploy/aws/launch.sh
```

Optional settings:

| Variable | Meaning |
|---|---|
| `LUMO_DOMAIN` | Your hostname (create a DNS A record pointing at the Elastic IP). Defaults to `<ip>.sslip.io`, which works without owning a domain |
| `INSTANCE_TYPE` | Defaults to `t4g.small` |
| `KEY_NAME`, `SSH_CIDR` | An existing key pair and your IP (e.g. `203.0.113.7/32`) to allow SSH |

The script prints the URL. First boot takes about three minutes (installing Docker and building the image).
Progress is in `/var/log/cloud-init-output.log` on the instance.

## Get the admin token

Lumo prints a one-time admin API token on first start. Connect to the instance (SSH, or **EC2 Instance
Connect** in the console, which needs port 22 open to
[AWS's Instance Connect range](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-prerequisites.html)), then:

```sh
sudo docker compose -f /opt/lumo/deploy/aws/docker-compose.yml logs lumo | grep "API token"
```

Then on your machine:

```sh
export LUMO_URL=https://<your-domain> LUMO_TOKEN=lumo_...
pnpm lumo whoami
```

## Update to a new version

```sh
cd /opt/lumo && sudo git pull && sudo docker compose -f deploy/aws/docker-compose.yml --env-file deploy/aws/.env up -d --build
```

The database is on the `lumo-data` Docker volume, so it survives rebuilds.

## Backups

Turn on daily EBS snapshots with **Amazon Data Lifecycle Manager** (EC2 console → Lifecycle Manager →
create a policy targeting the instance's `Name=lumo` tag, keep 7–14 snapshots). SQLite runs in WAL mode,
so a snapshot is crash-consistent.

## Tear down

```sh
aws ec2 terminate-instances --instance-ids <instance-id>
aws ec2 release-address --allocation-id <elastic-ip-id>      # after the instance is terminated
aws ec2 delete-security-group --group-id <security-group-id>
```

## Before going public

Lumo does not have roles or per-project permissions yet: every authenticated user can change everything.
Only give tokens to people you trust until that lands.
