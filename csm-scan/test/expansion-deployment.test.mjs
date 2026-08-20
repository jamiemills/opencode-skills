import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { PROVIDER_CATEGORIES } from '../lib/scan/contracts/provider.mjs';
import { EVIDENCE_SOURCE_KINDS } from '../lib/scan/contracts/evidence.mjs';
import {
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_ARTIFACT_KINDS,
  EDGE_KINDS,
  INDICATOR_KINDS,
  RESOURCE_KINDS,
} from '../lib/scan/deep/deployment/model.mjs';
import {
  discoverDeploymentArtifacts,
  extractArtifact,
} from '../lib/scan/deep/deployment/extractor.mjs';
import { scanDeploymentTopology } from '../lib/scan/deep/deployment/scanner.mjs';
import { computeExpectedClaimCoverage } from '../lib/scan/enrich.mjs';
import {
  DEPLOYMENT_PROVIDER_ID,
  deploymentProviderResults,
} from '../lib/scan/providers/deployment.mjs';
import { renderDeployment } from '../lib/scan/render/deployment.mjs';
import { createRenderContext } from '../lib/scan/render/base.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-deployment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, ...rel.split('/'));
    await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

function requests(paths) {
  return paths.map((path) => ({ path, format: 'text', sensitivity: 'internal' }));
}

function assertCited(topology) {
  const declared = new Set([...topology.resources, ...topology.services].map((record) => record.id));
  for (const edge of topology.edges) {
    assert.ok(declared.has(edge.from), `edge from ${edge.from} must cite a declaration`);
    assert.ok(declared.has(edge.to), `edge to ${edge.to} must cite a declaration`);
  }
}

// ---------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------

test('T213 dockerfile: literal FROM images, stages, and build edges', async (t) => {
  const root = await fixture(t, {
    'Dockerfile': [
      'FROM node:20 AS base',
      'FROM base AS runtime',
      'COPY --from=base /app /app',
      'RUN echo hi',
      'ENV NODE_ENV=${NODE_ENV}',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['Dockerfile']) });
  const { topology } = result;
  assert.deepEqual(topology.images.map(({ reference, scope }) => [reference, scope]), [['node:20', 'from']]);
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), ['stage@base', 'stage@runtime']);
  assert.deepEqual(topology.edges.map(({ from, to, kind }) => [from, to, kind]).toSorted(), [
    ['stage@runtime', 'stage@base', 'build_from'],
    ['stage@runtime', 'stage@base', 'copy_from'],
  ]);
  assert.equal(topology.stubs.length, 0);
  assert.deepEqual(topology.indicators.map(({ kind }) => kind), ['interpolation']);
  assert.equal(topology.indicators[0].line, 5);
  assert.equal(result.artifacts[0].status, 'parsed');
  assertCited(topology);
});

test('T213 dockerfile: undeclared COPY --from becomes a stub, never a resource', async (t) => {
  const root = await fixture(t, {
    'Dockerfile': 'FROM node:20\nCOPY --from=missing /app /app\nCOPY --from=ghcr.io/acme/base:1 /app /app\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['Dockerfile']) });
  const { topology } = result;
  assert.deepEqual(topology.images.map(({ reference }) => reference).toSorted(),
    ['ghcr.io/acme/base:1', 'node:20']);
  assert.deepEqual(topology.stubs.map(({ kind, label, source }) => [kind, label, source]),
    [['stage', 'missing', 'copy_from']]);
  assert.equal(topology.resources.length, 0);
  assert.equal(topology.edges.length, 0);
});

// ---------------------------------------------------------------------------
// Docker Compose
// ---------------------------------------------------------------------------

test('T213 compose: services, images, depends_on edges, networks, and volumes', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '    ports:',
      '      - "8080:80"',
      '    depends_on:',
      '      - db',
      '      - cache',
      '    networks:',
      '      - front',
      '    volumes:',
      '      - data:/var/lib/data',
      '  db:',
      '    image: postgres:16',
      '    networks:',
      '      - front',
      '  cache:',
      '    image: redis:7',
      'networks:',
      '  front: {}',
      'volumes:',
      '  data: {}',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.services.map(({ id }) => id).toSorted(), ['service@cache', 'service@db', 'service@web']);
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), ['network@front', 'volume@data']);
  assert.deepEqual(topology.images.map(({ reference }) => reference).toSorted(),
    ['nginx:alpine', 'postgres:16', 'redis:7']);
  assert.deepEqual(topology.edges.map(({ from, to, kind }) => `${from}->${to}:${kind}`).toSorted(), [
    'service@db->network@front:network',
    'service@web->network@front:network',
    'service@web->service@cache:depends_on',
    'service@web->service@db:depends_on',
    'service@web->volume@data:volume',
  ]);
  assert.equal(topology.stubs.length, 0);
  assert.equal(topology.indicators.length, 0);
  assertCited(topology);
});

// ---------------------------------------------------------------------------
// Kubernetes
// ---------------------------------------------------------------------------

