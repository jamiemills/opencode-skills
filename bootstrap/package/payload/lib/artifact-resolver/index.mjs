"use strict";

import { O_DIRECTORY, O_NOFOLLOW, O_RDONLY } from "node:constants";
import { open, readdir, realpath } from "node:fs/promises";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertMachineInput } from "../publication/index.mjs";
import { parseJson } from "../schema-runtime/index.mjs";
import {
  DIGEST_FIELDS,
  digestBytes,
  legacyDigestFields,
  validateDigestTaxonomy,
} from "../digest-taxonomy/index.mjs";

const JSON_EXTENSIONS = new Set([".json", ".jsonl"]);
const TERMINAL = new Set(["completed", "failed", "superseded", "quarantined"]);
export const DEFAULT_ARTIFACT_EDGE = Object.freeze({ id: "global-json-only", enabled: true });
export const DEFAULT_ARTIFACT_RESOLVER_LIMITS = Object.freeze({
  maxDepth: 8,
  maxFiles: 256,
  maxTotalBytes: 64 * 1024 * 1024,
  maxPerFileBytes: 8 * 1024 * 1024,
  maxJsonlRecords: 1024,
  maxInFlightResolutions: 8,
});

function error(code, message, details = {}) {
  return Object.freeze({ status: "rejected", code, message, ...details });
}

