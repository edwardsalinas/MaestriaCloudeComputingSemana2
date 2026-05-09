#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { NetflixBucket2Stack } from '../lib/netflix-bucket2-stack';

const app = new cdk.App();

// La URL del API Gateway puede pasarse como context:
//   cdk deploy --context netflixApiUrl=https://xxxx.execute-api.us-east-1.amazonaws.com/prod
// o como variable de entorno NETFLIX_API_URL
const netflixApiUrl =
  app.node.tryGetContext('netflixApiUrl') ??
  process.env.NETFLIX_API_URL ??
  '';

new NetflixBucket2Stack(app, 'NetflixBucket2Stack', {
  netflixApiUrl,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
    region:  process.env.CDK_DEFAULT_REGION  ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  },
});