test('T213 kubernetes: literal resources, containers, images, and references', async (t) => {
  const root = await fixture(t, {
    'k8s/all.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: api',
      'spec:',
      '  replicas: 2',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: api',
      '          image: ghcr.io/acme/api:1.0',
      '          ports:',
      '            - containerPort: 8080',
      '          envFrom:',
      '            - configMapRef:',
      '                name: api-config',
      '            - secretRef:',
      '                name: api-secrets',
      '          env:',
      '            - name: DEBUG',
      '              valueFrom:',
      '                configMapKeyRef:',
      '                  name: api-config',
      '                  key: debug',
      '      volumes:',
      '        - name: data',
      '          persistentVolumeClaim:',
      '            claimName: api-data',
      '---',
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: api',
      'spec:',
      '  selector:',
      '    app: api',
      '  ports:',
      '    - port: 80',
      '      targetPort: 8080',
      '---',
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: api-config',
      'data:',
      '  debug: "false"',
      '---',
      'apiVersion: v1',
      'kind: Secret',
      'metadata:',
      '  name: api-secrets',
      'type: Opaque',
      '---',
      'apiVersion: v1',
      'kind: PersistentVolumeClaim',
      'metadata:',
      '  name: api-data',
      'spec:',
      '  accessModes:',
      '    - ReadWriteOnce',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['k8s/all.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'configmap@api-config',
    'deployment@api',
    'pvc@api-data',
    'secret@api-secrets',
    'service@api',
  ]);
  assert.deepEqual(topology.services.map(({ id, image }) => [id, image]), [['container@api:api', 'ghcr.io/acme/api:1.0']]);
  assert.deepEqual(topology.images.map(({ reference }) => reference), ['ghcr.io/acme/api:1.0']);
  assert.deepEqual(topology.edges.map(({ from, to, kind }) => `${from}->${to}:${kind}`).toSorted(), [
    'deployment@api->configmap@api-config:env_from',
    'deployment@api->configmap@api-config:value_from',
    'deployment@api->pvc@api-data:volume_from',
    'deployment@api->secret@api-secrets:env_from',
  ]);
  assert.equal(topology.stubs.length, 0);
  const serviceResource = topology.resources.find(({ id }) => id === 'service@api');
  assert.deepEqual(serviceResource.attributes.selector, ['app:api']);
  assert.equal(result.searchSpace.complete, true);
  assertCited(topology);
});

test('T213 kubernetes: block-scalar and anchor documents are diagnostics while valid peers survive', async (t) => {
  const root = await fixture(t, {
    'k8s/mixed.yaml': [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: broken',
      'data:',
      '  script: |',
      '    echo hi',
      '---',
      'apiVersion: v1',
      'kind: Pod',
      'metadata:',
      '  name: anchored',
      'spec: &base',
      '  restartPolicy: Never',
      '---',
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: api',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: api',
      '          image: nginx:1.25',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['k8s/mixed.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id), ['deployment@api']);
  assert.deepEqual(topology.images.map(({ reference }) => reference), ['nginx:1.25']);
  const diagnostics = topology.diagnostics.map(({ doc, status, reason }) => [doc, status, reason]);
  assert.ok(diagnostics.some(([doc]) => doc === 1), 'block-scalar document is recorded');
  assert.ok(diagnostics.some(([doc]) => doc === 2), 'anchor document is recorded');
  assert.ok(topology.diagnostics.every(({ status }) => ['malformed', 'unsupported'].includes(status)),
    'never expand anchors or block scalars');
  assert.equal(result.artifacts[0].status, 'parsed', 'valid peer document still parses');
});

// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------

test('T213 helm: chart metadata is literal and templates are markers without execution', async (t) => {
  const root = await fixture(t, {
    'helm/api/Chart.yaml': 'apiVersion: v2\nname: mychart\nversion: 1.2.0\n',
    'helm/api/templates/deployment.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: {{ include "chart.fullname" . }}',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}',
      '          imagePullPolicy: IfNotPresent',
      '---',
      'apiVersion: v1',
      'kind: Service',
      'metadata:',
      '  name: {{ .Release.Name }}-svc',
      'spec:',
      '  selector:',
      '    app: web',
      '',
    ].join('\n'),
    'helm/api/values.yaml': 'image:\n  repository: nginx\n  tag: 1.25\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests([
    'helm/api/Chart.yaml',
    'helm/api/templates/deployment.yaml',
    'helm/api/values.yaml',
  ]) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id), ['chart@mychart']);
  assert.equal(topology.resources[0].attributes.version, '1.2.0');
  assert.equal(topology.images.length, 0, 'templated images are never materialized');
  assert.equal(topology.edges.length, 0);
  const markers = topology.indicators.filter(({ kind }) => kind === 'template_marker');
  assert.ok(markers.length >= 3, 'every {{ }} region is a template marker');
  assert.ok(topology.indicators.every(({ kind }) => INDICATOR_KINDS.includes(kind)));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('{{'), false, 'template expressions are never captured');
});

// ---------------------------------------------------------------------------
// Terraform
// ---------------------------------------------------------------------------

