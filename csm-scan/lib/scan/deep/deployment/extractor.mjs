// Deployment Topology static extractors.
//
// T213 owns this module. It implements conservative, literal-only static
// parsing for Dockerfile, Docker Compose, Kubernetes manifests, Helm templates,
// Terraform HCL, CloudFormation, and serverless configurations.
//
// Hard limits of the subset:
//   - Literal resources and direct references only.
//   - NEVER expand loops, macros, remote includes, template functions, or YAML
//     anchors/aliases. Dynamic constructs become template indicators or
//     unresolved stubs, never fabricated resources.
//   - Malformed documents become per-artifact diagnostics; valid peers (other
//     documents or artifacts) are preserved.
//   - Every topology edge cites a declaration; unresolved references are
//     recorded as stubs.
//   - Bounds are enforced per artifact through `DeploymentModelError`; when an
//     artifact exceeds a bound the whole artifact is discarded atomically.
//
// No Docker/Helm/Terraform/Kubernetes/cloud execution, no network, no remote
// lookup. ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import { parseYamlShallow } from "../../shared/parse.mjs";
import { DEPLOYMENT_LIMITS, DeploymentModelError, RESOURCE_KINDS, resourceId } from "./model.mjs";

const STAGE = "stage";

const CONTAINER_KINDS = new Set([
  "cronjob",
  "daemonset",
  "deployment",
  "job",
  "pod",
  "replicaset",
  "replication_controller",
  "statefulset",
]);

const K8S_KIND_ALIASES = Object.freeze({
  cluster_role: "cluster_role",
  cluster_role_binding: "cluster_role_binding",
  config_map: "configmap",
  cron_job: "cronjob",
  daemon_set: "daemonset",
  endpoints: "endpoints",
  horizontal_pod_autoscaler: "horizontal_pod_autoscaler",
  network_policy: "network_policy",
  persistent_volume: "persistent_volume",
  persistent_volume_claim: "pvc",
  replica_set: "replicaset",
  replication_controller: "replication_controller",
  role_binding: "role_binding",
  service_account: "service_account",
  stateful_set: "statefulset",
  storage_class: "storage_class",
});

const TF_KIND_MAP = Object.freeze({
  aws_acm_certificate: "certificate",
  aws_alb: "load_balancer",
  aws_alb_target_group: "target_group",
  aws_api_gateway_rest_api: "api",
  aws_apigatewayv2_api: "api",
  aws_apigatewayv2_stage: "gateway",
  aws_autoscaling_group: "cluster",
  aws_cloudfront_distribution: "gateway",
  aws_cloudwatch_event_rule: "trigger",
  aws_cloudwatch_event_target: "trigger",
  aws_cloudwatch_log_group: "log_group",
  aws_cloudwatch_metric_alarm: "policy",
  aws_db_instance: "database",
  aws_dynamodb_table: "table",
  aws_ec2_instance: "ec2_instance",
  aws_ecr_lifecycle_policy: "policy",
  aws_ecr_repository: "repository",
  aws_ecs_service: "service",
  aws_ecs_task_definition: "task",
  aws_efs_file_system: "storage",
  aws_eks_cluster: "cluster",
  aws_eks_node_group: "cluster",
  aws_eip: "vpc",
  aws_elasticache_cluster: "database",
  aws_iam_instance_profile: "role",
  aws_iam_policy: "policy",
  aws_iam_role: "role",
  aws_instance: "ec2_instance",
  aws_kms_key: "key",
  aws_lambda_event_source_mapping: "trigger",
  aws_lambda_function: "function",
  aws_lambda_permission: "policy",
  aws_lb: "load_balancer",
  aws_lb_target_group: "target_group",
  aws_rds_cluster: "database",
  aws_route53_record: "dns_record",
  aws_route53_zone: "hosted_zone",
  aws_s3_bucket: "bucket",
  aws_s3_bucket_notification: "trigger",
  aws_s3_bucket_policy: "policy",
  aws_s3_object: "bucket",
  aws_secretsmanager_secret: "secret",
  aws_security_group: "security_group",
  aws_sns_topic: "topic",
  aws_sns_topic_policy: "policy",
  aws_sqs_queue: "queue",
  aws_sqs_queue_policy: "policy",
  aws_ssm_parameter: "parameter",
  aws_subnet: "subnet",
  aws_vpc: "vpc",
});

const CF_KIND_MAP = Object.freeze({
  "AWS::ApiGateway::RestApi": "api",
  "AWS::ApiGatewayV2::Api": "api",
  "AWS::ApiGatewayV2::Stage": "gateway",
  "AWS::AppSync::GraphQLApi": "api",
  "AWS::CertificateManager::Certificate": "certificate",
  "AWS::CloudFront::Distribution": "gateway",
  "AWS::CloudWatch::Alarm": "policy",
  "AWS::DynamoDB::Table": "table",
  "AWS::EC2::Instance": "ec2_instance",
  "AWS::EC2::SecurityGroup": "security_group",
  "AWS::ECR::Repository": "repository",
  "AWS::ECS::Service": "service",
  "AWS::ECS::TaskDefinition": "task",
  "AWS::EKS::Cluster": "cluster",
  "AWS::ELB::LoadBalancer": "load_balancer",
  "AWS::ElasticLoadBalancingV2::LoadBalancer": "load_balancer",
  "AWS::ElasticLoadBalancingV2::TargetGroup": "target_group",
  "AWS::Events::Rule": "trigger",
  "AWS::IAM::Policy": "policy",
  "AWS::IAM::Role": "role",
  "AWS::KMS::Key": "key",
  "AWS::Lambda::EventSourceMapping": "trigger",
  "AWS::Lambda::Function": "function",
  "AWS::Lambda::Permission": "policy",
  "AWS::Logs::LogGroup": "log_group",
  "AWS::RDS::DBCluster": "database",
  "AWS::RDS::DBInstance": "database",
  "AWS::Route53::HostedZone": "hosted_zone",
  "AWS::Route53::RecordSet": "dns_record",
  "AWS::S3::Bucket": "bucket",
  "AWS::S3::BucketPolicy": "policy",
  "AWS::SecretsManager::Secret": "secret",
  "AWS::Serverless::Api": "api",
  "AWS::Serverless::Function": "function",
  "AWS::Serverless::HttpApi": "api",
  "AWS::Serverless::LayerVersion": "task",
  "AWS::Serverless::SimpleTable": "table",
  "AWS::Serverless::StateMachine": "task",
  "AWS::SNS::Subscription": "trigger",
  "AWS::SNS::Topic": "topic",
  "AWS::SQS::Queue": "queue",
  "AWS::SQS::QueuePolicy": "policy",
});

