#!/usr/bin/env bash
# Launches a single EC2 instance running Lumo. Requires the AWS CLI, configured for the target account.
#
#   AWS_REGION=ap-south-1 ./deploy/aws/launch.sh
#
# Creates: one security group (80/443 open; SSH only if SSH_CIDR is set), one t4g.small instance with a
# 20 GB gp3 disk, and one Elastic IP. These cost money; see docs/deploy-aws.md for teardown.
set -euo pipefail

REGION="${AWS_REGION:?Set AWS_REGION, e.g. ap-south-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
NAME="${NAME:-lumo}"
SSH_CIDR="${SSH_CIDR:-}"   # e.g. 203.0.113.7/32 to allow SSH from your IP
KEY_NAME="${KEY_NAME:-}"   # existing EC2 key pair, needed only for SSH

aws() { command aws --region "$REGION" "$@"; }
HERE="$(cd "$(dirname "$0")" && pwd)"

AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
  --query Parameter.Value --output text)
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)

SG=$(aws ec2 create-security-group --group-name "$NAME-web" --description "Lumo HTTP/HTTPS" --vpc-id "$VPC" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
if [ -n "$SSH_CIDR" ]; then
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$SSH_CIDR" >/dev/null
fi

# Allocate the Elastic IP first so user data can build the sslip.io hostname from the final address.
read -r ALLOC IP < <(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
  --query '[AllocationId,PublicIp]' --output text)
DOMAIN="${LUMO_DOMAIN:-${IP//./-}.sslip.io}"

USER_DATA=$(sed "s|^LUMO_DOMAIN=\"\${LUMO_DOMAIN:-}\"|LUMO_DOMAIN=\"$DOMAIN\"|" "$HERE/user-data.sh")

INSTANCE=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --security-group-ids "$SG" \
  ${KEY_NAME:+--key-name "$KEY_NAME"} \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true}' \
  --metadata-options HttpTokens=required \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --user-data "$USER_DATA" \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$INSTANCE"
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" >/dev/null

cat <<EOF
Launched $INSTANCE ($INSTANCE_TYPE) in $REGION
Elastic IP:      $IP
URL (in ~3 min): https://$DOMAIN
Security group:  $SG
Elastic IP id:   $ALLOC

Get the admin API token once it is up (SSH or EC2 Instance Connect):
  sudo docker compose -f /opt/lumo/deploy/aws/docker-compose.yml logs lumo | grep "API token"
EOF