test('T213 terraform: literal resources and direct references, stubs and indicators', async (t) => {
  const root = await fixture(t, {
    'main.tf': [
      'variable "env" {',
      '  default = "dev"',
      '}',
      'resource "aws_s3_bucket" "assets" {',
      '  bucket = "assets-${var.env}"',
      '}',
      'resource "aws_lambda_function" "api" {',
      '  image_uri = "ghcr.io/acme/api:1.0"',
      '}',
      'resource "aws_sqs_queue" "jobs" {',
      '  name = "jobs"',
      '}',
      'resource "aws_lambda_event_source_mapping" "poll" {',
      '  function_name = aws_lambda_function.api.arn',
      '  event_source_arn = aws_sqs_queue.jobs.arn',
      '}',
      'module "networking" {',
      '  source = "terraform-aws-modules/vpc/aws"',
      '}',
      'locals {',
      '  prefix = "acme"',
      '}',
      'output "api_url" {',
      '  value = "https://api.example.test"',
      '}',
      'resource "aws_iam_policy" "dynamic" {',
      '  for_each = toset(["a", "b"])',
      '  policy = "{}"',
      '}',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['main.tf']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'bucket@assets',
    'function@api',
    'local@default',
    'local@prefix',
    'module@networking',
    'output@api_url',
    'policy@dynamic',
    'queue@jobs',
    'trigger@poll',
    'variable@env',
  ]);
  assert.deepEqual(topology.images.map(({ reference }) => reference), ['ghcr.io/acme/api:1.0']);
  assert.deepEqual(topology.edges.map(({ from, to, kind }) => `${from}->${to}:${kind}`).toSorted(), [
    'bucket@assets->variable@env:reference',
    'trigger@poll->function@api:reference',
    'trigger@poll->queue@jobs:reference',
  ]);
  const moduleRecord = topology.resources.find(({ id }) => id === 'module@networking');
  assert.equal(moduleRecord.attributes.source, 'terraform-aws-modules/vpc/aws');
  assert.deepEqual(topology.indicators.map(({ kind }) => kind).toSorted(), ['for_each']);
  assert.equal(topology.stubs.length, 0);
  assertCited(topology);
});

test('T213 terraform: dynamic names, counts, and remote functions never fabricate resources', async (t) => {
  const root = await fixture(t, {
    'main.tf': [
      'resource "aws_iam_policy" "${var.name}" {',
      '  policy = "{}"',
      '}',
      'resource "aws_s3_bucket" "logs" {',
      '  count = var.enabled ? 1 : 0',
      '  bucket = "logs-${count.index}"',
      '}',
      'resource "aws_ssm_parameter" "from_module" {',
      '  value = module.networking.vpc_id',
      '}',
      'resource "aws_cloudwatch_log_group" "unknown_fn" {',
      '  value = templatefile("tpl.txt", { x = 1 })',
      '}',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['main.tf']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'bucket@logs',
    'log_group@unknown_fn',
    'parameter@from_module',
  ]);
  assert.equal(topology.resources.some(({ label }) => label.startsWith('${')), false,
    'dynamic resource names never become resources');
  const kinds = topology.indicators.map(({ kind }) => kind);
  assert.ok(kinds.includes('count'));
  assert.ok(kinds.includes('template_function'));
  const moduleStub = topology.stubs.find(({ kind }) => kind === 'output');
  assert.equal(moduleStub?.label, 'networking');
  assert.equal(moduleStub?.source, 'output');
});

// ---------------------------------------------------------------------------
// CloudFormation
// ---------------------------------------------------------------------------

test('T213 cloudformation: literal resources, safe intrinsics, unresolved refs and transforms', async (t) => {
  const root = await fixture(t, {
    'cfn/template.yaml': [
      'AWSTemplateFormatVersion: "2010-09-09"',
      'Parameters:',
      '  Env:',
      '    Type: String',
      '    Default: dev',
      'Resources:',
      '  AssetsBucket:',
      '    Type: AWS::S3::Bucket',
      '    Properties:',
      '      BucketName: !Sub assets-${Env}',
      '  ApiFunction:',
      '    Type: AWS::Lambda::Function',
      '    Properties:',
      '      Runtime: nodejs20.x',
      '      Environment:',
      '        Variables:',
      '          BUCKET: !Ref AssetsBucket',
      '  JobQueue:',
      '    Type: AWS::SQS::Queue',
      '  PollTrigger:',
      '    Type: AWS::Lambda::EventSourceMapping',
      '    Properties:',
      '      FunctionName: !GetAtt ApiFunction.Arn',
      '      EventSourceArn: !GetAtt JobQueue.Arn',
      '  ExternalDep:',
      '    Type: AWS::SNS::Topic',
      '    Properties:',
      '      TopicName: !ImportValue shared-topic',
      '  Conditional:',
      '    Type: AWS::SQS::Queue',
      '    Condition: IsProd',
      'Outputs:',
      '  BucketArn:',
      '    Value: !GetAtt AssetsBucket.Arn',
      'Conditions:',
      '  IsProd:',
      '    !Equals [!Ref Env, "prod"]',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['cfn/template.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'bucket@AssetsBucket',
    'function@ApiFunction',
    'output@BucketArn',
    'parameter@Env',
    'queue@Conditional',
    'queue@JobQueue',
    'topic@ExternalDep',
    'trigger@PollTrigger',
  ]);
  assert.deepEqual(topology.edges.map(({ from, to, kind }) => `${from}->${to}:${kind}`).toSorted(), [
    'bucket@AssetsBucket->parameter@Env:reference',
    'function@ApiFunction->bucket@AssetsBucket:reference',
    'output@BucketArn->bucket@AssetsBucket:reference',
    'trigger@PollTrigger->function@ApiFunction:reference',
    'trigger@PollTrigger->queue@JobQueue:reference',
  ]);
  const importStub = topology.stubs.find(({ source }) => source === 'export');
  assert.equal(importStub.label, 'shared-topic');
  assert.ok(topology.indicators.some(({ kind }) => kind === 'intrinsic'), 'conditions remain intrinsics');
  assertCited(topology);
});

test('T213 cloudformation: JSON template with Fn:: intrinsics', async (t) => {
  const root = await fixture(t, {
    'cfn/template.json': JSON.stringify({
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
        Queue: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: { 'Fn::Sub': 'app-${Env}' } },
        },
        Job: {
          Type: 'AWS::SNS::Topic',
          Properties: { Name: { 'Fn::Join': ['-', ['app', { Ref: 'Bucket' }]] } },
        },
      },
    }),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['cfn/template.json']) });
  const { topology } = result;
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'bucket@Bucket',
    'queue@Queue',
    'topic@Job',
  ]);
  assert.deepEqual(topology.edges.map(({ from, to }) => `${from}->${to}`), ['topic@Job->bucket@Bucket']);
  assert.ok(topology.indicators.some(({ kind }) => kind === 'intrinsic'));
});

