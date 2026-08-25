"use strict";

import { createHash } from "node:crypto";
import { O_NOFOLLOW, O_RDONLY } from "node:constants";
import { open, readdir, realpath } from "node:fs/promises";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertMachineInput } from "../publication/index.mjs";
import { parseJson } from "../schema-runtime/index.mjs";

const JSON_EXTENSIONS = new Set([".json", ".jsonl"]);
const TERMINAL = new Set(["completed", "failed", "superseded", "quarantined"]);

function error(code, message, details = {}) {
  return Object.freeze({ status: "rejected", code, message, ...details });
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

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function recordIdentity(record) {
  if (record?.artifact?.artifactId) return record.artifact.artifactId;
  if (record?.artifactId) return record.artifactId;
  if (record?.eventId) return record.eventId;
  return null;
}

function recordOwner(record) {
  return record?.artifact?.owner ?? record?.owner ?? null;
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

async function readStable(root, absolute) {
  const before = await assertRegularPath(root, absolute);
  const rootRealPath = await realpath(root);
  const handle = await open(absolute, O_RDONLY | O_NOFOLLOW);
  try {
    const openedRealPath = await realpath(`/proc/self/fd/${handle.fd}`);
    assertPathWithinRoot(rootRealPath, openedRealPath);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after))
      throw error("terminal-replacement", "artifact was replaced while being resolved");
    return { bytes, info: after };
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

export function createArtifactResolver({ root, schemaRegistry, compatibility, edge, owner } = {}) {
  if (!root || !schemaRegistry) throw new TypeError("root and schemaRegistry are required");
  if (edge !== undefined && typeof edge !== "object") throw new TypeError("edge must be an object");
  const enabled = edge?.enabled === true;
  const rootPath = resolve(root);

  async function resolveArtifact(
    path,
    {
      expectedDigest,
      expectedOwner = owner,
      expectedArtifactId,
      consumerRevision,
      replace = false,
    } = {},
  ) {
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
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      const { bytes, info } = await readStable(rootPath, location.absolute);
      const actualDigest = digestBytes(bytes);
      if (expectedDigest && expectedDigest !== actualDigest)
        return error("digest-mismatch", "artifact digest does not match expected digest", {
          path,
          digest: actualDigest,
        });
      const text = bytes.toString("utf8");
      const records =
        extension === ".jsonl"
          ? text
              .split(/\r?\n/)
              .filter((line) => line.trim())
              .map((line) => parseJson(line))
          : [parseJson(text)];
      if (extension === ".jsonl" && records.length === 0)
        throw error("invalid-empty-artifact", "JSONL artifact must contain at least one record");
      const validated = records.map((record) => validateRecord(schemaRegistry, record));
      if (extension === ".json" && validated[0].contentType !== "application/json")
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
      if (consumerRevision !== undefined && compatibility) {
        for (const record of validated) {
          const revision = Number(record.schema.split("/").at(-1));
          compatibility.negotiate(
            record.schema.slice(0, record.schema.lastIndexOf("/")),
            revision,
            consumerRevision,
          );
        }
      }
      const terminal = validated.some((record) => TERMINAL.has(record.lifecycleStatus));
      if (
        expectedArtifactId &&
        validated.some((record) => recordIdentity(record) !== expectedArtifactId)
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
        records: validated,
        value: validated.length === 1 ? validated[0] : validated,
        digest: actualDigest,
        owner: [...owners][0] ?? null,
        terminal,
        readOnly: terminal,
        fileIdentity: fileIdentity(info),
      });
    } catch (caught) {
      if (caught?.status === "rejected") return caught;
      if (caught instanceof SyntaxError)
        return error("invalid-json", "artifact contains invalid JSON", { path });
      return error(
        caught?.code === "ENOENT" ? "missing" : "resolution-failed",
        caught?.message ?? "artifact resolution failed",
        { path },
      );
    }
  }

  async function discover({ owner: requestedOwner = owner } = {}) {
    if (!enabled)
      return Object.freeze({ status: "disabled", code: "edge-opt-in-required", artifacts: [] });
    const paths = [];
    async function walk(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) throw error("symlink", "artifact discovery refuses symlinks");
        if (entry.isDirectory()) await walk(absolute);
        else if (JSON_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()))
          paths.push(relative(rootPath, absolute));
      }
    }
    try {
      await assertResolverRoot(rootPath);
      await walk(rootPath);
      const results = await Promise.all(
        paths.toSorted().map((path) => resolveArtifact(path, { expectedOwner: requestedOwner })),
      );
      const rejected = results.find((result) => result.status !== "resolved");
      if (rejected) return rejected;
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
      return { status: "resolved", artifacts: results };
    } catch (caught) {
      return caught?.status === "rejected"
        ? caught
        : error("discovery-failed", caught?.message ?? "artifact discovery failed");
    }
  }

  return Object.freeze({ resolve: resolveArtifact, discover, classify: classifyArtifactPath });
}
