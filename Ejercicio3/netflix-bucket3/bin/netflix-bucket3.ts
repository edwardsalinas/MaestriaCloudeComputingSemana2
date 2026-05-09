#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { NetflixBucket3Stack } from '../lib/netflix-bucket3-stack';

const app = new cdk.App();
new NetflixBucket3Stack(app, 'NetflixBucket3Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
    region:  process.env.CDK_DEFAULT_REGION  ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  },
});