const INTRINSIC_TAGS = new Set([
  "And",
  "Base64",
  "Cidr",
  "Condition",
  "Equals",
  "FindInMap",
  "GetAZs",
  "If",
  "ImportValue",
  "Join",
  "Not",
  "Or",
  "Ref",
  "Select",
  "Split",
  "Sub",
  "Transform",
]);

function safeReason(error) {
  if (error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return "PARSE_UNSUPPORTED";
}

function lineCount(text) {
  return String(text).split(/\r?\n/).length;
}

function isInterpolated(value) {
  return (
    /\$\{/.test(value) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*/.test(value) ||
    /[^$]\$[A-Za-z_][A-Za-z0-9_]*/.test(value)
  );
}

function boundedToken(value, maximum = DEPLOYMENT_LIMITS.maxLabel) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[^\x20-\x7e]/.test(value)
  )
    return null;
  return value;
}

function looksLikeImage(value) {
  return (
    typeof value === "string" &&
    !isInterpolated(value) &&
    /[/:.]/.test(value) &&
    value.length <= DEPLOYMENT_LIMITS.maxLabel
  );
}

function basenameOf(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}

function stripYamlComment(line) {
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote !== null) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "#") {
      const prev = line[i - 1];
      if (prev === undefined || prev === " " || prev === "\t") return line.slice(0, i);
    }
  }
  return line;
}

function normalizeK8sKind(kind) {
  const snake = String(kind)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  const alias = K8S_KIND_ALIASES[snake] ?? snake;
  return RESOURCE_KINDS.includes(alias) ? alias : "cloud_resource";
}

function mappedKind(type) {
  return TF_KIND_MAP[type] ?? "cloud_resource";
}

function cfKind(type) {
  return CF_KIND_MAP[type] ?? "cloud_resource";
}

function splitDocuments(text) {
  const lines = String(text).split(/\r?\n/);
  const docs = [];
  let current = [];
  let startLine = 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (current.length > 0) docs.push({ text: current.join("\n"), start: startLine });
      current = [];
      startLine = i + 2;
      continue;
    }
    current.push(lines[i]);
  }
  if (current.length > 0) docs.push({ text: current.join("\n"), start: startLine });
  return docs;
}

class ExtractionContext {
  constructor(path, limits) {
    this.path = path;
    this.limits = limits;
    this.kind = "unsupported";
    this.status = "parsed";
    this.reason = null;
    this.lineCount = 0;
    this.resources = [];
    this.images = [];
    this.services = [];
    this.edges = [];
    this.stubs = [];
    this.indicators = [];
    this.diagnostics = [];
    this.declared = new Map();
  }

  cap(name, code) {
    const limitKeys = {
      diagnostics: "maxDiagnostics",
      edges: "maxEdges",
      images: "maxImages",
      indicators: "maxIndicators",
      resources: "maxResources",
      services: "maxServices",
      stubs: "maxStubs",
    };
    if (this[name].length >= this.limits[limitKeys[name]]) {
      throw new DeploymentModelError(code, `${name} exceeded the declared cap`);
    }
  }

  addResource(kind, label, line, attributes) {
    this.cap("resources", "RESOURCE_LIMIT");
    const id = resourceId(kind, label);
    if (this.declared.has(id)) return id;
    const record = {
      id,
      kind,
      label,
      path: this.path,
      line: line ?? null,
      attributes: attributes ?? null,
    };
    this.declared.set(id, record);
    this.resources.push(record);
    return id;
  }

  addImage(reference, line, scope) {
    this.cap("images", "IMAGE_LIMIT");
    this.images.push({
      reference,
      scope,
      path: this.path,
      line: line ?? null,
    });
  }

  addService(kind, label, line, image, attributes) {
    this.cap("services", "SERVICE_LIMIT");
    const id = resourceId(kind, label);
    if (!this.declared.has(id)) {
      this.declared.set(id, { id, kind, label, path: this.path });
    }
    this.services.push({
      id,
      kind,
      label,
      image: image ?? null,
      path: this.path,
      line: line ?? null,
      attributes: attributes ?? null,
    });
    return id;
  }

  addEdge(from, to, kind, line) {
    if (!this.declared.has(from) || !this.declared.has(to)) {
      throw new DeploymentModelError(
        "UNCITED_EDGE",
        "topology edges must cite declared resources or services",
      );
    }
    this.cap("edges", "EDGE_LIMIT");
    this.edges.push({
      from,
      to,
      kind,
      path: this.path,
      line: line ?? null,
      crossArtifact: false,
    });
  }

  addStub(kind, label, from, source, line) {
    this.cap("stubs", "STUB_LIMIT");
    this.stubs.push({
      kind,
      label,
      from: from ?? null,
      source,
      path: this.path,
      line: line ?? null,
    });
  }

  addIndicator(kind, line) {
    this.cap("indicators", "INDICATOR_LIMIT");
    this.indicators.push({ kind, path: this.path, line: line ?? null });
  }

  addDiagnostic(doc, status, reason) {
    this.cap("diagnostics", "DIAGNOSTIC_LIMIT");
    this.diagnostics.push({ path: this.path, status, reason, doc: doc ?? null });
  }

  resolve(kind, label, from, source, line) {
    const id = resourceId(kind, label);
    if (from !== null && this.declared.has(id) && this.declared.has(from)) {
      this.addEdge(from, id, source, line);
    } else {
      this.addStub(kind, label, from, source, line);
    }
  }

  resolveByLabel(label, from, source, line) {
    const matches = [...this.declared.values()].filter((record) => record.label === label);
    if (matches.length === 1 && from !== null && this.declared.has(from)) {
      this.addEdge(from, matches[0].id, source, line);
    } else {
      this.addStub("cloud_resource", label, from, source, line);
    }
  }

  labelResolved(label) {
    const matches = [...this.declared.values()].filter((record) => record.label === label);
    return matches.length === 1 ? matches[0].id : null;
  }

  finalize() {
    const remaining = [];
    for (const stub of this.stubs) {
      const exactId = resourceId(stub.kind, stub.label);
      const resolved =
        stub.kind === "cloud_resource"
          ? this.labelResolved(stub.label)
          : this.declared.has(exactId)
            ? exactId
            : null;
      if (stub.from !== null && this.declared.has(stub.from) && resolved !== null) {
        this.addEdge(stub.from, resolved, stub.source, stub.line);
      } else {
        remaining.push(stub);
      }
    }
    this.stubs = remaining;
    return {
      path: this.path,
      kind: this.kind,
      status: this.status,
      reason: this.reason,
      lineCount: this.lineCount,
      resources: this.resources,
      images: this.images,
      services: this.services,
      edges: this.edges,
      stubs: this.stubs,
      indicators: this.indicators,
      diagnostics: this.diagnostics,
    };
  }
}