// ---------------------------------------------------------------------------
// Serverless
// ---------------------------------------------------------------------------

test('T213 serverless: functions, images, events, resources, and variables', async (t) => {
  const root = await fixture(t, {
    'serverless.yml': [
      'service: demo-api',
      'provider:',
      '  name: aws',
      '  runtime: nodejs20.x',
      'functions:',
      '  hello:',
      '    handler: src/handler.hello',
      '    events:',
      '      - http:',
      '          path: hello',
      '          method: get',
      '      - schedule: rate(1 hour)',
      '  worker:',
      '    image: ghcr.io/acme/worker:latest',
      'resources:',
      '  Resources:',
      '    WorkerQueue:',
      '      Type: AWS::SQS::Queue',
      '    WorkerTrigger:',
      '      Type: AWS::Lambda::EventSourceMapping',
      '      Properties:',
      '        EventSourceArn: !GetAtt WorkerQueue.Arn',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['serverless.yml']) });
  const { topology } = result;
  assert.deepEqual(topology.services.map(({ id }) => id).toSorted(), ['function@hello', 'function@worker']);
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), [
    'provider@aws',
    'queue@WorkerQueue',
    'service@demo-api',
    'trigger@WorkerTrigger',
  ]);
  assert.deepEqual(topology.images.map(({ reference }) => reference), ['ghcr.io/acme/worker:latest']);
  assert.deepEqual(topology.edges.map(({ from, to }) => `${from}->${to}`), ['trigger@WorkerTrigger->queue@WorkerQueue']);
  assert.equal(topology.stubs.length, 0);
  assertCited(topology);
});

test('T213 serverless: env/cf variables become unresolved stubs or indicators, never values', async (t) => {
  const root = await fixture(t, {
    'serverless.yml': [
      'service: demo',
      'provider: { name: aws }',
      'functions:',
      '  notify:',
      '    handler: src/notify.handle',
      '    environment:',
      '      STAGE: ${env:STAGE}',
      '      REGION: ${self:provider.region}',
      '      SECRET_ARN: ${cf:shared-stack.SecretArn}',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['serverless.yml']) });
  const { topology } = result;
  const stubs = topology.stubs.map(({ source, label }) => [source, label]);
  assert.ok(stubs.some(([source, label]) => source === 'resolver' && label === 'env:STAGE'));
  assert.ok(stubs.some(([source, label]) => source === 'resolver' && label === 'cf:shared-stack.SecretArn'));
  const kinds = topology.indicators.map(({ kind }) => kind);
  assert.ok(kinds.includes('resolver'), 'self references remain indicators');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('${env:STAGE}'), false, 'variable expressions are never captured as values');
});

// ---------------------------------------------------------------------------
// Dynamic constructs / no fabrication
// ---------------------------------------------------------------------------

test('T213 dynamic constructs produce indicators and stubs, never fabricated resources', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: ${IMAGE}\n  ok:\n    image: nginx\n',
    'helm/charts/app/templates/svc.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n',
    'main.tf': 'resource "aws_instance" "${var.which}" {\n  ami = "ami-1"\n}\nresource "aws_s3_bucket" "fixed" {\n  bucket = var.bucket\n}\nvariable "which" {\n}\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests([
    'compose.yaml',
    'helm/charts/app/templates/svc.yaml',
    'main.tf',
  ]) });
  const { topology } = result;
  const images = topology.images.map(({ reference }) => reference);
  assert.deepEqual(images, ['nginx'], 'interpolated image is never materialized');
  assert.ok(topology.indicators.some(({ kind }) => kind === 'interpolation'));
  assert.ok(topology.indicators.some(({ kind }) => kind === 'template_marker'));
  assert.equal(topology.resources.some(({ label }) => label.includes('${')), false);
  assert.deepEqual(topology.resources.map(({ id }) => id).toSorted(), ['bucket@fixed', 'variable@which'],
    'dynamic terraform names produce no resources; literal resources remain');
});

