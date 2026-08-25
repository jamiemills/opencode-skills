"use strict";

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalize } from "../schema-runtime/index.mjs";

const SHARES = new Set(["none", "markdown", "html", "both"]);
const MODES = new Set(["interactive", "non-interactive", "unknown"]);
const MEDIA = { markdown: "text/markdown", html: "text/html" };
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isDateTime(value) {
  if (typeof value !== "string" || !DATE_TIME.test(value)) return false;
  const parsed = Date.parse(value);
  const normalized = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized;
}

function fail(message, code = "invalid-publication-request") {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bytesOf(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  fail("renderer output must be text or bytes", "invalid-renderer-output");
}

function schemaRef(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is required`);
  if (
    typeof value.id !== "string" ||
    !/^[a-z][a-z0-9-]*\/[1-9][0-9]*$/.test(value.id) ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    Number(value.id.slice(value.id.lastIndexOf("/") + 1)) !== value.revision ||
    Object.keys(value).length !== 2
  )
    fail(`${label} must be an immutable schema reference`);
  return { id: value.id, revision: value.revision };
}

export function validateSourceDescriptor(source) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    fail("source descriptor is required");
  if (!/^art-[a-z0-9][a-z0-9-]{1,127}$/.test(source.artifactId)) fail("invalid source artifact ID");
  if (!/^sha256:[a-f0-9]{64}$/.test(source.digest)) fail("invalid source digest");
  return {
    artifactId: source.artifactId,
    digest: source.digest,
    schema: schemaRef(source.schema, "source schema"),
  };
}

export function validateProjectionDescriptor(projection) {
  if (!projection || typeof projection !== "object" || Array.isArray(projection))
    fail("projection descriptor is required", "invalid-projection");
  if (projection.schema !== "csm-projection/1")
    fail("unsupported projection descriptor", "invalid-projection");
  const allowed = new Set([
    "schema",
    "projectionId",
    "source",
    "sourceRunId",
    "sourceOwner",
    "mediaType",
    "renderer",
    "profile",
    "rendererDigest",
    "profileDigest",
    "generatedAt",
    "outputDigest",
    "status",
    "approval",
    "expiresAt",
    "location",
  ]);
  if (Object.keys(projection).some((key) => !allowed.has(key)))
    fail("projection descriptor contains an unknown field", "invalid-projection");
  if (!/^proj-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.projectionId))
    fail("invalid projection ID", "invalid-projection");
  const source = validateSourceDescriptor(projection.source);
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.sourceRunId)) fail("invalid source run ID");
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(projection.sourceOwner)) fail("invalid source owner");
  if (!Object.values(MEDIA).includes(projection.mediaType))
    fail("unsupported projection media type");
  const renderer = schemaRef(projection.renderer, "projection renderer");
  const profile = schemaRef(projection.profile, "projection profile");
  for (const [name, value] of [
    ["rendererDigest", projection.rendererDigest],
    ["profileDigest", projection.profileDigest],
    ["outputDigest", projection.outputDigest],
  ])
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail(`invalid ${name}`);
  if (!isDateTime(projection.generatedAt)) fail("invalid generatedAt", "invalid-projection");
  if (projection.status !== "untrusted-presentation")
    fail("projection must be untrusted presentation");
  const approval = projection.approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval))
    fail("projection approval is required", "invalid-projection");
  if (
    Object.keys(approval).some(
      (key) => !["binding", "status", "approvedBy", "approvedAt"].includes(key),
    )
  )
    fail("projection approval contains an unknown field", "invalid-projection");
  if (!new Set(["pending", "approved", "rejected", "expired"]).has(approval.status))
    fail("invalid projection approval status", "invalid-projection");
  const binding = approval.binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding))
    fail("projection approval binding is required", "invalid-projection");
  const bindingFields = [
    "source",
    "sourceRunId",
    "sourceOwner",
    "renderer",
    "rendererDigest",
    "profile",
    "profileDigest",
    "outputDigest",
  ];
  if (
    Object.keys(binding).some((key) => !bindingFields.includes(key)) ||
    bindingFields.some((key) => !Object.hasOwn(binding, key))
  )
    fail("invalid projection approval binding", "invalid-projection");
  validateSourceDescriptor(binding.source);
  if (binding.source.digest !== source.digest) fail("approval source does not match projection");
  if (
    binding.sourceRunId !== projection.sourceRunId ||
    binding.sourceOwner !== projection.sourceOwner
  )
    fail("approval identity does not match projection");
  schemaRef(binding.renderer, "approval renderer");
  schemaRef(binding.profile, "approval profile");
  for (const [name, value] of [
    ["approval renderer digest", binding.rendererDigest],
    ["approval profile digest", binding.profileDigest],
    ["approval output digest", binding.outputDigest],
  ])
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail(`invalid ${name}`);
  const projectionBinding = {
    source,
    sourceRunId: projection.sourceRunId,
    sourceOwner: projection.sourceOwner,
    renderer,
    rendererDigest: projection.rendererDigest,
    profile,
    profileDigest: projection.profileDigest,
    outputDigest: projection.outputDigest,
  };
  if (canonicalize(binding) !== canonicalize(projectionBinding))
    fail("approval binding does not match projection", "invalid-projection");
  if (approval.status === "approved") {
    if (typeof approval.approvedBy !== "string" || approval.approvedBy.length === 0)
      fail("approved projection requires approvedBy", "invalid-projection");
    if (!isDateTime(approval.approvedAt))
      fail("approved projection requires approvedAt", "invalid-projection");
  }
  if (
    approval.approvedBy !== undefined &&
    (typeof approval.approvedBy !== "string" || approval.approvedBy.length === 0)
  )
    fail("invalid approvedBy", "invalid-projection");
  for (const [name, value] of [
    ["expiresAt", projection.expiresAt],
    ["approvedAt", approval.approvedAt],
  ])
    if (value !== undefined && !isDateTime(value)) fail(`invalid ${name}`, "invalid-projection");
  return { ...projection, source, renderer, profile };
}

export function resolveShare({
  interactionMode = "unknown",
  share,
  destination,
  htmlRequested = false,
} = {}) {
  if (!MODES.has(interactionMode)) interactionMode = "unknown";
  if (share !== undefined && !SHARES.has(share))
    fail("share must be none, markdown, html, or both");
  if (share !== undefined) return share;
  if (destination?.mediaType === MEDIA.html) return "html";
  if (htmlRequested) return "html";
  return interactionMode === "interactive" ? "markdown" : "none";
}

function needsHtml(share, { destination, htmlRequested = false } = {}) {
  return (
    share === "html" || share === "both" || htmlRequested || destination?.mediaType === MEDIA.html
  );
}

export function validateApproval(approval, projection, { now = new Date() } = {}) {
  let candidate;
  try {
    candidate = validateProjectionDescriptor(projection);
  } catch {
    return false;
  }
  if (!approval || approval.status !== "approved") return false;
  if (!approval.approvedBy || !isDateTime(approval.approvedAt)) return false;
  const expiresAt = approval.expiresAt ? Date.parse(approval.expiresAt) : Infinity;
  if (!Number.isFinite(expiresAt) ? approval.expiresAt !== undefined : expiresAt <= now.getTime())
    return false;
  const expected = approval.binding;
  const actual = bindingFor(candidate);
  return canonicalize(expected) === canonicalize(actual);
}

export function bindingFor(projection) {
  const descriptor = validateProjectionDescriptor(projection);
  return {
    source: descriptor.source,
    sourceRunId: descriptor.sourceRunId,
    sourceOwner: descriptor.sourceOwner,
    renderer: descriptor.renderer,
    rendererDigest: descriptor.rendererDigest,
    profile: descriptor.profile,
    profileDigest: descriptor.profileDigest,
    outputDigest: descriptor.outputDigest,
  };
}

export function approveProjection(
  projection,
  { approvedBy, approvedAt = new Date().toISOString(), expiresAt } = {},
) {
  const descriptor = validateProjectionDescriptor(projection);
  if (typeof approvedBy !== "string" || approvedBy.length === 0) fail("approvedBy is required");
  return {
    binding: bindingFor(descriptor),
    status: "approved",
    approvedBy,
    approvedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function safeChild(root, child) {
  if (typeof child !== "string" || child.length === 0 || isAbsolute(child))
    fail("export path must be relative", "path-containment");
  const target = resolve(root, child);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    fail("export path escapes export root", "path-containment");
  return target;
}

async function assertNoSymlink(root, target) {
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split("/")) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        fail("symlinked export path is not allowed", "path-containment");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
}

async function assertSafeRoot(root) {
  try {
    if ((await lstat(root)).isSymbolicLink())
      fail("symlinked export root is not allowed", "path-containment");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function metadataMatchesKey(metadata, key) {
  try {
    if (
      metadata?.key !== key ||
      !/^sha256:[a-f0-9]{64}$/.test(metadata.sourceDigest) ||
      canonicalize(schemaRef(metadata.schema, "stored schema")) !== canonicalize(metadata.schema) ||
      !Object.values(MEDIA).includes(metadata.mediaType) ||
      !/^sha256:[a-f0-9]{64}$/.test(metadata.outputDigest) ||
      !isDateTime(metadata.expiresAt)
    )
      return false;
    const expectedKey = `${metadata.sourceDigest.slice(7)}/${metadata.schema.id.replaceAll("/", "-")}-${metadata.schema.revision}/${metadata.mediaType.replace("/", "-")}/${metadata.outputDigest.slice(7)}`;
    return expectedKey === key;
  } catch {
    return false;
  }
}

export class DisposableExportStore {
  constructor({ root, ttlMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    if (!root || !isAbsolute(root)) fail("export root must be absolute", "path-containment");
    this.root = resolve(root);
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async put({ sourceDigest, schema, mediaType, content, ttlMs = this.ttlMs } = {}) {
    await assertSafeRoot(this.root);
    if (!/^sha256:[a-f0-9]{64}$/.test(sourceDigest)) fail("invalid source digest");
    schemaRef(schema, "source schema");
    if (!Object.values(MEDIA).includes(mediaType)) fail("invalid media type");
    const output = bytesOf(content);
    const outputDigest = sha256(output);
    const key = `${sourceDigest.slice(7)}/${schema.id.replaceAll("/", "-")}-${schema.revision}/${mediaType.replace("/", "-")}/${outputDigest.slice(7)}`;
    const file = safeChild(this.root, `${key}/output`);
    await assertNoSymlink(this.root, file);
    const createdDirectories = [];
    for (let directory = dirname(file); directory !== this.root; directory = dirname(directory)) {
      try {
        await lstat(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        createdDirectories.push(directory);
      }
    }
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const expiry = this.now() + ttlMs;
    let createdOutput = false;
    let createdMeta = false;
    try {
      await writeFile(file, output, { flag: "wx", mode: 0o600 });
      createdOutput = true;
      await writeFile(
        `${file}.meta`,
        JSON.stringify({
          key,
          sourceDigest,
          schema,
          mediaType,
          outputDigest,
          expiresAt: new Date(expiry).toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      createdMeta = true;
    } catch (error) {
      if (createdMeta) await rm(`${file}.meta`, { force: true });
      if (createdOutput) await rm(file, { force: true });
      for (const directory of createdDirectories.toSorted((a, b) => b.length - a.length))
        await rm(directory, { recursive: false, force: true });
      throw error;
    }
    return { key, path: file, outputDigest, expiresAt: new Date(expiry).toISOString() };
  }

  async get(key) {
    await assertSafeRoot(this.root);
    const file = safeChild(this.root, `${key}/output`);
    const metaPath = safeChild(this.root, `${key}/output.meta`);
    await assertNoSymlink(this.root, file);
    await assertNoSymlink(this.root, metaPath);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metaPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
    let validMetadata = true;
    try {
      validMetadata =
        typeof metadata?.key === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(metadata.sourceDigest) &&
        canonicalize(schemaRef(metadata.schema, "stored schema")) ===
          canonicalize(metadata.schema) &&
        Object.values(MEDIA).includes(metadata.mediaType) &&
        /^sha256:[a-f0-9]{64}$/.test(metadata.outputDigest) &&
        DATE_TIME.test(metadata.expiresAt) &&
        Number.isFinite(Date.parse(metadata.expiresAt));
    } catch {
      validMetadata = false;
    }
    if (!validMetadata) return null;
    if (Date.parse(metadata.expiresAt) <= this.now()) {
      await rm(metaPath, { force: true });
      await rm(file, { force: true });
      return null;
    }
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) fail("symlinked exports are not readable", "path-containment");
    const content = await readFile(file);
    const expectedKey = `${metadata.sourceDigest.slice(7)}/${metadata.schema.id.replaceAll("/", "-")}-${metadata.schema.revision}/${metadata.mediaType.replace("/", "-")}/${metadata.outputDigest.slice(7)}`;
    if (metadata.key !== key || expectedKey !== key || sha256(content) !== metadata.outputDigest)
      fail("export metadata or content does not match its path", "path-integrity");
    return { ...metadata, content };
  }

  async cleanup() {
    await assertSafeRoot(this.root);
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) fail("symlinked export path is not allowed", "path-containment");
      if (!entry.isDirectory()) continue;
      const directory = safeChild(this.root, entry.name);
      const files = await readdir(directory, { withFileTypes: true, recursive: true });
      for (const file of files) {
        if (file.isSymbolicLink()) fail("symlinked export path is not allowed", "path-containment");
        if (!file.name.endsWith(".meta")) continue;
        const metaPath = join(file.parentPath ?? directory, file.name);
        await assertNoSymlink(this.root, metaPath);
        const relativeMetaPath = relative(this.root, metaPath).split("/");
        if (
          file.name !== "output.meta" ||
          relativeMetaPath.length !== 5 ||
          relativeMetaPath.at(-1) !== "output.meta"
        )
          continue;
        const key = relativeMetaPath.slice(0, -1).join("/");
        let metadata;
        try {
          metadata = JSON.parse(await readFile(metaPath, "utf8"));
        } catch {
          continue;
        }
        if (!metadataMatchesKey(metadata, key) || Date.parse(metadata.expiresAt) > this.now())
          continue;
        const outputPath = safeChild(this.root, `${key}/output`);
        await assertNoSymlink(this.root, outputPath);
        let content;
        try {
          if (!(await lstat(outputPath)).isFile()) continue;
          content = await readFile(outputPath);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          continue;
        }
        if (sha256(content) !== metadata.outputDigest) continue;
        await rm(outputPath, { force: true });
        await rm(metaPath, { force: true });
        removed += 1;
      }
    }
    return removed;
  }
}

export function assertMachineInput(value) {
  if (typeof value === "string")
    fail("machine inputs must be canonical JSON, not raw text", "machine-input-rejected");
  const ancestors = new WeakSet();
  function inspect(node, key = "") {
    if (key && /\.(?:md|html)$/i.test(key))
      fail("projection files are not machine inputs", "machine-input-rejected");
    if (typeof node === "string") {
      if (/\.(?:md|html)$/i.test(node))
        fail("projection files are not machine inputs", "machine-input-rejected");
      return;
    }
    if (!node || typeof node !== "object") return;
    if (ancestors.has(node))
      fail("cyclic machine inputs are not allowed", "machine-input-rejected");
    ancestors.add(node);
    try {
      if (!Array.isArray(node)) {
        if (node.schema === "csm-projection/1")
          fail("projection descriptors are not machine inputs", "machine-input-rejected");
        if (node.mediaType === "text/markdown" || node.mediaType === "text/html")
          fail("projection descriptors are not machine inputs", "machine-input-rejected");
      }
      for (const [childKey, child] of Object.entries(node)) inspect(child, childKey);
    } finally {
      ancestors.delete(node);
    }
  }
  inspect(value);
  return value;
}

export async function publish({
  source,
  projection,
  approval,
  interactionMode = "unknown",
  share,
  destination,
  htmlRequested = false,
  renderers = {},
  store,
  now = new Date(),
  ttlMs,
} = {}) {
  const validatedSource = validateSourceDescriptor(source);
  const validatedProjection =
    projection === undefined ? undefined : validateProjectionDescriptor(projection);
  const requested = resolveShare({ interactionMode, share, destination, htmlRequested });
  const outputs = {};
  if (requested === "none") return { share: requested, outputs, persisted: false };
  if (requested === "html" || requested === "both") {
    if (!needsHtml(requested, { destination, htmlRequested }))
      fail("HTML requires an explicit request or HTML destination", "html-explicit-required");
  }
  const selected = requested === "both" ? ["markdown", "html"] : [requested];
  for (const kind of selected) {
    const render = renderers[kind];
    if (typeof render !== "function")
      fail(`renderer callback missing for ${kind}`, "renderer-required");
    const result = await render({
      source: validatedSource,
      projection: validatedProjection,
      mediaType: MEDIA[kind],
    });
    const content = result?.content ?? result?.markdown ?? result?.html ?? result;
    const bytes = bytesOf(content);
    const descriptor = validateProjectionDescriptor(result?.projection ?? projection);
    if (descriptor.source.digest !== validatedSource.digest || descriptor.mediaType !== MEDIA[kind])
      fail("renderer projection does not match request", "projection-mismatch");
    if (sha256(bytes) !== descriptor.outputDigest)
      fail("renderer output digest does not match descriptor", "output-digest-mismatch");
    if (approval && !validateApproval(approval, descriptor, { now }))
      fail("approval does not match current projection", "stale-approval");
    outputs[kind] = {
      content: typeof content === "string" ? content : bytes,
      projection: descriptor,
      outputDigest: descriptor.outputDigest,
    };
    if (store)
      outputs[kind].storage = await store.put({
        sourceDigest: validatedSource.digest,
        schema: validatedSource.schema,
        mediaType: MEDIA[kind],
        content: bytes,
        ttlMs,
      });
  }
  return { share: requested, outputs, persisted: Boolean(store) };
}

export { MEDIA };