// ---------------------------------------------------------------------------
// Dockerfile
// ---------------------------------------------------------------------------

function parseFrom(trimmed) {
  const match = trimmed.match(/^FROM\s+(.+)$/i);
  if (!match) return null;
  let rest = match[1].trim();
  let alias = null;
  const asMatch = rest.match(/\s+AS\s+([A-Za-z0-9_.-]+)$/i);
  if (asMatch) {
    alias = asMatch[1];
    rest = rest.slice(0, asMatch.index).trim();
  }
  const platform = rest.match(/^--platform(?:=[^\s]+|\s+[^\s]+)/i);
  if (platform) rest = rest.slice(platform[0].length).trim();
  if (rest === "") return { reference: null, alias };
  if (isInterpolated(rest)) return { reference: null, alias };
  return { reference: rest, alias };
}

function extractDockerfile(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "dockerfile";
  ctx.status = "parsed";
  const lines = String(text).split(/\r?\n/);
  ctx.lineCount = lines.length;
  const declaredStages = new Set();
  let currentStage = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    const from = parseFrom(trimmed);
    if (from !== null) {
      if (from.reference === null) {
        ctx.addIndicator("interpolation", i + 1);
        if (from.alias !== null) declaredStages.add(from.alias);
        currentStage = from.alias !== null ? resourceId(STAGE, from.alias) : null;
        continue;
      }
      if (declaredStages.has(from.reference)) {
        if (from.alias !== null && from.alias !== from.reference) {
          declaredStages.add(from.alias);
          ctx.addResource(STAGE, from.alias, i + 1, { baseImage: from.reference });
          ctx.resolve(STAGE, from.reference, resourceId(STAGE, from.alias), "build_from", i + 1);
          currentStage = resourceId(STAGE, from.alias);
        } else {
          currentStage = resourceId(STAGE, from.reference);
        }
        continue;
      }
      ctx.addImage(from.reference, i + 1, "from");
      if (from.alias !== null) {
        declaredStages.add(from.alias);
        ctx.addResource(STAGE, from.alias, i + 1, { baseImage: from.reference });
        currentStage = resourceId(STAGE, from.alias);
      } else {
        currentStage = resourceId(STAGE, from.reference);
      }
      continue;
    }
    const copy = trimmed.match(/^COPY\s+--from=([^\s]+)/i);
    if (copy) {
      const source = copy[1];
      if (declaredStages.has(source)) {
        ctx.resolve(STAGE, source, currentStage, "copy_from", i + 1);
      } else if (isInterpolated(source)) {
        ctx.addIndicator("interpolation", i + 1);
      } else if (looksLikeImage(source)) {
        ctx.addImage(source, i + 1, "from");
      } else {
        ctx.addStub(STAGE, source, currentStage, "copy_from", i + 1);
      }
      continue;
    }
    if (/^(?:ARG|ENV)\s/i.test(trimmed) && isInterpolated(trimmed)) {
      ctx.addIndicator("interpolation", i + 1);
    }
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Docker Compose
// ---------------------------------------------------------------------------

function portValue(port) {
  if (typeof port === "string" && port.length <= 64 && !/[^\x20-\x7e]/.test(port)) return port;
  if (port !== null && typeof port === "object" && !Array.isArray(port)) {
    const published = port.published;
    const target = port.target;
    const value = published !== undefined && published !== null ? String(published) : null;
    if (value !== null && /^[0-9]+$/.test(value)) return value;
    if (target !== undefined && target !== null) return String(target);
  }
  if (typeof port === "number") return String(port);
  return null;
}

function safeBuildContext(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  if (
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith("../") ||
    value.includes("\\")
  )
    return null;
  return value;
}

function extractCompose(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "compose";
  ctx.status = "parsed";
  ctx.lineCount = lineCount(text);
  let doc;
  try {
    doc = parseYamlShallow(text);
  } catch (error) {
    ctx.status = "malformed";
    ctx.reason = safeReason(error);
    ctx.addDiagnostic(null, "malformed", safeReason(error));
    return ctx.finalize();
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    ctx.status = "unsupported";
    ctx.reason = "NO_COMPOSE";
    return ctx.finalize();
  }
  const services = typeof doc === "object" && !Array.isArray(doc) ? doc.services : null;
  if (services && typeof services === "object" && !Array.isArray(services)) {
    for (const [name, service] of Object.entries(services)) {
      if (!service || typeof service !== "object" || Array.isArray(service)) continue;
      if (boundedToken(name) === null) continue;
      let image = null;
      if (typeof service.image === "string") {
        if (isInterpolated(service.image)) {
          ctx.addIndicator("interpolation", null);
        } else if (boundedToken(service.image) !== null) {
          image = service.image;
          ctx.addImage(image, null, "image");
        }
      }
      const attributes = {};
      if (Array.isArray(service.ports)) {
        const ports = service.ports
          .map(portValue)
          .filter((value) => value !== null)
          .slice(0, 8);
        if (ports.length > 0) attributes.ports = ports;
      }
      const buildContext = safeBuildContext(
        typeof service.build === "string" ? service.build : service.build?.context,
      );
      if (buildContext !== null) attributes.build = buildContext;
      if (Object.keys(attributes).length === 0) {
        ctx.addService("service", name, null, image, null);
      } else {
        ctx.addService("service", name, null, image, attributes);
      }
      const dependsOn = Array.isArray(service.depends_on)
        ? service.depends_on.map((entry) => (typeof entry === "string" ? entry : entry?.service))
        : typeof service.depends_on === "object" && !Array.isArray(service.depends_on)
          ? Object.keys(service.depends_on)
          : [];
      for (const dependency of dependsOn) {
        if (boundedToken(dependency) !== null) {
          ctx.resolve("service", dependency, resourceId("service", name), "depends_on", null);
        }
      }
      const networks = Array.isArray(service.networks)
        ? service.networks
        : typeof service.networks === "object" && !Array.isArray(service.networks)
          ? Object.keys(service.networks)
          : [];
      for (const network of networks) {
        if (boundedToken(network) !== null) {
          ctx.resolve("network", network, resourceId("service", name), "network", null);
        }
      }
      if (Array.isArray(service.volumes)) {
        for (const entry of service.volumes) {
          let source = null;
          if (typeof entry === "string") {
            const colon = entry.indexOf(":");
            source = colon === -1 ? entry : entry.slice(0, colon);
          } else if (
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.source === "string"
          ) {
            source = entry.source;
          }
          if (
            source !== null &&
            boundedToken(source) !== null &&
            !source.startsWith("/") &&
            !source.startsWith("~") &&
            !source.startsWith(".")
          ) {
            ctx.resolve("volume", source, resourceId("service", name), "volume", null);
          }
        }
      }
    }
  }
  for (const [kind, key] of [
    ["network", "networks"],
    ["volume", "volumes"],
    ["configmap", "configs"],
    ["secret", "secrets"],
  ]) {
    const section = typeof doc === "object" ? doc[key] : null;
    if (section && typeof section === "object" && !Array.isArray(section)) {
      for (const name of Object.keys(section)) {
        if (boundedToken(name) !== null) ctx.addResource(kind, name, null, null);
      }
    }
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Kubernetes manifests
// ---------------------------------------------------------------------------

function k8sContainerRefs(ctx, resourceIdOf, container, docIndex) {
  if (Array.isArray(container.envFrom)) {
    for (const entry of container.envFrom) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (typeof entry.configMapRef?.name === "string") {
        ctx.resolve("configmap", entry.configMapRef.name, resourceIdOf, "env_from", docIndex);
      }
      if (typeof entry.secretRef?.name === "string") {
        ctx.resolve("secret", entry.secretRef.name, resourceIdOf, "env_from", docIndex);
      }
    }
  }
  if (Array.isArray(container.env)) {
    for (const entry of container.env) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (typeof entry.valueFrom?.configMapKeyRef?.name === "string") {
        ctx.resolve(
          "configmap",
          entry.valueFrom.configMapKeyRef.name,
          resourceIdOf,
          "value_from",
          docIndex,
        );
      }
      if (typeof entry.valueFrom?.secretKeyRef?.name === "string") {
        ctx.resolve(
          "secret",
          entry.valueFrom.secretKeyRef.name,
          resourceIdOf,
          "value_from",
          docIndex,
        );
      }
    }
  }
}

function k8sVolumes(ctx, resourceIdOf, spec, docIndex) {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.volumes)) return;
  for (const volume of spec.volumes) {
    if (!volume || typeof volume !== "object" || Array.isArray(volume)) continue;
    if (typeof volume.configMap?.name === "string") {
      ctx.resolve("configmap", volume.configMap.name, resourceIdOf, "volume_from", docIndex);
    }
    if (typeof volume.secret?.secretName === "string") {
      ctx.resolve("secret", volume.secret.secretName, resourceIdOf, "volume_from", docIndex);
    }
    if (typeof volume.persistentVolumeClaim?.claimName === "string") {
      ctx.resolve(
        "pvc",
        volume.persistentVolumeClaim.claimName,
        resourceIdOf,
        "volume_from",
        docIndex,
      );
    }
  }
}