// ---------------------------------------------------------------------------
// Ambiguity
// ---------------------------------------------------------------------------

test('T213 ambiguity: duplicate declarations keep references unresolved', async (t) => {
  const root = await fixture(t, {
    'app.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: nginx:1.25',
      '          envFrom:',
      '            - configMapRef:',
      '                name: shared',
      '',
    ].join('\n'),
    'cfg-one.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: shared\ndata:\n  KEY: one\n',
    'cfg-two.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: shared\ndata:\n  KEY: two\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['app.yaml', 'cfg-one.yaml', 'cfg-two.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.edges, [], 'ambiguous references never become edges');
  assert.deepEqual(topology.stubs.map(({ kind, label }) => [kind, label]), [['configmap', 'shared']]);
});

test('T213 ambiguity: in-artifact edges on duplicate declarations become renderer stubs, never dropped', async (t) => {
  const root = await fixture(t, {
    'app.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: nginx:1.25',
      '          envFrom:',
      '            - configMapRef:',
      '                name: shared',
      '---',
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: shared',
      'data:',
      '  KEY: value',
      '',
    ].join('\n'),
    'dup.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: nginx:1.26',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['app.yaml', 'dup.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.edges, [], 'ambiguous in-artifact edge never becomes an edge');
  assert.deepEqual(topology.stubs.map(({ kind, label, source, path }) => [kind, label, source, path]),
    [['configmap', 'shared', 'env_from', 'app.yaml']]);
  const output = renderDeployment('repo', topology);
  assert.ok(output.includes('### Unresolved References (1)'), 'ambiguous edge is retained as a stub in the renderer');
  assert.ok(output.includes('| configmap | shared | app.yaml |'), 'stub row cites kind, reference, and path');
});

// ---------------------------------------------------------------------------
// Cross-artifact resolution
// ---------------------------------------------------------------------------

test('T213 cross-artifact: exact explicit references resolve to edges that cite declarations', async (t) => {
  const root = await fixture(t, {
    'app.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: nginx:1.25',
      '          envFrom:',
      '            - configMapRef:',
      '                name: shared',
      '',
    ].join('\n'),
    'cfg.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: shared\ndata:\n  KEY: value\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['app.yaml', 'cfg.yaml']) });
  const { topology } = result;
  assert.deepEqual(topology.edges.map(({ from, to, kind, crossArtifact }) => [from, to, kind, crossArtifact]),
    [['deployment@app', 'configmap@shared', 'env_from', true]]);
  assert.equal(topology.stubs.length, 0);
  assertCited(topology);
});

test('T213 unresolved references never become edges or resources', async (t) => {
  const root = await fixture(t, {
    'app.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: app',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: nginx:1.25',
      '          envFrom:',
      '            - secretRef:',
      '                name: never-declared',
      '',
    ].join('\n'),
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['app.yaml']) });
  const { topology } = result;
  assert.equal(topology.edges.length, 0);
  assert.deepEqual(topology.stubs.map(({ kind, label }) => [kind, label]), [['secret', 'never-declared']]);
  assert.equal(topology.resources.some(({ id }) => id === 'secret@never-declared'), false);
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test('T213 privacy: sensitive labels reject the artifact without leaking values', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: nginx\n  dev@example.com:\n    image: nginx\n',
    'Dockerfile': 'FROM nginx\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml', 'Dockerfile']) });
  const byPath = Object.fromEntries(result.artifacts.map((entry) => [entry.path, entry]));
  assert.equal(byPath['compose.yaml'].status, 'unverified');
  assert.equal(byPath['compose.yaml'].reason, 'privacy');
  assert.equal(byPath['Dockerfile'].status, 'parsed', 'valid peer artifact survives');
  assert.deepEqual(result.topology.images.map(({ reference }) => reference), ['nginx']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('@example.com'), false, 'sensitive identity never leaks');
  assert.equal(result.searchSpace.complete, false, 'privacy rejection gates completeness');
  assert.equal(result.searchSpace.supported, true);
  assert.equal(result.searchSpace.malformed, false);
  assert.equal(result.searchSpace.capped, false);
});

// ---------------------------------------------------------------------------
// Per-artifact atomicity and caps
// ---------------------------------------------------------------------------

