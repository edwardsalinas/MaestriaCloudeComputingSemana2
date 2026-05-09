#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { NetflixVpcLoadBalancerReplicasStack } from '../lib/netflix-vpc-load-balancer-replicas-stack';

const app = new cdk.App();
new NetflixVpcLoadBalancerReplicasStack(app, 'NetflixVpcLoadBalancerReplicasStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
    region:  process.env.CDK_DEFAULT_REGION  ?? 'us-east-1',
  },
});
