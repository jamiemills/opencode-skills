import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendEvent,
  digestEvidenceFile,
  recoverEvents,
  validateEvidenceDescriptor,
} from "../csm-browse/lib/json-contract.mjs";
import {
  publishPublicationDescriptor,
  readPublicationDescriptor,
  validatePublicationDescriptor,
} from "../csm-upload/lib/publication.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const digestOf = (char) => `sha256:${char.repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csm-browse-upload-json-"));
  const binary = join(root, "shot.png");
  await writeFile(binary, Buffer.from([1, 2, 3, 4]));
  return { root, binary };
}

function publication(root, binary, confirmed = true) {
  const value = {
    schema: "csm-upload-publication/1",
    artifactId: "art-publication-1",
    runId: "run-upload-1",
    owner: "csm-upload",
    sourceRunId: "run-browse-1",
    destination: { github: "nobody", pagesRepo: "demo", path: "demo-1" },
    inputs: [
      {
        evidenceId: "evidence-shot-1",
        path: "shot.png",
        digest: digestOf("a"),
        bytes: 4,
        contentType: "image/png",
      },
    ],
    confirmation: {
      required: true,
      confirmed,
      ...(confirmed ? { confirmedAt: "2026-08-26T00:00:00Z" } : {}),
    },
    snapshot: { maxFiles: 4, maxBytes: 1024 },
    binaryAcknowledgment: { required: true, acknowledged: true },
    status: "draft",
    deployment: { status: "not-started" },
    cleanup: { status: "not-needed", path: null },
  };
  value.descriptorDigest = digest(value);
  return value;
}

test("browse descriptors cover evidence kinds and digest binary files without embedding them", async () => {
  const { root, binary } = await fixture();
  try {
    const descriptor = await digestEvidenceFile("shot.png", {
      root,
      evidenceId: "evidence-shot-1",
      runId: "run-browse-1",
      owner: "csm-browse",
      kind: "screenshot",
      contentType: "image/png",
      capturedAt: "2026-08-26T00:00:00Z",
      metadata: { width: 1 },
      binaryAcknowledged: true,
    });
    assert.equal(descriptor.bytes, 4);
    assert.match(descriptor.digest, /^sha256:/);
    assert.equal(Object.hasOwn(descriptor, "content"), false);
    const performanceDescriptor = {
      ...descriptor,
      kind: "performance",
      contentType: "application/json",
      binaryAcknowledged: false,
    };
    delete performanceDescriptor.descriptorDigest;
    performanceDescriptor.descriptorDigest = digest(performanceDescriptor);
    assert.doesNotThrow(() =>
      validateEvidenceDescriptor(performanceDescriptor, { root, sourceRunId: "run-browse-1" }),
    );
    await symlink(binary, join(root, "link.png"));
    await assert.rejects(
      () =>
        digestEvidenceFile("link.png", {
          root,
          evidenceId: "evidence-link-1",
          runId: "run-browse-1",
          owner: "csm-browse",
          kind: "screenshot",
          contentType: "image/png",
          capturedAt: "2026-08-26T00:00:00Z",
          metadata: {},
          binaryAcknowledged: true,
        }),
      { code: "unsafe-artifact" },
    );
    assert.throws(
      () => validateEvidenceDescriptor({ ...descriptor, path: "../shot.png" }, { root }),
      { code: "unsafe-path" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browse event JSONL recovers state and rejects ownership or sequence corruption", async () => {
  const { root } = await fixture();
  try {
    const path = "events.jsonl";
    await appendEvent(
      path,
      {
        schema: "csm-browse-event/1",
        eventId: "event-one",
        runId: "run-browse-1",
        owner: "csm-browse",
        occurredAt: "2026-08-26T00:00:00Z",
        type: "screenshot",
        data: { evidenceId: "evidence-shot-1" },
      },
      { root, sourceRunId: "run-browse-1" },
    );
    const recovered = await recoverEvents(path, { root, sourceRunId: "run-browse-1" });
    assert.equal(recovered.status, "recoverable");
    assert.equal(recovered.events[0].sequence, 0);
    await assert.rejects(
      () =>
        appendEvent(
          "events.jsonl",
          {
            schema: "csm-browse-event/1",
            eventId: "event-two",
            runId: "run-other",
            owner: "csm-browse",
            occurredAt: "2026-08-26T00:00:00Z",
            type: "error",
            data: {},
          },
          { root, sourceRunId: "run-browse-1" },
        ),
      { code: "run-mismatch" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication validates stubs, destination, confirmation, bounded snapshot, and cleanup", async () => {
  const { root } = await fixture();
  try {
    const path = join(root, "shot.png");
    const value = publication(root, path);
    value.inputs[0].digest =
      "sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";
    delete value.descriptorDigest;
    value.descriptorDigest = digest(value);
    assert.doesNotThrow(() =>
      validatePublicationDescriptor(value, { destination: value.destination }),
    );
    await assert.rejects(
      () =>
        publishPublicationDescriptor(value, {
          root,
          destination: { ...value.destination, pagesRepo: "other" },
          confirm: true,
        }),
      { code: "destination-mismatch" },
    );
    const unconfirmed = { ...value, confirmation: { required: true, confirmed: false } };
    delete unconfirmed.descriptorDigest;
    unconfirmed.descriptorDigest = digest(unconfirmed);
    await assert.rejects(
      () => publishPublicationDescriptor(unconfirmed, { root, confirm: false }),
      { code: "confirmation-required" },
    );
    const result = await publishPublicationDescriptor(value, {
      root,
      destination: value.destination,
      confirm: true,
      executor: { publish: async () => {}, url: "https://example.test/demo" },
    });
    assert.equal(result.status, "published");
    assert.equal(result.deployment.status, "published");
    await assert.rejects(
      () =>
        publishPublicationDescriptor(value, {
          root,
          confirm: true,
          executor: {
            publish: async () => {
              throw new Error("stub failure");
            },
          },
          cleanup: async () => {},
        }),
      { code: "publication-failed" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication rejects legacy Markdown, HTML, and projection descriptors before publication", async () => {
  const { root } = await fixture();
  try {
    await writeFile(join(root, "legacy.md"), "# old");
    await writeFile(join(root, "projection.html"), "<html></html>");
    await assert.rejects(() => readPublicationDescriptor(join(root, "legacy.md")), {
      code: "json-only",
    });
    await assert.rejects(() => readPublicationDescriptor(join(root, "projection.html")), {
      code: "json-only",
    });
    assert.throws(() => validatePublicationDescriptor({ schema: "csm-projection/1" }), {
      code: "invalid-publication",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