test('T213 per-artifact atomicity: malformed and unsupported peers never erase valid artifacts', async (t) => {
  const root = await fixture(t, {
    'bad-compose.yaml': 'services:\n  web:\n    image: |\n      nginx\n', // block scalar throws
    'notes.yaml': 'not a deployment file\n',
    'compose.yaml': 'services:\n  web:\n    image: nginx\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests([
    'bad-compose.yaml',
    'notes.yaml',
    'compose.yaml',
    'missing.txt',
  ]) });
  const byPath = Object.fromEntries(result.artifacts.map((entry) => [entry.path, entry]));
  assert.equal(byPath['bad-compose.yaml'].status, 'malformed');
  assert.equal(byPath['notes.yaml'].status, 'unsupported');
  assert.equal(byPath['missing.txt'].status, 'unreadable');
  assert.equal(byPath['compose.yaml'].status, 'parsed');
  assert.deepEqual(result.topology.services.map(({ id }) => id), ['service@web']);
  const statuses = result.topology.diagnostics.map(({ path, status }) => [path, status]);
  assert.ok(statuses.some(([path, status]) => path === 'bad-compose.yaml' && status === 'malformed'));
  assert.ok(statuses.some(([path, status]) => path === 'missing.txt' && status === 'unreadable'));
});

test('T213 caps: per-artifact and repository-level caps are disclosed atomically', async (t) => {
  const services = {};
  for (let index = 0; index < 300; index++) services[`svc-${index}`] = { image: 'nginx' };
  const root = await fixture(t, {
    'huge.yaml': `services:\n${Object.entries(services)
      .map(([name]) => `  ${name}:\n    image: nginx`)
      .join('\n')}\n`,
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['huge.yaml']) });
  assert.equal(result.artifacts[0].status, 'capped');
  assert.ok(['IMAGE_LIMIT', 'SERVICE_LIMIT'].includes(result.artifacts[0].reason));
  assert.deepEqual(result.topology.resources, [], 'no partial values survive a capped artifact');
  assert.deepEqual(result.topology.services, []);
  const cappedDiag = result.topology.diagnostics.find(({ path }) => path === 'huge.yaml');
  assert.equal(cappedDiag.status, 'capped');
  assert.equal(result.searchSpace.capped, true, 'extraction caps fold into the search space');
  assert.equal(result.searchSpace.complete, false);
});

test('T213 repository-level caps truncate deterministically and are disclosed', async (t) => {
  const files = {};
  for (let index = 0; index < 300; index++) {
    files[`k8s/f-${String(index).padStart(3, '0')}.yaml`] =
      `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app-${index}\nspec:\n  template:\n    spec:\n      containers:\n        - name: web\n          image: nginx\n`;
  }
  const root = await fixture(t, files);
  const options = { ...DEPLOYMENT_LIMITS, maxArtifacts: 40, maxResources: 16 };
  const result = await scanDeploymentTopology({ root, requests: Object.keys(files).slice(0, 40), options });
  const { topology } = result;
  assert.equal(topology.counts.artifacts, 40);
  assert.equal(topology.resources.length, 16);
  assert.equal(topology.capped, true);
  assert.ok(topology.cappedKinds.includes('resources'));
  assert.equal(Object.isFrozen(topology), true);
});

// ---------------------------------------------------------------------------
// Search space
// ---------------------------------------------------------------------------

test('T213 searchSpace is T202-compatible and deterministic', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: nginx\n',
    'Dockerfile': 'FROM node:20\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml', 'Dockerfile']) });
  assert.deepEqual(Object.keys(result.searchSpace).toSorted(), [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ]);
  assert.equal(result.searchSpace.complete, true);
  assert.equal(result.searchSpace.supported, true);
  assert.equal(result.searchSpace.readable, true);
  assert.equal(result.searchSpace.capped, false);
  assert.equal(Object.isFrozen(result.searchSpace), true);
  assert.equal(Object.isFrozen(result), true);
});

test('T213 unreadable artifacts are reflected in the search space', async (t) => {
  const root = await fixture(t, { 'Dockerfile': 'FROM nginx\n' });
  const result = await scanDeploymentTopology({ root, requests: requests(['Dockerfile', 'gone.yaml']) });
  assert.equal(result.searchSpace.readable, false);
  assert.equal(result.searchSpace.error, true);
  assert.equal(result.searchSpace.complete, false);
});

test('T213 searchSpace: unsupported candidates fold supported=false and gate complete, peers survive', async (t) => {
  const root = await fixture(t, {
    'notes.yaml': 'not a deployment file\n',
    'Dockerfile': 'FROM node:20\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['notes.yaml', 'Dockerfile']) });
  assert.equal(result.searchSpace.supported, false);
  assert.equal(result.searchSpace.complete, false);
  assert.equal(result.searchSpace.readable, true);
  assert.equal(result.searchSpace.malformed, false);
  assert.equal(result.searchSpace.capped, false);
  const byPath = Object.fromEntries(result.artifacts.map((entry) => [entry.path, entry]));
  assert.equal(byPath['notes.yaml'].status, 'unsupported');
  assert.equal(byPath['Dockerfile'].status, 'parsed', 'valid peer artifact survives');
  assert.deepEqual(result.topology.images.map(({ reference }) => reference), ['node:20']);
});

// F-020: a mixed supported/unsupported manifest set (parsed compose peer plus
// a NO_EXTRACTOR yaml admitted from a deployment directory) emits
// supported=false with readable=true. That shape is neither cleanly complete
// nor cleanly unsupported, so the claim grader must keep the deployment claim
// unverified — never upgrade it to observed off partial coverage.
test('T213 mixed supported/unsupported manifests keep the deployment claim non-observed (F-020)', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: nginx\n',
    'k8s/notes.yaml': 'not a deployment file\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml', 'k8s/notes.yaml']) });

  assert.equal(result.topology.searchSpace.supported, false, 'NO_EXTRACTOR peer folds supported=false');
  assert.equal(result.topology.searchSpace.readable, true, 'both artifacts were read');
  assert.equal(result.topology.searchSpace.complete, false);
  const byPath = Object.fromEntries(result.artifacts.map((entry) => [entry.path, entry]));
  assert.equal(byPath['compose.yaml'].status, 'parsed', 'valid peer artifact survives');
  assert.equal(byPath['k8s/notes.yaml'].status, 'unsupported');

  const coverage = computeExpectedClaimCoverage(
    [{ dimension: 'deployment', signal: 'high', findings: result.topology }],
    {},
  );
  assert.notEqual(
    coverage.perDimension.deployment.status,
    'observed',
    'a partially-unsupported search must never upgrade the claim to observed',
  );
  assert.equal(coverage.perDimension.deployment.status, 'unverified');
});