function handleContainer(ctx, container, resourceLabel, docIndex) {
  if (
    typeof container.name !== "string" ||
    container.name === "" ||
    boundedToken(container.name) === null
  )
    return;
  let image = null;
  if (
    typeof container.image === "string" &&
    !isInterpolated(container.image) &&
    boundedToken(container.image) !== null
  ) {
    image = container.image;
    ctx.addImage(image, docIndex, "container");
  } else if (typeof container.image === "string") {
    ctx.addIndicator("interpolation", docIndex);
  }
  const attributes = {};
  if (Array.isArray(container.ports)) {
    const ports = container.ports
      .filter((port) => port && typeof port === "object" && Number.isInteger(port.containerPort))
      .map((port) => String(port.containerPort))
      .slice(0, 8);
    if (ports.length > 0) attributes.ports = ports;
  }
  const label = `${resourceLabel}:${container.name}`;
  if (Object.keys(attributes).length > 0) {
    ctx.addService("container", label, docIndex, image, attributes);
  } else {
    ctx.addService("container", label, docIndex, image, null);
  }
}

function handleK8sEntry(ctx, entry, docIndex) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  if (typeof entry.kind !== "string" || entry.kind === "" || entry.metadata?.name === undefined)
    return;
  const label = boundedToken(String(entry.metadata.name));
  if (label === null) return;
  const kind = normalizeK8sKind(entry.kind);
  const attributes = {};
  if (typeof entry.apiVersion === "string" && boundedToken(entry.apiVersion) !== null) {
    attributes.apiVersion = entry.apiVersion;
  }
  if (
    typeof entry.metadata?.namespace === "string" &&
    boundedToken(entry.metadata.namespace) !== null
  ) {
    attributes.namespace = entry.metadata.namespace;
  }
  const id = ctx.addResource(
    kind,
    label,
    docIndex,
    Object.keys(attributes).length > 0 ? attributes : null,
  );

  let templateSpec = entry.spec;
  if (entry.spec && typeof entry.spec === "object" && !Array.isArray(entry.spec)) {
    templateSpec =
      entry.spec.template?.spec ?? entry.spec.jobTemplate?.spec?.template?.spec ?? entry.spec;
  }
  if (CONTAINER_KINDS.has(kind) && templateSpec && typeof templateSpec === "object") {
    for (const container of Array.isArray(templateSpec.containers) ? templateSpec.containers : []) {
      handleContainer(ctx, container, label, docIndex);
      k8sContainerRefs(ctx, id, container, docIndex);
    }
    k8sVolumes(ctx, id, templateSpec, docIndex);
  }

  if (
    kind === "service" &&
    entry.spec &&
    typeof entry.spec === "object" &&
    !Array.isArray(entry.spec)
  ) {
    if (
      entry.spec.selector &&
      typeof entry.spec.selector === "object" &&
      !Array.isArray(entry.spec.selector)
    ) {
      const selectors = Object.entries(entry.spec.selector)
        .filter(
          ([key, value]) => boundedToken(key) !== null && boundedToken(String(value)) !== null,
        )
        .map(([key, value]) => `${key}:${value}`)
        .slice(0, 8);
      if (selectors.length > 0) {
        const record = ctx.resources.find((candidate) => candidate.id === id);
        if (record) record.attributes = { ...record.attributes, selector: selectors };
      }
    }
  }

  if (
    kind === "ingress" &&
    entry.spec &&
    typeof entry.spec === "object" &&
    !Array.isArray(entry.spec) &&
    Array.isArray(entry.spec.rules)
  ) {
    for (const rule of entry.spec.rules) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
      const paths = rule.http?.paths;
      if (!Array.isArray(paths)) continue;
      for (const item of paths) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        if (typeof item.backend?.service?.name === "string") {
          ctx.resolve("service", item.backend.service.name, id, "backend", docIndex);
        }
      }
    }
  }
}

