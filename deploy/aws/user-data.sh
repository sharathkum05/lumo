#!/bin/bash
# EC2 user data for Amazon Linux 2023: installs Docker, clones Lumo and starts it behind Caddy.
# Runs once, as root, on first boot. Progress is logged to /var/log/cloud-init-output.log.
set -euxo pipefail

REPO_URL="${REPO_URL:-https://github.com/sharathkum05/lumo.git}"
# Leave empty to use <public-ip>.sslip.io, which resolves to this instance and gets a real certificate.
LUMO_DOMAIN="${LUMO_DOMAIN:-}"

dnf install -y docker git
systemctl enable --now docker

# Docker Compose v2 plugin; Amazon Linux does not package it.
ARCH=$(uname -m)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

if [ -z "$LUMO_DOMAIN" ]; then
  IMDS_TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  PUBLIC_IP=$(curl -fsS -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
  LUMO_DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi

git clone --depth 1 "$REPO_URL" /opt/lumo
cd /opt/lumo
echo "LUMO_DOMAIN=$LUMO_DOMAIN" > deploy/aws/.env
docker compose -f deploy/aws/docker-compose.yml --env-file deploy/aws/.env up -d --build

echo "Lumo is starting at https://$LUMO_DOMAIN"
