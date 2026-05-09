#!/usr/bin/env bash
# Despliega netflix-bucket3 resolviendo automáticamente cuenta y región.
set -euo pipefail

export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$(aws configure get region || echo "us-east-1")

echo "🚀  Desplegando NetflixBucket3Stack  cuenta=${CDK_DEFAULT_ACCOUNT}  región=${CDK_DEFAULT_REGION}"
npx cdk deploy --require-approval never "$@"
