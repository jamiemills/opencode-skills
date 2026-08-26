import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { loadSchemaRegistry, digest } from "../../lib/schema-runtime/index.mjs";
import { readDurableJson, writeDurableJson } from "../../lib/durable-json/index.mjs";

const registry = await loadSchemaRegistry();

function error(code, message) {
  const result = new Error(message);
  result.code = code;
  return result;
}

export function assertDescriptorPath(path, root) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path)
  )
    throw error("unsafe-path", `publication path must be relative: ${path}`);
  const fromRoot = relative(resolve(root), resolve(root, path));
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot))
    throw error("unsafe-path", `publication path escapes source root: ${path}`);
  return resolve(root, path);
}

export function validatePublicationDescriptor(value, { sourceRunId, destination } = {}) {
  const result = registry.validate("csm-upload-publication/1", value);
  if (!result.valid)
    throw error("invalid-publication", result.errors.map((item) => item.message).join("; "));
  if (sourceRunId && value.sourceRunId !== sourceRunId)
    throw error("run-mismatch", "publication source run mismatch");
  if (destination && digest(value.destination) !== digest(destination))
    throw error(
      "destination-mismatch",
      "publication destination does not match requested destination",
    );
  if (value.confirmation.confirmed && !value.confirmation.confirmedAt)
    throw error("confirmation", "confirmation timestamp is required");
  const binaryRequired = value.inputs.some(
    (input) => !input.contentType.startsWith("text/") && input.contentType !== "application/json",
  );
  if (
    (binaryRequired || value.binaryAcknowledgment.required) &&
    !value.binaryAcknowledgment.acknowledged
  )
    throw error("binary-acknowledgment", "binary acknowledgment is required");
  if (value.descriptorDigest) {
    const body = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "descriptorDigest"),
    );
    if (value.descriptorDigest !== digest(body))
      throw error("digest-mismatch", "publication descriptor digest does not match");
  }
  return value;
}

export async function readPublicationDescriptor(path) {
  if (!path.endsWith(".json") || path.endsWith(".md") || path.endsWith(".html"))
    throw error(
      "json-only",
      "publication inputs must be JSON descriptors, not projections or legacy text",
    );
  let value;
  try {
    value = await readDurableJson(path);
  } catch (cause) {
    throw Object.assign(error("json-only", "publication input is not valid JSON"), { cause });
  }
  return validatePublicationDescriptor(value);
}

export async function snapshotPublicationInputs(descriptor, { root }) {
  validatePublicationDescriptor(descriptor);
  if (descriptor.inputs.length > descriptor.snapshot.maxFiles)
    throw error("snapshot-bounds", "snapshot file bound exceeded");
  let bytes = 0;
  const files = [];
  for (const input of descriptor.inputs) {
    const path = assertDescriptorPath(input.path, root);
    let current = resolve(root);
    for (const part of input.path.split("/")) {
      current = resolve(current, part);
      if ((await lstat(current).catch(() => null))?.isSymbolicLink())
        throw error("unsafe-path", "publication input has a symlinked ancestor");
    }
    const linkInfo = await lstat(path);
    if (linkInfo.isSymbolicLink())
      throw error("unsafe-artifact", `input is not a regular file: ${input.path}`);
    const target = await realpath(path);
    const within = relative(resolve(root), target);
    if (isAbsolute(within) || within.split("/").includes(".."))
      throw error("unsafe-path", `input escapes source root: ${input.path}`);
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile())
      throw error("unsafe-artifact", `input is not a regular file: ${input.path}`);
    const content = await readFile(target);
    const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actual !== input.digest || content.byteLength !== input.bytes)
      throw error("digest-mismatch", `input digest or size mismatch: ${input.path}`);
    bytes += content.byteLength;
    if (bytes > descriptor.snapshot.maxBytes)
      throw error("snapshot-bounds", "snapshot byte bound exceeded");
    files.push({ ...input, content });
  }
  return files;
}

export async function publishPublicationDescriptor(
  descriptor,
  { root, destination, confirm = false, executor = {}, cleanup } = {},
) {
  validatePublicationDescriptor(descriptor, { destination });
  if (!confirm || !descriptor.confirmation.confirmed)
    throw error("confirmation-required", "publication requires explicit confirmation");
  const files = await snapshotPublicationInputs(descriptor, { root });
  const cleanupFn = cleanup ?? (async () => {});
  try {
    if (!executor.publish)
      return {
        ...descriptor,
        status: "validated",
        deployment: { status: "not-started", url: null },
        cleanup: { status: "not-needed", path: null },
      };
    await executor.publish({ descriptor, files });
    let cleanupState = { status: "not-needed", path: null };
    if (cleanup !== undefined) {
      try {
        await cleanupFn();
        cleanupState = { status: "complete", path: null };
      } catch {
        cleanupState = { status: "failed", path: null };
      }
    }
    const published = {
      ...descriptor,
      status: "published",
      deployment: {
        status: executor.url ? "published" : "unknown",
        url: executor.url ?? null,
        ...(executor.url ? { verifiedAt: new Date().toISOString() } : {}),
      },
      cleanup: cleanupState,
    };
    delete published.descriptorDigest;
    published.descriptorDigest = digest(published);
    return published;
  } catch (cause) {
    let cleanupError = null;
    try {
      await cleanupFn();
    } catch (caught) {
      cleanupError = caught;
    }
    throw Object.assign(error("publication-failed", cause.message), {
      cleanup: cleanupError ? cleanupError.message : "complete",
    });
  }
}

export async function writePublicationDescriptor(path, descriptor) {
  validatePublicationDescriptor(descriptor);
  await writeDurableJson(path, { ...descriptor, descriptorDigest: digest(descriptor) });
}