function extractKubernetes(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "kubernetes";
  ctx.status = "parsed";
  ctx.lineCount = lineCount(text);
  const docs = splitDocuments(text);
  let recognized = 0;
  let failed = 0;
  for (let index = 0; index < docs.length; index++) {
    let doc;
    try {
      doc = parseYamlShallow(docs[index].text);
    } catch (error) {
      failed++;
      ctx.addDiagnostic(index + 1, "malformed", safeReason(error));
      continue;
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) continue;
    if (doc.kind === "List" && Array.isArray(doc.items)) {
      for (const item of doc.items) handleK8sEntry(ctx, item, docs[index].start);
      recognized++;
      continue;
    }
    if (typeof doc.kind !== "string" && doc.apiVersion === undefined) continue;
    handleK8sEntry(ctx, doc, docs[index].start);
    recognized++;
  }
  if (recognized === 0 && failed > 0) {
    ctx.status = "malformed";
    ctx.reason = "NO_VALID_DOCUMENTS";
  } else if (recognized === 0) {
    ctx.status = "unsupported";
    ctx.reason = "NO_KUBERNETES";
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Helm chart metadata and templates
// ---------------------------------------------------------------------------

function extractHelmChart(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "helm_chart";
  ctx.status = "parsed";
  ctx.lineCount = lineCount(text);
  let doc;
  try {
    doc = parseYamlShallow(text);
  } catch (error) {
    ctx.status = "malformed";
    ctx.reason = safeReason(error);
    ctx.addDiagnostic(null, "malformed", safeReason(error));
    return ctx.finalize();
  }
  if (
    doc &&
    typeof doc === "object" &&
    !Array.isArray(doc) &&
    typeof doc.name === "string" &&
    boundedToken(doc.name) !== null
  ) {
    const attributes = {};
    if (typeof doc.version === "string" && boundedToken(doc.version) !== null) {
      attributes.version = doc.version;
    }
    ctx.addResource(
      "chart",
      doc.name,
      null,
      Object.keys(attributes).length > 0 ? attributes : null,
    );
  }
  return ctx.finalize();
}

function extractHelmTemplate(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "helm_template";
  ctx.status = "parsed";
  const lines = String(text).split(/\r?\n/);
  ctx.lineCount = lines.length;
  let pendingKind = null;
  let inMetadata = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("{{") || line.includes("}}")) {
      ctx.addIndicator("template_marker", i + 1);
      pendingKind = null;
      inMetadata = false;
      continue;
    }
    const stripped = stripYamlComment(line).trim();
    if (stripped === "") continue;
    const kindMatch = stripped.match(/^kind:\s*([A-Za-z0-9_-]+)\s*$/);
    if (kindMatch) {
      pendingKind = kindMatch[1];
      inMetadata = false;
      continue;
    }
    if (/^metadata:\s*$/.test(stripped)) {
      inMetadata = true;
      continue;
    }
    if (inMetadata) {
      const nameMatch = stripped.match(/^name:\s*([^\s]+)\s*$/);
      if (nameMatch && pendingKind !== null && boundedToken(nameMatch[1]) !== null) {
        const kind = normalizeK8sKind(pendingKind);
        if (kind !== "cloud_resource") {
          ctx.addResource(kind, nameMatch[1], i + 1, null);
        } else {
          ctx.addIndicator("interpolation", i + 1);
        }
        pendingKind = null;
        inMetadata = false;
        continue;
      }
    }
    const imageMatch = stripped.match(/^image:\s*([^\s]+)\s*$/);
    if (imageMatch && boundedToken(imageMatch[1]) !== null && looksLikeImage(imageMatch[1])) {
      ctx.addImage(imageMatch[1], i + 1, "value");
      continue;
    }
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Terraform HCL (bounded literal subset)
// ---------------------------------------------------------------------------

function stripHclComments(text) {
  const lines = [];
  let current = "";
  let inString = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      if (ch === '"') inString = false;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "\n") {
      lines.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    current += ch;
    i++;
  }
  lines.push(current);
  return lines;
}

function bracketDepth(value) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      inString = !inString;
    } else if (!inString && (ch === "{" || ch === "[")) {
      depth++;
    } else if (!inString && (ch === "}" || ch === "]")) {
      depth--;
    }
  }
  return depth;
}

function tfReference(expression) {
  const expr = expression.trim();
  let match;
  if ((match = expr.match(/^var\.([A-Za-z_][\w-]*)$/)) !== null) {
    return { kind: "variable", label: match[1] };
  }
  if ((match = expr.match(/^local\.([A-Za-z_][\w-]*)$/)) !== null) {
    return { kind: "local", label: match[1] };
  }
  if ((match = expr.match(/^data\.([A-Za-z_][\w-]*)\.([A-Za-z0-9_-]+)/)) !== null) {
    return { kind: "data_source", label: match[2] };
  }
  if ((match = expr.match(/^([a-z][\w-]*\.)([A-Za-z0-9_-]+)\./)) !== null) {
    const type = match[1].slice(0, -1);
    return { kind: mappedKind(type), label: match[2] };
  }
  return null;
}