function resolverLimits(overrides = {}) {
  const limits = { ...DEFAULT_ARTIFACT_RESOLVER_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`);
    if (value > DEFAULT_ARTIFACT_RESOLVER_LIMITS[name])
      throw new TypeError(`${name} cannot exceed the bounded default`);
  }
  return Object.freeze(limits);
}

function resourceLimit(message, details = {}) {
  return error("resource-limit", message, {
    uncertainty: "capped",
    coverage: "unverified",
    ...details,
  });
}

function taxonomyErrorCode(errors) {
  const field = errors.find((entry) => /^(file|payload|descriptor)Digest /.test(entry));
  if (!field) return "digest-invalid";
  const name = field.split(" ")[0].replace(/Digest$/, "-digest");
  return field.endsWith(" is required") ? `${name}-required` : `${name}-mismatch`;
}

function relativePath(root, value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value))
    throw error("path-traversal", "artifact path must be relative");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === ".."))
    throw error("path-traversal", "artifact path must not escape its root");
  const target = resolve(root, normalized);
  const rootPath = resolve(root);
  const outside = relative(rootPath, target);
  if (outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside))
    throw error("path-traversal", "artifact path must remain within its root");
  return { relative: normalized, absolute: target };
}

async function assertRegularPath(root, absolute) {
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = resolve(root);
  for (const part of parts) {
    current = resolve(current, part);
    const info = await lstat(current, { bigint: true }).catch(() => null);
    if (!info) throw error("missing", "artifact path does not exist");
    if (info.isSymbolicLink()) throw error("symlink", "artifact paths must not contain symlinks");
  }
  const info = await lstat(absolute, { bigint: true });
  if (!info.isFile()) throw error("not-regular-file", "artifact must be a regular file");
  return info;
}

async function assertResolverRoot(root) {
  const info = await lstat(root, { bigint: true }).catch(() => null);
  if (!info) throw error("missing", "artifact resolver root does not exist");
  if (info.isSymbolicLink()) throw error("symlink", "artifact resolver roots must not be symlinks");
  if (!info.isDirectory())
    throw error("not-directory", "artifact resolver root must be a directory");
}

export function assertPathWithinRoot(root, candidate) {
  const outside = relative(resolve(root), resolve(candidate));
  if (outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside))
    throw error("path-containment", "opened artifact path escapes its configured root");
}

function fileIdentity(info) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
}

function recordIdentity(record) {
  if (record?.artifact?.artifactId) return record.artifact.artifactId;
  if (record?.artifactId) return record.artifactId;
  if (record?.schema === "csm-browse-evidence/1" && record?.evidenceId) return record.evidenceId;
  if (record?.eventId) return record.eventId;
  return null;
}

function recordOwner(record) {
  return record?.artifact?.owner ?? record?.owner ?? record?.provenance?.producer ?? null;
}

function recordSourceDigest(record, allowLegacy = false) {
  if (record?.sourceDigest) return record.sourceDigest;
  if (!allowLegacy) return null;
  return (
    record?.digest ??
    record?.artifact?.digest ??
    record?.provenance?.sourceDigest ??
    record?.sourcePlan?.planDigest ??
    (Array.isArray(record?.provenance?.sourceDigests)
      ? record.provenance.sourceDigests[0]
      : undefined)
  );
}

function recordSourceRunId(record, allowLegacy = false) {
  if (record?.sourceRunId) return record.sourceRunId;
  if (!allowLegacy) return null;
  if (record?.schema === "csm-browse-evidence/1") return record.runId ?? null;
  return record?.sourcePlan?.runId ?? record?.provenance?.sourceRunId ?? null;
}

function recordSourceArtifactIds(record, allowLegacy = false) {
  const ids = [...(record?.sourceArtifactIds ?? [])].filter(Boolean);
  if (allowLegacy && record?.schema === "csm-browse-evidence/1" && record?.evidenceId)
    ids.push(record.evidenceId);
  if (allowLegacy) {
    ids.push(record?.sourcePlan?.artifactId, record?.provenance?.sourceArtifactId);
  }
  return ids.filter(Boolean);
}

function validateRecord(registry, record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw error("invalid-json", "artifact record must be an object");
  assertMachineInput(record);
  if (typeof record.schema !== "string") throw error("untyped", "artifact record has no schema");
  const revision = Number(record.schema.split("/").at(-1));
  const name = record.schema.slice(0, record.schema.lastIndexOf("/"));
  if (!Number.isInteger(revision) || !name)
    throw error("unknown-revision", "artifact schema revision is unknown");
  try {
    registry.resolve(name, revision);
  } catch {
    throw error("unknown-revision", `unknown schema revision: ${record.schema}`);
  }
  const result = registry.validate(record.schema, record);
  if (!result.valid)
    throw error("schema-invalid", `artifact does not validate as ${record.schema}`, {
      errors: result.errors,
    });
  return record;
}

async function readStable(root, absolute, maxPerFileBytes) {
  const before = await assertRegularPath(root, absolute);
  const rootRealPath = await realpath(root);
  const handle = await open(absolute, O_RDONLY | O_NOFOLLOW);
  try {
    const openedRealPath = await realpath(`/proc/self/fd/${handle.fd}`);
    assertPathWithinRoot(rootRealPath, openedRealPath);
    if (maxPerFileBytes !== undefined && before.size > BigInt(maxPerFileBytes))
      throw resourceLimit("artifact exceeds the per-file byte limit", {
        limit: "maxPerFileBytes",
        maximum: maxPerFileBytes,
        actual: Number(before.size),
      });
    const bytes =
      maxPerFileBytes === undefined
        ? await handle.readFile()
        : (await handle.read(Buffer.alloc(maxPerFileBytes + 1), 0, maxPerFileBytes + 1, 0)).buffer;
    const after = await handle.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after))
      throw error("terminal-replacement", "artifact was replaced while being resolved");
    const bounded = maxPerFileBytes === undefined ? bytes : bytes.subarray(0, Number(after.size));
    return { bytes: bounded, info: after, readBytes: bounded.length };
  } finally {
    await handle.close();
  }
}

function legacyResult(path, owner) {
  return Object.freeze({
    status: "migration-required",
    code: "legacy-markdown-history",
    path,
    owner: owner ?? null,
    readOnly: true,
    message: "legacy Markdown is immutable history and requires an edge migration",
  });
}

export function classifyArtifactPath(path, { owner = null } = {}) {
  if (typeof path !== "string") return error("invalid-path", "artifact path must be a string");
  if (/\.md$/i.test(path)) return legacyResult(path, owner);
  if (/\.html?$/i.test(path))
    return Object.freeze({ ...legacyResult(path, owner), code: "projection-history" });
  if (!JSON_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase()))
    return error("unsupported-format", "only registered JSON and JSONL artifacts are discoverable");
  return Object.freeze({ status: "candidate", path, readOnly: false });
}

export function createArtifactResolver({
  root,
  schemaRegistry,
  compatibility,
  edge,
  owner,
  requireSourceDigest = true,
  migrationMode = false,
  compatibilityMode = false,
  limits: limitOverrides,
  onResolutionStart,
} = {}) {
  if (!root || !schemaRegistry) throw new TypeError("root and schemaRegistry are required");
  if (edge !== undefined && typeof edge !== "object") throw new TypeError("edge must be an object");
  // An explicit edge can still disable resolution for rollback; new consumers
  // otherwise use the final JSON-only default.
  const enabled = edge === undefined ? DEFAULT_ARTIFACT_EDGE.enabled : edge.enabled === true;
  const rootPath = resolve(root);
  const allowLegacy = migrationMode === true || compatibilityMode === true;
  const limits = resolverLimits(limitOverrides);

  async function resolveArtifact(
    path,
    {
      expectedDigest,
      expectedFileDigest,
      expectedSourceDigest,
      expectedSourceArtifactId,
      expectedSourceRunId,
      expectedOwner = owner,
      expectedArtifactId,
      consumerRevision,
      replace = false,
    } = {},
  ) {
    const legacyResolution = allowLegacy;
    const classification = classifyArtifactPath(path, { owner: expectedOwner });
    let location;
    try {
      await assertResolverRoot(rootPath);
      location = relativePath(rootPath, path);
      if (classification.status !== "candidate") return classification;
      if (!enabled)
        return Object.freeze({
          status: "disabled",
          code: "edge-opt-in-required",
          path,
          readOnly: true,
        });
      if (expectedDigest && !expectedFileDigest && !legacyResolution)
        return error(
          "ambiguous-legacy-digest",
          "expectedDigest is ambiguous; use expectedFileDigest or explicit migration mode",
          { path },
        );
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (onResolutionStart) await onResolutionStart(path);
      const { bytes, info, readBytes } = await readStable(
        rootPath,
        location.absolute,
        limits.maxPerFileBytes,
      );
      if (bytes.length > limits.maxPerFileBytes)
        return resourceLimit("artifact exceeds the per-file byte limit", {
          path,
          limit: "maxPerFileBytes",
          maximum: limits.maxPerFileBytes,
          actual: bytes.length,
        });
      const actualFileDigest = digestBytes(bytes);
      const expectedFile = expectedFileDigest ?? expectedDigest;
      if (expectedFile && expectedFile !== actualFileDigest)
        return error("digest-mismatch", "artifact digest does not match expected digest", {
          path,
          digest: actualFileDigest,
          fileDigest: actualFileDigest,
        });
      const text = bytes.toString("utf8");
      const records =
        extension === ".jsonl"
          ? (() => {
              if (text.trim() && !text.endsWith("\n") && !text.endsWith("\r"))
                throw error("partial-tail", "JSONL artifact has an unterminated partial tail");
              const identities = new Set();
              const jsonlRecords = [];
              for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (jsonlRecords.length >= limits.maxJsonlRecords)
                  throw resourceLimit("JSONL artifact exceeds the record limit", {
                    path,
                    limit: "maxJsonlRecords",
                    maximum: limits.maxJsonlRecords,
                  });
                {
                  const record = parseJson(line);
                  const identity = recordIdentity(record);
                  if (identity) {
                    if (identities.has(identity))
                      throw error(
                        "duplicate-identity",
                        `JSONL artifact identity is duplicated: ${identity}`,
                      );
                    identities.add(identity);
                  }
                  jsonlRecords.push(record);
                }
              }
              return jsonlRecords;
            })()
          : [parseJson(text)];
      if (extension === ".jsonl" && records.length === 0)
        throw error("invalid-empty-artifact", "JSONL artifact must contain at least one record");
      for (const record of records) {
        const legacyFields = legacyDigestFields(record);
        if (legacyFields.length && !legacyResolution && requireSourceDigest)
          return error(
            "ambiguous-legacy-digest",
            "legacy digest aliases require explicit migration mode",
            { path, fields: legacyFields },
          );
      }
      const validated = records.map((record) => validateRecord(schemaRegistry, record));
      for (const record of validated) {
        const taxonomy = validateDigestTaxonomy(record, {
          required:
            !legacyResolution &&
            record.schema === "csm-artifact/1" &&
            DIGEST_FIELDS.some((field) => Object.hasOwn(record, field))
              ? ["payloadDigest", "descriptorDigest"]
              : [],
          source: { fileDigest: actualFileDigest },
        });
        if (!taxonomy.valid)
          return error(
            taxonomyErrorCode(taxonomy.errors),
            "artifact digest taxonomy validation failed",
            {
              path,
              errors: taxonomy.errors,
            },
          );
        if (
          expectedSourceDigest &&
          recordSourceDigest(record, legacyResolution) !== expectedSourceDigest
        )
          return error(
            "source-digest-mismatch",
            "artifact sourceDigest does not match upstream identity",
            { path },
          );
        if (
          expectedSourceArtifactId &&
          !recordSourceArtifactIds(record, legacyResolution).includes(expectedSourceArtifactId)
        )
          return error(
            "source-identity-mismatch",
            "artifact is not bound to the expected upstream artifact",
            { path },
          );
        if (
          expectedSourceRunId &&
          recordSourceRunId(record, legacyResolution) !== expectedSourceRunId
        )
          return error(
            "source-run-mismatch",
            "artifact is not bound to the expected upstream run",
            { path },
          );
      }
      if (
        requireSourceDigest &&
        validated.some(
          (record) =>
            !/^sha256:[a-f0-9]{64}$/.test(recordSourceDigest(record, legacyResolution) ?? ""),
        )
      )
        return error("source-digest-required", "machine artifacts must declare a source digest", {
          path,
        });
      if (
        extension === ".json" &&
        validated[0].contentType !== undefined &&
        validated[0].contentType !== "application/json"
      )
        throw error(
          "content-type-mismatch",
          "JSON artifact contentType does not match its extension",
        );
      if (
        extension === ".jsonl" &&
        validated.some(
          (record) =>
            record.contentType !== undefined && record.contentType !== "application/jsonl",
        )
      )
        throw error(
          "content-type-mismatch",
          "JSONL artifact contentType does not match its extension",
        );
      const owners = new Set(validated.map(recordOwner).filter(Boolean));
      const hasOwnerlessRecord = validated.some((record) => !recordOwner(record));
      // Ownerless journals are valid only when every record is ownerless and no owner is expected.
      if (owners.size > 1 || (owners.size === 1 && hasOwnerlessRecord))
        return error("ownership-mismatch", "a journal cannot mix distinct or ownerless records", {
          path,
          owner: [...owners],
        });
      if (expectedOwner && (owners.size !== 1 || [...owners][0] !== expectedOwner))
        return error("ownership-mismatch", "artifact owner does not match the edge owner", {
          path,
          owner: [...owners],
        });
      const compatibilityPlans = [];
      if (consumerRevision !== undefined && compatibility) {
        for (const record of validated) {
          const revision = Number(record.schema.split("/").at(-1));
          compatibilityPlans.push(
            compatibility.negotiate(
              record.schema.slice(0, record.schema.lastIndexOf("/")),
              revision,
              consumerRevision,
            ),
          );
        }
      }
      const resolvedRecords = compatibilityPlans.length
        ? validated.map((record, index) => {
            const plan = compatibilityPlans[index];
            if (plan.mode !== "adapter") return record;
            const adapted = validateRecord(
              schemaRegistry,
              plan.adapter.transform(structuredClone(record)),
            );
            const base = record.schema.slice(0, record.schema.lastIndexOf("/"));
            if (adapted.schema !== `${base}/${consumerRevision}`)
              throw error(
                "adapter-revision-mismatch",
                "adapter did not produce the negotiated revision",
              );
            const taxonomy = validateDigestTaxonomy(adapted, {
              required:
                !legacyResolution &&
                adapted.schema === "csm-artifact/1" &&
                DIGEST_FIELDS.some((field) => Object.hasOwn(adapted, field))
                  ? ["payloadDigest", "descriptorDigest"]
                  : [],
              source: { fileDigest: actualFileDigest },
            });
            if (!taxonomy.valid)
              throw error("digest-invalid", "adapted artifact failed digest validation", {
                path,
                errors: taxonomy.errors,
              });
            if (
              expectedSourceDigest &&
              recordSourceDigest(adapted, legacyResolution) !== expectedSourceDigest
            )
              throw error("source-digest-mismatch", "adapted artifact sourceDigest mismatch", {
                path,
              });
            if (
              expectedSourceArtifactId &&
              !recordSourceArtifactIds(adapted, legacyResolution).includes(expectedSourceArtifactId)
            )
              throw error("source-identity-mismatch", "adapted artifact source identity mismatch", {
                path,
              });
            if (
              expectedSourceRunId &&
              recordSourceRunId(adapted, legacyResolution) !== expectedSourceRunId
            )
              throw error("source-run-mismatch", "adapted artifact source run mismatch", { path });
            return adapted;
          })
        : validated;
      const terminal = resolvedRecords.some((record) => TERMINAL.has(record.lifecycleStatus));
      if (
        expectedArtifactId &&
        resolvedRecords.some((record) => recordIdentity(record) !== expectedArtifactId)
      )
        return error(
          "identity-mismatch",
          "artifact identity does not match the requested identity",
          {
            path,
          },
        );
      if (replace && terminal)
        return error("terminal-immutable", "terminal artifacts cannot be replaced", { path });
      return Object.freeze({
        status: "resolved",
        path,
        records: resolvedRecords,
        value: resolvedRecords.length === 1 ? resolvedRecords[0] : resolvedRecords,
        digest: actualFileDigest,
        fileDigest: actualFileDigest,
        owner: [...owners][0] ?? null,
        terminal,
        readOnly: terminal,
        fileIdentity: fileIdentity(info),
        readBytes,
      });
    } catch (caught) {
      if (caught?.status === "rejected") return caught;
      if (caught instanceof SyntaxError)
        return error("invalid-json", "artifact contains invalid JSON", { path });
      return error(
        caught?.code === "ENOENT" ? "missing" : (caught?.code ?? "resolution-failed"),
        caught?.message ?? "artifact resolution failed",
        { path },
      );
    }
  }

  async function discover({ owner: requestedOwner = owner } = {}) {
    if (!enabled)
      return Object.freeze({ status: "disabled", code: "edge-opt-in-required", artifacts: [] });
    const paths = [];
    async function walk(directory, depth, state) {
      if (depth > limits.maxDepth)
        throw resourceLimit("artifact discovery exceeds the directory depth limit", {
          limit: "maxDepth",
          maximum: limits.maxDepth,
        });
      const directoryHandle = await open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
      try {
        const openedRealPath = await realpath(`/proc/self/fd/${directoryHandle.fd}`);
        assertPathWithinRoot(state.rootRealPath, openedRealPath);
        const entries = await readdir(`/proc/self/fd/${directoryHandle.fd}`, {
          withFileTypes: true,
        });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
          const absolute = resolve(directory, entry.name);
          if (entry.isSymbolicLink()) throw error("symlink", "artifact discovery refuses symlinks");
          if (entry.isDirectory()) await walk(absolute, depth + 1, state);
          else if (
            JSON_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())
          ) {
            if (state.files >= limits.maxFiles)
              throw resourceLimit("artifact discovery exceeds the file limit", {
                limit: "maxFiles",
                maximum: limits.maxFiles,
              });
            state.files += 1;
            const info = await lstat(absolute, { bigint: true });
            state.bytes += Number(info.size);
            if (state.bytes > limits.maxTotalBytes)
              throw resourceLimit("artifact discovery exceeds the total byte limit", {
                limit: "maxTotalBytes",
                maximum: limits.maxTotalBytes,
                actual: state.bytes,
              });
            paths.push(relative(rootPath, absolute));
          }
        }
      } finally {
        await directoryHandle.close();
      }
    }
    try {
      await assertResolverRoot(rootPath);
      const state = { files: 0, bytes: 0, rootRealPath: await realpath(rootPath) };
      await walk(rootPath, 0, state);
      state.bytes = 0;
      const orderedPaths = paths.toSorted();
      const results = Array.from({ length: orderedPaths.length });
      let next = 0;
      async function worker() {
        while (true) {
          const index = next++;
          if (index >= orderedPaths.length) return;
          results[index] = await resolveArtifact(orderedPaths[index], {
            expectedOwner: requestedOwner,
          });
        }
      }
      const workers = Math.min(limits.maxInFlightResolutions, orderedPaths.length);
      await Promise.all(Array.from({ length: workers }, worker));
      const rejected = results.find((result) => result.status !== "resolved");
      if (rejected) return rejected;
      for (const result of results) {
        const nextBytes = state.bytes + result.readBytes;
        if (nextBytes > limits.maxTotalBytes)
          return resourceLimit("artifact discovery exceeds the total byte limit", {
            path: result.path,
            limit: "maxTotalBytes",
            maximum: limits.maxTotalBytes,
            actual: nextBytes,
          });
        state.bytes = nextBytes;
      }
      const ids = new Map();
      for (const result of results) {
        for (const record of result.records ?? []) {
          const id = recordIdentity(record);
          if (!id) continue;
          const prior = ids.get(id);
          if (prior && prior.digest !== result.digest)
            return {
              status: "rejected",
              code: "collision",
              message: `artifact identity collision: ${id}`,
              path: result.path,
            };
          ids.set(id, { digest: result.digest, path: result.path });
        }
      }
      return {
        status: "resolved",
        artifacts: results,
        coverage: "complete",
        limits: { ...limits },
        files: state.files,
        bytes: state.bytes,
      };
    } catch (caught) {
      return caught?.status === "rejected"
        ? caught
        : error(
            caught?.code === "ELOOP" ? "symlink" : "discovery-failed",
            caught?.message ?? "artifact discovery failed",
          );
    }
  }

  return Object.freeze({ resolve: resolveArtifact, discover, classify: classifyArtifactPath });
}

export async function resolveArtifactFile(
  path,
  {
    root = process.cwd(),
    schemaRegistry,
    compatibility,
    owner,
    expectedDigest,
    expectedFileDigest,
    expectedSourceDigest,
    expectedSourceArtifactId,
    expectedSourceRunId,
    expectedArtifactId,
    consumerRevision,
    requireSourceDigest = true,
    migrationMode,
    compatibilityMode,
  } = {},
) {
  if (!schemaRegistry) throw new TypeError("schemaRegistry is required");
  return createArtifactResolver({
    root,
    schemaRegistry,
    compatibility,
    owner,
    requireSourceDigest,
    migrationMode,
    compatibilityMode,
  }).resolve(path, {
    expectedDigest,
    expectedFileDigest,
    expectedSourceDigest,
    expectedSourceArtifactId,
    expectedSourceRunId,
    expectedArtifactId,
    consumerRevision,
  });
}
