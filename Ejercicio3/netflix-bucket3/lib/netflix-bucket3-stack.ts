import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class NetflixBucket3Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── S3 Bucket (almacén de archivos) ──────────────────────────────────────
    const filesBucket = new s3.Bucket(this, 'NetflixFilesBucket', {
      bucketName: `netflix-files-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // ─── DynamoDB Table (metadatos de archivos) ────────────────────────────────
    const archivosTable = new dynamodb.Table(this, 'ArchivosTable', {
      tableName: 'archivos',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI por tipo de contenido → GET /files?tipo=image/jpeg
    archivosTable.addGlobalSecondaryIndex({
      indexName: 'tipo-index',
      partitionKey: { name: 'tipo', type: dynamodb.AttributeType.STRING },
    });

    // ─── Lambda helper ─────────────────────────────────────────────────────────
    const lambdaDir = path.join(__dirname, '..', 'lambda');

    const makeFn = (id: string, handler: string) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler,
        code: lambda.Code.fromAsset(lambdaDir),
        environment: {
          TABLE_NAME:  archivosTable.tableName,
          BUCKET_NAME: filesBucket.bucketName,
        },
        timeout: cdk.Duration.seconds(30),
      });

    const uploadFn = makeFn('UploadFileFn',  'upload-file.handler');
    const listFn   = makeFn('ListFilesFn',   'list-files.handler');
    const getFn    = makeFn('GetFileFn',     'get-file.handler');
    const deleteFn = makeFn('DeleteFileFn',  'delete-file.handler');

    // Permisos
    filesBucket.grantPut(uploadFn);
    filesBucket.grantRead(getFn);
    filesBucket.grantDelete(deleteFn);

    archivosTable.grantWriteData(uploadFn);
    archivosTable.grantReadData(listFn);
    archivosTable.grantReadData(getFn);
    archivosTable.grantReadWriteData(deleteFn);

    // ─── API Gateway ───────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'NetflixFilesApi', {
      restApiName: 'Netflix Files API',
      description: 'API para subir y gestionar archivos en S3',
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Filename', 'X-Filetype'],
      },
      binaryMediaTypes: ['*/*'],
    });

    // /api/v1/files
    const apiRes = api.root.addResource('api');
    const v1     = apiRes.addResource('v1');
    const files  = v1.addResource('files');

    files.addMethod('GET',  new apigateway.LambdaIntegration(listFn));
    files.addMethod('POST', new apigateway.LambdaIntegration(uploadFn, {
      contentHandling: apigateway.ContentHandling.CONVERT_TO_BINARY,
    }));

    // /api/v1/files/{id}
    const file = files.addResource('{id}');
    file.addMethod('GET',    new apigateway.LambdaIntegration(getFn));
    file.addMethod('DELETE', new apigateway.LambdaIntegration(deleteFn));

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL base del API Gateway',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: filesBucket.bucketName,
      description: 'Nombre del S3 bucket de archivos',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: archivosTable.tableName,
      description: 'Nombre de la tabla DynamoDB',
    });
  }
}