function classifyTfValue(ctx, block, value, line) {
  if (block.id === null) return;
  for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
    const inner = match[1].trim();
    if (/^module\.([A-Za-z_][\w-]*)\./.test(inner)) {
      ctx.addStub("output", inner.split(".")[1] ?? inner, block.id, "output", line);
      continue;
    }
    const reference = tfReference(inner);
    if (reference !== null) {
      ctx.resolve(reference.kind, reference.label, block.id, "reference", line);
    } else {
      ctx.addIndicator(/\b\w+\(/.test(inner) ? "template_function" : "interpolation", line);
    }
  }
  let candidate = value.trim();
  const quoted = candidate.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (quoted !== null) candidate = quoted[1];
  if (!candidate.includes("${") && !candidate.includes("\n")) {
    const moduleMatch = candidate.match(/^module\.([A-Za-z_][\w-]*)\./);
    if (moduleMatch !== null) {
      ctx.addStub("output", moduleMatch[1], block.id, "output", line);
    } else {
      const reference = tfReference(candidate);
      if (reference !== null) {
        ctx.resolve(reference.kind, reference.label, block.id, "reference", line);
      } else if (/^[A-Za-z_][\w-]*\s*\(/.test(candidate)) {
        ctx.addIndicator("template_function", line);
      }
    }
  }
  if (/^<<-?/.test(value.trim())) {
    ctx.addIndicator("heredoc", line);
  }
}

function handleTfAttribute(ctx, block, name, valueStart, idx, lines) {
  if (name === "for_each") {
    ctx.addIndicator("for_each", idx + 1);
    return idx;
  }
  if (name === "count") {
    ctx.addIndicator("count", idx + 1);
    return idx;
  }
  if (name === "depends_on") {
    for (const match of valueStart.matchAll(/(?:^|[\s,[])([a-z][\w-]*)\.([A-Za-z0-9_-]+)/g)) {
      if (block.id !== null)
        ctx.resolve(mappedKind(match[1]), match[2], block.id, "reference", idx + 1);
    }
    for (const match of valueStart.matchAll(/module\.([A-Za-z_][\w-]*)/g)) {
      if (block.id !== null) ctx.resolve("module", match[1], block.id, "reference", idx + 1);
    }
    return idx;
  }
  let value = valueStart;
  let depth = bracketDepth(valueStart);
  let cursor = idx;
  if (depth > 0) {
    for (let j = idx + 1; j < lines.length; j++) {
      value += "\n" + lines[j];
      depth += bracketDepth(lines[j]);
      if (depth <= 0) {
        cursor = j;
        break;
      }
      if (j - idx > 64) {
        ctx.addIndicator("heredoc", idx + 1);
        cursor = j;
        break;
      }
    }
  }
  if (block.type === "locals" && /^[A-Za-z_][\w-]*$/.test(name)) {
    ctx.addResource("local", name, idx + 1, null);
  }
  if (
    (block.type === "resource" || block.type === "data") &&
    (name === "image" || name === "image_uri" || name === "ami")
  ) {
    const literal = value.trim().match(/^"((?:[^"\\]|\\.)*)"$/);
    if (literal !== null && !isInterpolated(literal[1]) && looksLikeImage(literal[1])) {
      ctx.addImage(literal[1], idx + 1, "value");
      return idx;
    }
  }
  if (block.type === "module" && name === "source") {
    const literal = value.trim().match(/^"((?:[^"\\]|\\.)*)"$/);
    if (literal !== null && /^[A-Za-z0-9._/-]+$/.test(literal[1]) && block.record !== null) {
      block.record.attributes = { ...block.record.attributes, source: literal[1] };
    }
  }
  if (block.type === "terraform" && name === "required_version" && block.record !== null) {
    const literal = value.trim().match(/^"((?:[^"\\]|\\.)*)"$/);
    if (literal !== null) {
      block.record.attributes = { ...block.record.attributes, requiredVersion: literal[1] };
    }
  }
  classifyTfValue(ctx, block, value, idx + 1);
  return cursor;
}

function pushTfBlock(ctx, stack, type, l1, l2, line) {
  let id = null;
  let record = null;
  const recordOf = () => ctx.resources.find((candidate) => candidate.id === id) ?? null;
  if (type === "resource" && l1 !== null && l2 !== null && boundedToken(l2) !== null) {
    id = ctx.addResource(mappedKind(l1), l2, line, { type: l1 });
    record = recordOf();
  } else if (type === "data" && l1 !== null && l2 !== null && boundedToken(l2) !== null) {
    id = ctx.addResource("data_source", l2, line, { type: l1 });
    record = recordOf();
  } else if (type === "variable" && l1 !== null && boundedToken(l1) !== null) {
    id = ctx.addResource("variable", l1, line, null);
    record = recordOf();
  } else if (type === "module" && l1 !== null && boundedToken(l1) !== null) {
    id = ctx.addResource("module", l1, line, null);
    record = recordOf();
  } else if (type === "output" && l1 !== null && boundedToken(l1) !== null) {
    id = ctx.addResource("output", l1, line, null);
    record = recordOf();
  } else if (type === "provider") {
    const label = l1 !== null && boundedToken(l1) !== null ? l1 : "default";
    id = ctx.addResource("provider", label, line, null);
    record = recordOf();
  } else if (type === "locals") {
    const label = l1 !== null && boundedToken(l1) !== null ? l1 : "default";
    id = ctx.addResource("local", label, line, null);
    record = recordOf();
  } else if (type === "terraform") {
    id = ctx.addResource("terraform", "root", line, null);
    record = recordOf();
  }
  stack.push({ type, label1: l1, label2: l2, line, id, record });
}

