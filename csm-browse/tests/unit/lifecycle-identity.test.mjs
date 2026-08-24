import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { freshSessionsRoot, removeRoot } from "./helpers/env.mjs";

const root = await freshSessionsRoot("csm-browse-lifecycle-");
const { holderIdentityMatches, writeCreatorArtifact, currentIdentity } =
  await import("../../lib/pid-identity.mjs");
const ports = await import("../../lib/ports.mjs");
const { createGate } = await import("../../scripts/cdp-gate.mjs");

test("holderIdentityMatches treats a recycled pid as dead and legacy artifacts as alive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-pidid-"));
  try {
    const artifact = join(dir, "daemon.pid");
    // No sidecar: legacy semantics — considered alive.
    assert.equal(await holderIdentityMatches(artifact, 12345), true);

    // Sidecar recorded for OUR process with its real starttime: alive.
    await writeFile(artifact, "12345");
    await writeCreatorArtifact(artifact);
    const me = await currentIdentity();
    assert.equal(await holderIdentityMatches(artifact, me.pid), true);

    // Same pid, forged different starttime: recycled — dead.
    const forged = JSON.stringify({ pid: me.pid, starttime: "1" });
    await writeFile(`${artifact}.creator`, forged);
    assert.equal(await holderIdentityMatches(artifact, me.pid), false);

    // Sidecar for a different claim cycle: legacy-alive.
    await writeFile(`${artifact}.creator`, JSON.stringify({ pid: 424242, starttime: "7" }));
    assert.equal(await holderIdentityMatches(artifact, me.pid), true);

    // Corrupt sidecar: fail open to legacy behavior.
    await writeFile(`${artifact}.creator`, "not-json{");
    assert.equal(await holderIdentityMatches(artifact, me.pid), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("claimedPortSet ignores crashed-creator markers past grace but honors live ones", async () => {
  const deadSid = "marker-dead";
  const liveSid = "marker-live";
  await mkdir(join(root, deadSid), { recursive: true });
  await mkdir(join(root, liveSid), { recursive: true });

  const deadMarker = join(root, deadSid, "creating.marker");
  await writeFile(deadMarker, JSON.stringify({ internal: 9224, public: 9225, pid: 999999 }));
  // Age it past the grace window.
  const old = new Date(Date.now() - 120000);
  await utimes(deadMarker, old, old);

  await writeFile(
    join(root, liveSid, "creating.marker"),
    JSON.stringify({ internal: 9226, public: 9227, pid: process.pid }),
  );

  const claimed = await ports.claimedPortSet();
  assert.equal(claimed.has(9224), false, "dead creator's pair is freed");
  assert.equal(claimed.has(9225), false, "dead creator's pub is freed");
  assert.ok(claimed.has(9226), "live creator's internal still claimed");
  assert.ok(claimed.has(9227), "live creator's public still claimed");

  await rm(join(root, deadSid), { recursive: true, force: true });
  await rm(join(root, liveSid), { recursive: true, force: true });
  await removeRoot(root);
});

test("gate close explicitly reaps a tunnel child instead of waiting for socket grace", async () => {
  const signals = [];
  const tunnel = new EventEmitter();
  tunnel.stdin = new PassThrough();
  tunnel.stdout = new PassThrough();
  tunnel.stderr = new PassThrough();
  tunnel.exitCode = null;
  tunnel.signalCode = null;
  tunnel.kill = (signal) => {
    signals.push(signal);
    tunnel.signalCode = signal;
    tunnel.exitCode = 0;
    queueMicrotask(() => tunnel.emit("close", 0, signal));
    return true;
  };
  const gate = createGate({ token: "token", openTunnel: () => tunnel });
  const port = await gate.listen();
  const client = createConnection({ host: "127.0.0.1", port });
  client.on("error", () => {});
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  client.write("GET /json/version?token=token HTTP/1.1\r\nHost: localhost\r\n\r\n");
  for (let i = 0; i < 20 && signals.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await gate.close();
  assert.deepEqual(signals, ["SIGTERM"]);
  client.destroy();
});
