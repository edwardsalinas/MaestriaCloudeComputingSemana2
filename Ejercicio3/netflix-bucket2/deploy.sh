#!/usr/bin/env bash
# Despliega el stack NetflixBucket2Stack resolviendo automáticamente
# la cuenta y región desde las credenciales AWS activas.
#
# Uso:
#   ./deploy.sh
#   ./deploy.sh --context netflixApiUrl=https://xxxx.execute-api.us-east-1.amazonaws.com/prod

set -euo pipefail

export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$(aws configure get region || echo "us-east-1")

echo "🚀  Desplegando en cuenta=${CDK_DEFAULT_ACCOUNT} región=${CDK_DEFAULT_REGION}"

npx cdk deploy "$@"