function extractTerraform(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "terraform";
  ctx.status = "parsed";
  const lines = stripHclComments(String(text));
  ctx.lineCount = lines.length;
  const stack = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim();
    if (trimmed === "") continue;
    if (trimmed === "}") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    const header = trimmed.match(/^([A-Za-z][\w-]*)(?:\s+"([^"]+)")?(?:\s+"([^"]+)")?\s*\{$/);
    if (header && !header[0].includes("${")) {
      pushTfBlock(ctx, stack, header[1], header[2] ?? null, header[3] ?? null, idx + 1);
      continue;
    }
    const dynamic = trimmed.match(/^dynamic\s+"([^"]+)"\s*\{$/);
    if (dynamic) {
      ctx.addIndicator("dynamic", idx + 1);
      stack.push({
        type: "dynamic",
        label1: dynamic[1],
        label2: null,
        line: idx + 1,
        id: null,
        record: null,
      });
      continue;
    }
    const attr = trimmed.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/);
    if (attr && stack.length > 0) {
      idx = handleTfAttribute(ctx, stack[stack.length - 1], attr[1], attr[2], idx, lines);
      continue;
    }
    if (trimmed.includes("${") && /[{(]$/.test(trimmed)) {
      ctx.addIndicator("interpolation", idx + 1);
      stack.push({
        type: "opaque",
        label1: null,
        label2: null,
        line: idx + 1,
        id: null,
        record: null,
      });
      continue;
    }
    const nested = trimmed.match(/^([A-Za-z][\w-]*)(?:\s+"([^"]+)")?\s*\{$/);
    if (nested && stack.length > 0) {
      stack.push({
        type: "nested",
        label1: nested[2] ?? null,
        label2: null,
        line: idx + 1,
        id: null,
        record: null,
      });
      continue;
    }
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// CloudFormation (literal resources + safe intrinsic subset)
// ---------------------------------------------------------------------------

function handleCfRef(ctx, target, fromId) {
  if (typeof target !== "string" || target === "") return;
  if (target.startsWith("AWS::")) {
    ctx.addIndicator("pseudo_parameter", null);
    return;
  }
  ctx.resolveByLabel(target, fromId, "reference", null);
}

function handleCfGetAtt(ctx, value, fromId) {
  const target = Array.isArray(value) ? value[0] : String(value).split(".")[0];
  if (typeof target === "string" && target !== "") handleCfRef(ctx, target, fromId);
}

function handleCfSub(ctx, value, fromId) {
  const template = Array.isArray(value) ? value[0] : value;
  if (typeof template !== "string") {
    ctx.addIndicator("intrinsic", null);
    return;
  }
  for (const match of template.matchAll(/\$\{([^}]+)\}/g)) {
    const inner = match[1];
    if (inner.startsWith("!") || inner.includes("!")) {
      ctx.addIndicator("intrinsic", null);
      continue;
    }
    const target = inner.split(".")[0];
    if (target !== "") handleCfRef(ctx, target, fromId);
  }
}

function handleYamlTag(ctx, value, fromId) {
  const match = String(value).match(/^!([A-Za-z]+)\s+(.+)$/);
  if (!match) return;
  const tag = match[1];
  const rest = match[2].trim();
  if (tag === "Ref") handleCfRef(ctx, rest, fromId);
  else if (tag === "GetAtt") handleCfGetAtt(ctx, rest, fromId);
  else if (tag === "Sub") handleCfSub(ctx, rest, fromId);
  else if (tag === "ImportValue") ctx.addStub("output", rest, fromId, "export", null);
  else if (INTRINSIC_TAGS.has(tag)) ctx.addIndicator("intrinsic", null);
}

function walkCf(ctx, node, fromId) {
  if (Array.isArray(node)) {
    for (const item of node) walkCf(ctx, item, fromId);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "Ref") {
      handleCfRef(ctx, value, fromId);
      continue;
    }
    if (key === "Fn::GetAtt") {
      handleCfGetAtt(ctx, value, fromId);
      continue;
    }
    if (key === "Fn::Sub") {
      handleCfSub(ctx, value, fromId);
      continue;
    }
    if (key === "Fn::ImportValue") {
      if (typeof value === "string") ctx.addStub("output", value, fromId, "export", null);
      continue;
    }
    if (
      key === "Condition" ||
      (key.startsWith("Fn::") && !["Fn::GetAtt", "Fn::Sub"].includes(key))
    ) {
      ctx.addIndicator("intrinsic", null);
      walkCf(ctx, value, fromId);
      continue;
    }
    if (typeof value === "string" && value.startsWith("!")) {
      handleYamlTag(ctx, value, fromId);
      continue;
    }
    walkCf(ctx, value, fromId);
  }
}

function cfResourcesInto(ctx, resources) {
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) return;
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) continue;
    if (typeof resource.Type !== "string" || resource.Type === "") continue;
    const id = ctx.addResource(cfKind(resource.Type), logicalId, null, { type: resource.Type });
    walkCf(ctx, resource, id);
  }
}

function extractCloudFormation(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "cloudformation";
  ctx.status = "parsed";
  ctx.lineCount = lineCount(text);
  let doc;
  try {
    doc = /\.json$/i.test(path) ? JSON.parse(text) : parseYamlShallow(text);
  } catch (error) {
    ctx.status = "malformed";
    ctx.reason = safeReason(error);
    ctx.addDiagnostic(null, "malformed", safeReason(error));
    return ctx.finalize();
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    ctx.status = "unsupported";
    ctx.reason = "NO_TEMPLATE";
    return ctx.finalize();
  }
  if (doc.Transform !== undefined) ctx.addIndicator("transform", null);
  if (doc.Parameters && typeof doc.Parameters === "object" && !Array.isArray(doc.Parameters)) {
    for (const [name, definition] of Object.entries(doc.Parameters)) {
      const attributes = {};
      if (definition && typeof definition === "object" && typeof definition.Type === "string") {
        attributes.type = definition.Type;
      }
      ctx.addResource(
        "parameter",
        name,
        null,
        Object.keys(attributes).length > 0 ? attributes : null,
      );
    }
  }
  if (doc.Outputs && typeof doc.Outputs === "object" && !Array.isArray(doc.Outputs)) {
    for (const [name, definition] of Object.entries(doc.Outputs)) {
      const id = ctx.addResource("output", name, null, null);
      if (definition && typeof definition === "object" && !Array.isArray(definition)) {
        walkCf(ctx, definition, id);
      }
    }
  }
  if (doc.Conditions && typeof doc.Conditions === "object" && !Array.isArray(doc.Conditions)) {
    const conditionCount = Object.keys(doc.Conditions).length;
    for (let conditionIndex = 0; conditionIndex < conditionCount; conditionIndex++) {
      ctx.addIndicator("intrinsic", null);
    }
  }
  cfResourcesInto(ctx, doc.Resources);
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Serverless Framework configs
// ---------------------------------------------------------------------------

function serverlessVariables(ctx, text) {
  for (const match of String(text).matchAll(/\$\{([^}]+)\}/g)) {
    const inner = match[1].trim();
    const prefix = inner.split(":")[0];
    if (
      prefix === "env" ||
      prefix === "opt" ||
      prefix === "ssm" ||
      prefix === "cf" ||
      prefix === "s3"
    ) {
      const label = inner.slice(0, 64);
      if (boundedToken(label) !== null)
        ctx.addStub("cloud_resource", label, null, "resolver", null);
    } else if (prefix === "self" || prefix === "param") {
      ctx.addIndicator("resolver", null);
    } else if (prefix === "file") {
      ctx.addIndicator("remote_module", null);
    } else {
      ctx.addIndicator("interpolation", null);
    }
  }
}

