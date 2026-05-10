import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as fs from 'fs';
import * as path from 'path';

export class NetflixVpcLoadBalancerReplicasStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC: 3 AZs, subnets pública y privada, 1 NAT Gateway ────────────────
    const vpc = new ec2.Vpc(this, 'ReplicasVpc', {
      vpcName: 'openedx-replicas-vpc',
      maxAzs: 3,
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ─── Security Groups ───────────────────────────────────────────────────────

    // NLB (internet-facing)
    const nlbSg = new ec2.SecurityGroup(this, 'NlbSg', {
      vpc,
      description: 'NLB publico OpenEDX',
      allowAllOutbound: true,
    });
    nlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  'HTTP publico');
    nlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS publico');

    // ALB (interno)
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB interno OpenEDX',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(nlbSg,              ec2.Port.tcp(80), 'Desde NLB');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP interno');

    // EC2 replicas
    const ec2Sg = new ec2.SecurityGroup(this, 'Ec2Sg', {
      vpc,
      description: 'EC2 Ubuntu - OpenEDX replicas',
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(albSg,              ec2.Port.tcp(80),  'OpenEDX HTTP desde ALB');
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22),  'SSH acceso remoto');

    // Aurora: solo desde EC2
    const auroraSg = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc,
      description: 'Aurora PostgreSQL - solo desde EC2 replicas',
      allowAllOutbound: false,
    });
    auroraSg.addIngressRule(ec2Sg, ec2.Port.tcp(5432), 'PostgreSQL desde EC2');

    // ─── RDS PostgreSQL (compatible con cuentas free-plan) ────────────────────
    const auroraSecret = new secretsmanager.Secret(this, 'AuroraSecret', {
      secretName: 'openedx-aurora-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'openedxadmin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
        passwordLength: 32,
      },
    });

    const auroraCluster = new rds.DatabaseInstance(this, 'AuroraCluster', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [auroraSg],
      databaseName: 'openedx',
      credentials: rds.Credentials.fromSecret(auroraSecret),
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      backupRetention: cdk.Duration.days(0),
    });

    const auroraEndpoint = auroraCluster.instanceEndpoint.hostname;
    const auroraPort     = '5432';

    // ─── IAM Role para EC2 ────────────────────────────────────────────────────
    const ec2Role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    auroraSecret.grantRead(ec2Role);

    // ─── AMI Ubuntu 22.04 LTS ─────────────────────────────────────────────────
    const ubuntuAmi = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
      { os: ec2.OperatingSystemType.LINUX }
    );

    // ─── User-data compartido para las 3 réplicas ─────────────────────────────
    const makeUserData = (instanceIndex: number): ec2.UserData => {
      const ud = ec2.UserData.forLinux();
      let script = fs.readFileSync(
        path.join(__dirname, '..', 'user-data', 'openedx.sh'),
        'utf8'
      );
      script = script
        .replace(/\$\{AURORA_HOST\}/g,      auroraEndpoint)
        .replace(/\$\{AURORA_PORT\}/g,      auroraPort)
        .replace(/\$\{SECRET_ARN\}/g,       auroraSecret.secretArn)
        .replace(/\$\{AWS_REGION\}/g,       this.region)
        .replace(/\$\{INSTANCE_INDEX\}/g,   String(instanceIndex));
      ud.addCommands(script);
      return ud;
    };

    const privateSubnets = vpc.privateSubnets;

    // ─── 3 Instancias EC2 Ubuntu (una por AZ) ─────────────────────────────────
    const instances: ec2.Instance[] = [];

    for (let i = 0; i < 3; i++) {
      const inst = new ec2.Instance(this, `OpenedxReplica${i + 1}`, {
        vpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        machineImage: ubuntuAmi,
        securityGroup: ec2Sg,
        vpcSubnets: { subnets: [privateSubnets[i]] },
        role: ec2Role,
        userData: makeUserData(i + 1),
        blockDevices: [{
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(30),
        }],
      });
      cdk.Tags.of(inst).add('Service', 'openedx');
      cdk.Tags.of(inst).add('Replica', `replica-${i + 1}`);
      inst.node.addDependency(auroraCluster);
      instances.push(inst);
    }

    // ─── ALB interno (Private Subnet) ─────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: false,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      loadBalancerName: 'openedx-alb-internal',
    });

    // Target Group — round-robin entre las 3 réplicas en puerto 80
    const openedxTg = new elbv2.ApplicationTargetGroup(this, 'OpenedxTg', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: instances.map(inst => new targets.InstanceTarget(inst, 80)),
      healthCheck: {
        path: '/',
        port: '80',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200-302',
      },
      // Sticky sessions desactivadas → round-robin puro entre réplicas
      stickinessCookieDuration: undefined,
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const albListener = alb.addListener('AlbListener80', {
      port: 80,
      defaultTargetGroups: [openedxTg],
    });

    // ─── NLB (internet-facing, Public Subnet) → ALB ───────────────────────────
    const nlb = new elbv2.NetworkLoadBalancer(this, 'NLB', {
      vpc,
      internetFacing: true,
      securityGroups: [nlbSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      loadBalancerName: 'openedx-nlb-public',
      crossZoneEnabled: true,
    });

    const nlbTg = new elbv2.NetworkTargetGroup(this, 'NlbToAlbTg', {
      vpc,
      port: 80,
      protocol: elbv2.Protocol.TCP,
      targets: [new targets.AlbTarget(alb, 80)],
      healthCheck: {
        protocol: elbv2.Protocol.HTTP,
        path: '/',
        healthyHttpCodes: '200-302',
        interval: cdk.Duration.seconds(30),
      },
    });
    nlbTg.node.addDependency(albListener);

    nlb.addListener('NlbListener80', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [nlbTg],
    });

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OpenEDXUrl', {
      value: `http://${nlb.loadBalancerDnsName}`,
      description: 'URL pública de OpenEDX (NLB)',
    });

    new cdk.CfnOutput(this, 'NlbDns', {
      value: nlb.loadBalancerDnsName,
      description: 'DNS del NLB (acceso publico)',
    });

    new cdk.CfnOutput(this, 'AlbDns', {
      value: alb.loadBalancerDnsName,
      description: 'DNS del ALB (interno)',
    });

    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: auroraEndpoint,
      description: 'Endpoint Aurora PostgreSQL writer',
    });

    new cdk.CfnOutput(this, 'AuroraSecretArn', {
      value: auroraSecret.secretArn,
      description: 'ARN del secret de Aurora (Secrets Manager)',
    });

    // IDs de cada réplica EC2
    instances.forEach((inst, i) => {
      new cdk.CfnOutput(this, `Replica${i + 1}InstanceId`, {
        value: inst.instanceId,
        description: `Instance ID de OpenEDX Replica ${i + 1}`,
      });
    });
  }
}
