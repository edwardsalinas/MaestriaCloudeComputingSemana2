import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class NetflixApiDbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── DynamoDB Table ───────────────────────────────────────────────────────
    const peliculasTable = new dynamodb.Table(this, 'PeliculasTable', {
      tableName: 'peliculas',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI por género → GET /movies?genero=Accion
    peliculasTable.addGlobalSecondaryIndex({
      indexName: 'genero-index',
      partitionKey: { name: 'genero', type: dynamodb.AttributeType.STRING },
    });

    // GSI por director → GET /movies?director=Nolan
    peliculasTable.addGlobalSecondaryIndex({
      indexName: 'director-index',
      partitionKey: { name: 'director', type: dynamodb.AttributeType.STRING },
    });

    // GSI por año → GET /movies?anio=2010
    peliculasTable.addGlobalSecondaryIndex({
      indexName: 'anio-index',
      partitionKey: { name: 'anio', type: dynamodb.AttributeType.NUMBER },
    });

    // ─── Lambda helpers ───────────────────────────────────────────────────────
    const lambdaDir = path.join(__dirname, '..', 'lambda');

    const makeFn = (id: string, handler: string) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler,
        code: lambda.Code.fromAsset(lambdaDir),
        environment: { TABLE_NAME: peliculasTable.tableName },
      });

    const listFn   = makeFn('ListMoviesFn',   'list-movies.handler');
    const getFn    = makeFn('GetMovieFn',      'get-movie.handler');
    const createFn = makeFn('CreateMovieFn',   'create-movie.handler');
    const updateFn = makeFn('UpdateMovieFn',   'update-movie.handler');
    const deleteFn = makeFn('DeleteMovieFn',   'delete-movie.handler');

    // Grant DynamoDB permissions
    peliculasTable.grantReadData(listFn);
    peliculasTable.grantReadData(getFn);
    peliculasTable.grantWriteData(createFn);
    peliculasTable.grantReadWriteData(updateFn);
    peliculasTable.grantReadWriteData(deleteFn);

    // ─── API Gateway ──────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'NetflixApi', {
      restApiName: 'Netflix Peliculas API',
      description: 'CRUD de películas con DynamoDB',
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // /api/v1/movies
    const apiResource = api.root.addResource('api');
    const v1 = apiResource.addResource('v1');
    const movies = v1.addResource('movies');
    movies.addMethod('GET',  new apigateway.LambdaIntegration(listFn));
    movies.addMethod('POST', new apigateway.LambdaIntegration(createFn));

    // /api/v1/movies/{id}
    const movie = movies.addResource('{id}');
    movie.addMethod('GET',    new apigateway.LambdaIntegration(getFn));
    movie.addMethod('PUT',    new apigateway.LambdaIntegration(updateFn));
    movie.addMethod('DELETE', new apigateway.LambdaIntegration(deleteFn));

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL base del API Gateway',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: peliculasTable.tableName,
      description: 'Nombre de la tabla DynamoDB',
    });
  }
}
