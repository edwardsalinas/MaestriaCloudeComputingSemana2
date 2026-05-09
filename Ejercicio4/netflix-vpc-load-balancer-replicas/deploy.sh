#!/usr/bin/env bash
# Despliega NetflixVpcLoadBalancerReplicasStack
# Uso: ./deploy.sh
set -euo pipefail

export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$(aws configure get region || echo "us-east-1")

echo "🚀  Desplegando OpenEDX Replicas"
echo "    Cuenta : $CDK_DEFAULT_ACCOUNT"
echo "    Región : $CDK_DEFAULT_REGION"
echo ""

npx cdk deploy --require-approval never "$@"
