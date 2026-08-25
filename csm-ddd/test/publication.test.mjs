"use strict";

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  analyzeRepository,
  publicationPaths,
  readPublishedPair,
  writeArtifacts,
} from "../lib/ddd/pipeline.mjs";

const fixtureRepo = join(import.meta.dirname, "fixtures", "repos", "sample-repo");

function outputDirectory() {
  return mkdtempSync(join(fixtureRepo, ".csm-ddd-publication-"));
}

test("publishes a complete pair through one generation boundary", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-publication" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");

    await writeArtifacts(analysis, report, graph);

    assert.ok(existsSync(report));
    assert.ok(existsSync(graph));
    assert.match(readFileSync(report, "utf8"), /run-publication/);
    assert.equal(JSON.parse(readFileSync(graph, "utf8")).runId, "run-publication");
    const pair = await readPublishedPair(report, graph);
    assert.equal(pair.ok, true);
    assert.equal(pair.pointer.runId, "run-publication");
    assert.equal(readdirSync(join(directory, ".ddd-generations")).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure after one final artifact is installed preserves the prior complete pair", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const first = await analyzeRepository({ root: fixtureRepo, runId: "run-before" });
    const replacement = await analyzeRepository({ root: fixtureRepo, runId: "run-after" });
    await writeArtifacts(first, report, graph);
    const priorReport = readFileSync(report, "utf8");
    const priorGraph = readFileSync(graph, "utf8");

    await assert.rejects(
      writeArtifacts(replacement, report, graph, { failureAt: "after-report" }),
      /injected publication failure/,
    );

    assert.equal(readFileSync(report, "utf8"), priorReport);
    assert.equal(readFileSync(graph, "utf8"), priorGraph);
    assert.equal((await readPublishedPair(report, graph)).ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure before finalization leaves neither artifact when no pair existed", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-interrupted" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");

    await assert.rejects(
      writeArtifacts(analysis, report, graph, { failureAt: "after-generation" }),
      /injected publication failure/,
    );

    assert.equal(existsSync(report), false);
    assert.equal(existsSync(graph), false);
    assert.equal(existsSync(join(directory, ".ddd-publication.lock")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed replacement preserves an incomplete prior artifact as evidence", async () => {
  const directory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-orphan" });
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    await writeArtifacts(analysis, report, graph);
    rmSync(graph);

    await assert.rejects(
      writeArtifacts(analysis, report, graph, { failureAt: "after-report" }),
      /injected publication failure/,
    );

    assert.equal(existsSync(report), false);
    assert.equal(existsSync(graph), false);
    assert.ok(readdirSync(directory).some((name) => name.includes("partial-evidence")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an active output-pair lock rejects a competing writer without deleting it", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const lock = publicationPaths(report, graph).lock;
    writeFileSync(
      lock,
      '{"format":"csm-ddd-publication-lock/1","token":"other","runId":"run-other"}\n',
    );
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-locked" });
    await assert.rejects(writeArtifacts(analysis, report, graph), /publication lock is owned/);
    assert.match(readFileSync(lock, "utf8"), /run-other/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent writers have one owner and one complete reader-visible pair", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const first = analyzeRepository({ root: fixtureRepo, runId: "run-writer-a" });
    const second = analyzeRepository({ root: fixtureRepo, runId: "run-writer-b" });
    const results = await Promise.allSettled([
      first.then((analysis) => writeArtifacts(analysis, report, graph)),
      second.then((analysis) => writeArtifacts(analysis, report, graph)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await readPublishedPair(report, graph)).ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reader consumes the immutable generation across final-file interleaving", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-reader" });
    await writeArtifacts(analysis, report, graph);
    const originalGraph = readFileSync(graph, "utf8");
    writeFileSync(graph, `${originalGraph}\n`);
    const result = await readPublishedPair(report, graph);
    assert.equal(result.ok, true);
    assert.equal(result.graph.toString(), originalGraph);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("barrier-controlled reader sees the prior generation until the pointer changes", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const first = await analyzeRepository({ root: fixtureRepo, runId: "run-barrier-before" });
    const second = await analyzeRepository({ root: fixtureRepo, runId: "run-barrier-after" });
    await writeArtifacts(first, report, graph);
    let writerReachedBoundary;
    const writerAtBoundary = new Promise((resolve) => {
      writerReachedBoundary = resolve;
    });
    let releaseWriter;
    const readerRelease = new Promise((resolve) => {
      releaseWriter = resolve;
    });
    const publishing = writeArtifacts(second, report, graph, {
      beforePointer: async () => {
        writerReachedBoundary();
        await readerRelease;
      },
    });
    await writerAtBoundary;
    const during = await readPublishedPair(report, graph);
    assert.equal(during.ok, true);
    assert.equal(during.pointer.runId, "run-barrier-before");
    releaseWriter();
    await publishing;
    assert.equal((await readPublishedPair(report, graph)).pointer.runId, "run-barrier-after");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replacement owner cannot be archived after stale recovery claims the old lock", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const lock = publicationPaths(report, graph).lock;
    writeFileSync(
      lock,
      JSON.stringify({
        format: "csm-ddd-publication-lock/1",
        token: "old",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-race-after-claim" });
    await assert.rejects(
      writeArtifacts(analysis, report, graph, {
        recoverAbandonedLock: true,
        staleLockMs: 1,
        afterStaleLockClaim: async () => {
          writeFileSync(
            lock,
            JSON.stringify({
              format: "csm-ddd-publication-lock/1",
              token: "replacement",
              createdAt: new Date().toISOString(),
            }),
          );
        },
      }),
      /changed during stale recovery/,
    );
    assert.match(readFileSync(lock, "utf8"), /replacement/);
    assert.ok(readdirSync(directory).some((name) => name.includes("abandoned-")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pointer and manifest symlinks are rejected", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-symlink" });
    await writeArtifacts(analysis, report, graph);
    const paths = publicationPaths(report, graph);
    const pointerContents = readFileSync(paths.pointer, "utf8");
    rmSync(paths.pointer);
    symlinkSync(paths.pointer + ".target", paths.pointer);
    assert.equal((await readPublishedPair(report, graph)).ok, false);
    rmSync(paths.pointer);
    writeFileSync(paths.pointer, pointerContents);
    const pointer = JSON.parse(pointerContents);
    const manifestPath = join(directory, pointer.manifest);
    const manifestContents = readFileSync(manifestPath, "utf8");
    rmSync(manifestPath);
    symlinkSync(manifestPath + ".target", manifestPath);
    assert.equal((await readPublishedPair(report, graph)).ok, false);
    rmSync(manifestPath);
    writeFileSync(manifestPath, manifestContents);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publication requires report and graph outputs in one directory", async () => {
  const directory = outputDirectory();
  const otherDirectory = outputDirectory();
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-directory" });
    await assert.rejects(
      writeArtifacts(analysis, join(directory, "report.md"), join(otherDirectory, "graph.json")),
      /one directory/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(otherDirectory, { recursive: true, force: true });
  }
});

test("publication rejects output paths outside the analyzed repository before creating parents", async () => {
  const directory = outputDirectory();
  const outside = mkdtempSync(join(tmpdir(), "csm-ddd-outside-"));
  try {
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-outside" });
    await assert.rejects(
      writeArtifacts(analysis, join(outside, "report.json"), join(outside, "graph.json")),
      /contained in the analyzed repository/,
    );
    assert.equal(readdirSync(outside).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("publication rejects output paths that escape through a symlink", async () => {
  const directory = outputDirectory();
  const outside = mkdtempSync(join(tmpdir(), "csm-ddd-symlink-target-"));
  const link = join(fixtureRepo, ".csm-ddd-output-link");
  try {
    symlinkSync(outside, link);
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-symlink-escape" });
    await assert.rejects(
      writeArtifacts(analysis, join(link, "report.json"), join(link, "graph.json")),
      /must not traverse symlinks/,
    );
    assert.equal(readdirSync(outside).length, 0);
  } finally {
    rmSync(link, { force: true });
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("explicit stale-lock recovery archives the lock and publishes", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const lock = publicationPaths(report, graph).lock;
    writeFileSync(
      lock,
      JSON.stringify({
        format: "csm-ddd-publication-lock/1",
        token: "old",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-recover" });
    await writeArtifacts(analysis, report, graph, { recoverAbandonedLock: true, staleLockMs: 1 });
    assert.equal(existsSync(lock), false);
    assert.ok(readdirSync(directory).some((name) => name.includes("abandoned-")));
    assert.equal((await readPublishedPair(report, graph)).ok, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale recovery rechecks the owner token before archival", async () => {
  const directory = outputDirectory();
  try {
    const report = join(directory, "report.md");
    const graph = join(directory, "graph.json");
    const lock = publicationPaths(report, graph).lock;
    writeFileSync(
      lock,
      JSON.stringify({
        format: "csm-ddd-publication-lock/1",
        token: "old",
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    const analysis = await analyzeRepository({ root: fixtureRepo, runId: "run-race" });
    await assert.rejects(
      writeArtifacts(analysis, report, graph, {
        recoverAbandonedLock: true,
        staleLockMs: 1,
        beforeStaleLockRecheck: async () => {
          writeFileSync(
            lock,
            JSON.stringify({
              format: "csm-ddd-publication-lock/1",
              token: "new",
              createdAt: new Date().toISOString(),
            }),
          );
        },
      }),
      /changed during stale recovery/,
    );
    assert.match(readFileSync(lock, "utf8"), /"new"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