function extractServerless(text, path) {
  const ctx = new ExtractionContext(path, DEPLOYMENT_LIMITS);
  ctx.kind = "serverless";
  ctx.status = "parsed";
  ctx.lineCount = lineCount(text);
  let doc;
  try {
    doc = parseYamlShallow(text);
  } catch (error) {
    ctx.status = "malformed";
    ctx.reason = safeReason(error);
    ctx.addDiagnostic(null, "malformed", safeReason(error));
    return ctx.finalize();
  }
  serverlessVariables(ctx, text);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    ctx.status = "unsupported";
    ctx.reason = "NO_SERVERLESS";
    return ctx.finalize();
  }
  if (typeof doc.service === "string" && boundedToken(doc.service) !== null) {
    ctx.addResource("service", doc.service, null, null);
  }
  if (doc.provider && typeof doc.provider === "object" && !Array.isArray(doc.provider)) {
    const attributes = {};
    if (typeof doc.provider.name === "string" && boundedToken(doc.provider.name) !== null) {
      attributes.platform = doc.provider.name;
    }
    if (typeof doc.provider.runtime === "string" && boundedToken(doc.provider.runtime) !== null) {
      attributes.runtime = doc.provider.runtime;
    }
    const providerName = doc.provider.name ?? "default";
    ctx.addResource(
      "provider",
      boundedToken(providerName) !== null ? providerName : "default",
      null,
      Object.keys(attributes).length > 0 ? attributes : null,
    );
  }
  if (doc.functions && typeof doc.functions === "object" && !Array.isArray(doc.functions)) {
    for (const [functionName, fn] of Object.entries(doc.functions)) {
      if (!fn || typeof fn !== "object" || Array.isArray(fn)) continue;
      if (boundedToken(functionName) === null) continue;
      let image = null;
      if (typeof fn.image === "string") {
        if (isInterpolated(fn.image)) {
          ctx.addIndicator("interpolation", null);
        } else if (boundedToken(fn.image) !== null) {
          image = fn.image;
          ctx.addImage(image, null, "image");
        }
      }
      const attributes = {};
      if (typeof fn.handler === "string" && boundedToken(fn.handler) !== null) {
        attributes.handler = fn.handler;
      }
      if (typeof fn.runtime === "string" && boundedToken(fn.runtime) !== null) {
        attributes.runtime = fn.runtime;
      }
      if (Array.isArray(fn.events) && fn.events.length > 0) {
        const events = fn.events
          .map((event) => {
            if (!event || typeof event !== "object" || Array.isArray(event)) return null;
            const keys = Object.keys(event);
            return keys.length > 0 ? keys[0] : null;
          })
          .filter((value) => value !== null)
          .slice(0, 8);
        if (events.length > 0) attributes.events = events;
      }
      ctx.addService(
        "function",
        functionName,
        null,
        image,
        Object.keys(attributes).length > 0 ? attributes : null,
      );
      ctx.addResource("function", functionName, null, null);
    }
  }
  if (doc.resources && typeof doc.resources === "object" && !Array.isArray(doc.resources)) {
    cfResourcesInto(ctx, doc.resources.Resources);
  }
  return ctx.finalize();
}

// ---------------------------------------------------------------------------
// Kind detection and dispatch
// ---------------------------------------------------------------------------

const DEPLOYMENT_DIRS = new Set([
  "cloudformation",
  "cfn",
  "charts",
  "deploy",
  "deployment",
  "helm",
  "iac",
  "infra",
  "infrastructure",
  "k8s",
  "kubernetes",
  "manifests",
  "sam",
  "terraform",
]);

function detectDeploymentKind(path, text) {
  const base = basenameOf(path);
  if (/^dockerfile(?:\..*)?$/i.test(base) || /\.dockerfile$/i.test(base)) return "dockerfile";
  if (/^(?:docker-)?compose(?:\..*)?\.ya?ml$/i.test(base)) return "compose";
  if (base === "serverless.yml" || base === "serverless.yaml") return "serverless";
  if (base === "Chart.yaml" || base === "Chart.lock") return "helm_chart";
  if (base === "values.yaml" || base === "values.yml") return "helm_chart";
  if (/\.tf$/i.test(base) || /\.tf\.json$/i.test(base)) return "terraform";
  if (/\.(?:ya?ml|json)$/i.test(base)) {
    if (/\{\{/.test(text) && /\/templates\/[^/]+\.(?:ya?ml|json)$/.test(path))
      return "helm_template";
    if (/Transform:\s*['"]?AWS::Serverless/.test(text)) return "cloudformation";
    if (/^service:\s*\S/m.test(text) && /^functions:/m.test(text)) return "serverless";
    if (/^apiVersion:\s*\S/m.test(text) && /^kind:\s*\S/m.test(text)) return "kubernetes";
    if (/^Resources:/m.test(text)) return "cloudformation";
    if (/^\s*\{/.test(text) && /"Resources"\s*:/.test(text)) return "cloudformation";
    if (/^services:/m.test(text)) return "compose";
    if (/^kind:\s*\S/m.test(text) && /^metadata:/m.test(text)) return "kubernetes";
  }
  return "unknown";
}

function isPathCandidate(path) {
  const base = basenameOf(path);
  if (/^dockerfile(?:\..*)?$/i.test(base) || /\.dockerfile$/i.test(base)) return true;
  if (/^(?:docker-)?compose(?:\..*)?\.ya?ml$/i.test(base)) return true;
  if (base === "serverless.yml" || base === "serverless.yaml") return true;
  if (
    base === "Chart.yaml" ||
    base === "Chart.lock" ||
    base === "values.yaml" ||
    base === "values.yml"
  )
    return true;
  if (/\.tf(?:\.json)?$/i.test(base)) return true;
  if (
    base === "kustomization.yaml" ||
    base === "kustomization.yml" ||
    base === "template.yaml" ||
    base === "template.yml"
  )
    return true;
  if (/\.(?:ya?ml|json)$/i.test(base)) {
    const dirs = path.split("/").slice(0, -1);
    if (dirs.some((dir) => DEPLOYMENT_DIRS.has(dir))) return true;
    if (dirs.includes("templates")) return true;
  }
  return false;
}

export function discoverDeploymentArtifacts(files) {
  const seen = new Set();
  const result = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file !== "string" || file === "") continue;
    if (!isPathCandidate(file)) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    result.push(file);
  }
  return result.toSorted();
}

export function extractArtifact(kind, text, path) {
  switch (kind) {
    case "dockerfile":
      return extractDockerfile(text, path);
    case "compose":
      return extractCompose(text, path);
    case "kubernetes":
      return extractKubernetes(text, path);
    case "helm_chart":
      return extractHelmChart(text, path);
    case "helm_template":
      return extractHelmTemplate(text, path);
    case "terraform":
      return extractTerraform(text, path);
    case "cloudformation":
      return extractCloudFormation(text, path);
    case "serverless":
      return extractServerless(text, path);
    default:
      throw new DeploymentModelError(
        "UNSUPPORTED_ARTIFACT",
        "no deployment extractor for artifact",
      );
  }
}

export {
  detectDeploymentKind,
  extractCloudFormation,
  extractCompose,
  extractDockerfile,
  extractHelmChart,
  extractHelmTemplate,
  extractKubernetes,
  extractServerless,
  extractTerraform,
};