test('T213 searchSpace: malformed and capped extraction outcomes fold while peers survive', async (t) => {
  const services = {};
  for (let index = 0; index < 300; index++) services[`svc-${index}`] = { image: 'nginx' };
  const root = await fixture(t, {
    'bad-compose.yaml': 'services:\n  web:\n    image: |\n      nginx\n',
    'huge.yaml': `services:\n${Object.entries(services)
      .map(([name]) => `  ${name}:\n    image: nginx`)
      .join('\n')}\n`,
    'Dockerfile': 'FROM node:20\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['bad-compose.yaml', 'huge.yaml', 'Dockerfile']) });
  assert.equal(result.searchSpace.malformed, true);
  assert.equal(result.searchSpace.capped, true);
  assert.equal(result.searchSpace.complete, false);
  assert.equal(result.searchSpace.supported, true);
  assert.equal(result.searchSpace.readable, true);
  const byPath = Object.fromEntries(result.artifacts.map((entry) => [entry.path, entry]));
  assert.equal(byPath['bad-compose.yaml'].status, 'malformed');
  assert.equal(byPath['huge.yaml'].status, 'capped');
  assert.equal(byPath['Dockerfile'].status, 'parsed', 'valid peer artifact survives');
  assert.deepEqual(result.topology.images.map(({ reference }) => reference), ['node:20']);
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('T213 discovery selects only deployment candidate paths', () => {
  const files = [
    'Dockerfile',
    'docker-compose.yml',
    'k8s/deployment.yaml',
    'helm/api/templates/svc.yaml',
    'main.tf',
    'src/index.js',
    'package.json',
    'README.md',
    'docs/guide.yaml',
  ];
  assert.deepEqual(discoverDeploymentArtifacts(files), [
    'Dockerfile',
    'docker-compose.yml',
    'helm/api/templates/svc.yaml',
    'k8s/deployment.yaml',
    'main.tf',
  ]);
});

// ---------------------------------------------------------------------------
// Provider (T210 base)
// ---------------------------------------------------------------------------

test('T213 provider: DIM-deployment categories via T210 base, immutable and deterministic', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '    depends_on:',
      '      - db',
      '    networks:',
      '      - net',
      '  db:',
      '    image: postgres:16',
      '    networks:',
      '      - net',
      'networks:',
      '  net: {}',
      '',
    ].join('\n'),
    'Dockerfile': 'FROM node:20\n',
    'main.tf': 'resource "aws_s3_bucket" "assets" {\n  for_each = toset(["a"])\n}\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml', 'Dockerfile', 'main.tf']) });
  const first = deploymentProviderResults({ topology: result.topology });
  const second = deploymentProviderResults({ topology: result.topology });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.results.length, 1);
  const providerResult = first.results[0];
  assert.equal(providerResult.providerId, DEPLOYMENT_PROVIDER_ID);
  assert.equal(providerResult.dimensionId, 'DIM-deployment-v1');
  assert.equal(Object.isFrozen(providerResult), true);
  assert.equal(Object.isFrozen(providerResult.observations), true);
  const allowed = PROVIDER_CATEGORIES['DIM-deployment-v1'];
  for (const observation of providerResult.observations) {
    assert.ok(allowed.includes(observation.category), `category ${observation.category} is allowlisted`);
    assert.ok(EVIDENCE_SOURCE_KINDS.includes(observation.sourceKind));
  }
  const categories = new Set(providerResult.observations.map(({ category }) => category));
  assert.deepEqual([...categories].toSorted(),
    ['image', 'resource', 'service', 'template_indicator', 'topology_edge']);
  const indicator = providerResult.observations.find(({ category }) => category === 'template_indicator');
  assert.equal(indicator.details.kind, 'for_each');
  assert.equal(indicator.details.count, 1);
  assert.equal(first.capped, false);
});

