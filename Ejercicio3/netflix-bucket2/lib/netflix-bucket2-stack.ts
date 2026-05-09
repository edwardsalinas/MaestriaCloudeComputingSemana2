import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'path';

export interface NetflixBucket2StackProps extends cdk.StackProps {
  /** URL base del API Gateway de netflix-api-db (incluye /prod).
   *  Si se omite, la web quedará desplegada pero mostrará advertencia. */
  netflixApiUrl?: string;
}

export class NetflixBucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NetflixBucket2StackProps = {}) {
    super(scope, id, props);

    // ─── S3 Bucket (sitio web estático) ───────────────────────────────────────
    const siteBucket = new s3.Bucket(this, 'NetflixSiteBucket', {
      bucketName: `netflix-web-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ─── CloudFront Distribution ───────────────────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'NetflixOAC', {
      description: 'OAC para Netflix Web',
    });

    const distribution = new cloudfront.Distribution(this, 'NetflixDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      comment: 'Netflix Películas - frontend CDN',
    });

    // ─── Inyectar la URL del API en un config.js ───────────────────────────────
    // El HTML lee window.NETFLIX_API_URL; lo definimos en /config.js
    // que se sube como archivo inline junto al sitio web.
    const apiUrl = props.netflixApiUrl ?? '';

    // ─── Deploy website assets ─────────────────────────────────────────────────
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [
        // Archivos estáticos
        s3deploy.Source.asset(path.join(__dirname, '..', 'website')),
        // config.js generado dinámicamente con la URL del API
        s3deploy.Source.data(
          'config.js',
          `window.NETFLIX_API_URL = "${apiUrl}";`
        ),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'URL pública del sitio web (CloudFront)',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
      description: 'Nombre del S3 bucket del sitio web',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'ID de la distribución CloudFront',
    });
  }
}