test('T213 provider: aggregated indicators and capping are disclosed', () => {
  const resources = [];
  for (let index = 0; index < 2100; index++) {
    resources.push({
      id: `cloud_resource@r-${index}`,
      kind: 'cloud_resource',
      label: `r-${index}`,
      path: 'k8s/many.yaml',
      line: null,
      attributes: null,
    });
  }
  const topology = {
    images: [],
    resources,
    services: [],
    edges: [],
    stubs: [],
    indicators: [
      { kind: 'for_each', path: 'main.tf', line: 1 },
      { kind: 'for_each', path: 'main.tf', line: 2 },
      { kind: 'count', path: 'main.tf', line: 3 },
    ],
    artifactsByPath: { 'k8s/many.yaml': 'kubernetes', 'main.tf': 'terraform' },
  };
  const result = deploymentProviderResults({ topology });
  assert.equal(result.capped, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].observations.length, 2048);
  for (const observation of result.results[0].observations) {
    assert.ok(PROVIDER_CATEGORIES['DIM-deployment-v1'].includes(observation.category));
  }
});

test('T213 provider: invalid topology inputs fail with typed errors', () => {
  assert.throws(() => deploymentProviderResults({ topology: null }), /Deployment provider failed/);
  assert.throws(() => deploymentProviderResults({ topology: [1, 2] }), /Deployment provider failed/);
});

// ---------------------------------------------------------------------------
// Renderer (INERT factory)
// ---------------------------------------------------------------------------

test('T213 renderer: neutral inert factory renders the model without verdicts', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: nginx:alpine\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml']) });
  const output = renderDeployment('repo', result.topology);
  assert.ok(output.startsWith('## Deployment Topology'));
  assert.ok(output.includes('nginx:alpine'));
  assert.ok(output.includes('service@web'));
  for (const verdict of ['vulnerable', 'at risk', 'recommended', 'best practice', 'production-ready', 'costly']) {
    assert.equal(output.includes(verdict), false, `no verdict language: ${verdict}`);
  }
  const noInput = renderDeployment('repo', null);
  assert.equal(noInput, '');
});

test('T213 renderer: privacy hook escapes every user-derived cell', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': 'services:\n  web:\n    image: nginx:alpine\n',
  });
  const result = await scanDeploymentTopology({ root, requests: requests(['compose.yaml']) });
  const context = createRenderContext({ privacyHook: () => '[safe]' });
  const output = renderDeployment('repo', result.topology, context);
  assert.equal(output.includes('nginx:alpine'), false, 'values pass through the privacy hook');
  assert.ok(output.includes('[safe]'));
});

test('T213 renderer is INERT: not registered in write or existing-ten renderers', async () => {
  const writeSource = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  assert.equal(writeSource.includes('deployment.mjs'), false);
  assert.equal(existingTen.includes('deployment.mjs'), false);
});

// ---------------------------------------------------------------------------
// Inertness and source policy
// ---------------------------------------------------------------------------

test('T213 inertness: deployment modules never touch fs, child_process, or execution surfaces', async () => {
  const owned = [
    'lib/scan/deep/deployment/model.mjs',
    'lib/scan/deep/deployment/extractor.mjs',
    'lib/scan/deep/deployment/scanner.mjs',
    'lib/scan/providers/deployment.mjs',
    'lib/scan/render/deployment.mjs',
  ];
  for (const relative of owned) {
    const source = await readFile(join(LIB_ROOT, '..', relative), 'utf8');
    for (const forbidden of [
      "from 'node:fs", "from 'node:child_process", "from 'node:process", "from 'node:vm",
      "from 'node:module", 'require(', 'execFile(', 'execSync(', 'spawn(', 'writeFile(',
    ]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not contain ${forbidden}`);
    }
  }
  const providerSource = await readFile(join(LIB_ROOT, 'scan', 'providers', 'deployment.mjs'), 'utf8');
  const rendererSource = await readFile(join(LIB_ROOT, 'scan', 'render', 'deployment.mjs'), 'utf8');
  for (const source of [providerSource, rendererSource]) {
    for (const surface of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
      assert.equal(source.includes(surface), false, 'inert modules expose no execution surfaces');
    }
  }
});

test('T213 model constants are exact, frozen, and aligned with the DIM-deployment contract', () => {
  assert.deepEqual(DEPLOYMENT_ARTIFACT_KINDS, [
    'cloudformation', 'compose', 'dockerfile', 'helm_chart', 'helm_template',
    'kubernetes', 'serverless', 'terraform',
  ]);
  assert.equal(Object.isFrozen(DEPLOYMENT_ARTIFACT_KINDS), true);
  assert.equal(Object.isFrozen(DEPLOYMENT_LIMITS), true);
  assert.equal(RESOURCE_KINDS.includes('configmap'), true);
  assert.equal(EDGE_KINDS.includes('depends_on'), true);
  assert.equal(INDICATOR_KINDS.includes('template_marker'), true);
  assert.equal(PROVIDER_CATEGORIES['DIM-deployment-v1'].join(','),
    'image,resource,service,template_indicator,topology_edge');
});

test('T213 extractArtifact dispatch rejects unknown kinds with typed errors', () => {
  assert.throws(() => extractArtifact('unknown', '', 'x.yaml'), /no deployment extractor/);
});
