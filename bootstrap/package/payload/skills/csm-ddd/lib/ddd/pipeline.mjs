"use strict";

import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { extractRepository } from "./extract.mjs";
import { synthesize } from "./synthesize.mjs";
import {
  applyQuestionFile,
  deriveQuestions,
  MAX_QUESTION_FILE_BYTES,
  nonInteractiveGaps,
  preflightQuestionFileText,
} from "./clarify.mjs";
import {
  buildGraphEnvelopeObject,
  buildReportEnvelopeObject,
  parseReport,
  renderReport,
  serializeReport,
} from "./render.mjs";
import {
  assertReportContract,
  assertPairRunId,
  buildPairDescriptor,
  DDD_PRODUCER_DESCRIPTOR,
  serializeGraph,
  validateGraphReferences,
} from "./contracts.mjs";
import { validateGraph, validateReport } from "./validate.mjs";
import { loadSchemaRegistry } from "../../../../lib/schema-runtime/index.mjs";
import {
  atomicWrite,
  readDurableBytes,
  readDurableJson,
  syncDirectory,
} from "../../../../lib/durable-json/index.mjs";

export async function analyzeRepository(options = {}) {
  const root = options.root;
  if (!root || typeof root !== "string") throw new Error("root is required");
  const runId = options.runId ?? `run-${randomUUID()}`;
  const generatedAt = options.now ?? new Date().toISOString();
  const extraction = await extractRepository({
    root,
    normsPath: options.normsPath ?? null,
    limits: options.limits,
  });
  const synthesis = synthesize(extraction);
  const questions = deriveQuestions(synthesis);

  let answers = [];
  let answerClaims = [];
  let answerEvidence = [];
  let appliedRecords = [];
  let rejectedRecords = [];
  if (options.questionFilePath) {
    const { open, stat } = await import("node:fs/promises");
    const questionStat = await stat(options.questionFilePath);
    if (!questionStat.isFile()) throw new Error("question file must be a regular file");
    if (questionStat.size > MAX_QUESTION_FILE_BYTES)
      throw new Error(`question file exceeds ${MAX_QUESTION_FILE_BYTES} bytes`);
    const questionHandle = await open(options.questionFilePath, "r");
    let fileText;
    try {
      const currentStat = await questionHandle.stat();
      if (!currentStat.isFile()) throw new Error("question file must be a regular file");
      if (currentStat.size > MAX_QUESTION_FILE_BYTES)
        throw new Error(`question file exceeds ${MAX_QUESTION_FILE_BYTES} bytes`);
      const buffer = Buffer.allocUnsafe(MAX_QUESTION_FILE_BYTES + 1);
      const { bytesRead } = await questionHandle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_QUESTION_FILE_BYTES)
        throw new Error(`question file exceeds ${MAX_QUESTION_FILE_BYTES} bytes`);
      fileText = preflightQuestionFileText(buffer.subarray(0, bytesRead).toString("utf8"));
    } finally {
      await questionHandle.close();
    }
    const { parseJson } = await import("../../../../lib/schema-runtime/index.mjs");
    const fileData = parseJson(fileText);
    const replay = applyQuestionFile(
      questions,
      fileData,
      [...extraction.claims, ...synthesis.claims],
      basename(options.questionFilePath),
    );
    answers = replay.applied;
    answerClaims = replay.claims;
    answerEvidence = replay.evidence;
    appliedRecords = replay.applied;
    rejectedRecords = replay.rejected;
  }

  const gaps = nonInteractiveGaps(questions, answers);
  const clarification = {
    questions,
    answers,
    claims: answerClaims,
    evidence: answerEvidence,
    gaps,
    rejected: rejectedRecords,
    answerCount: appliedRecords.length,
  };

  const repoName = basename(root);
  const reportMarkdown = renderReport({
    runId,
    generatedAt,
    repoName,
    extraction,
    synthesis,
    clarification,
  });
  const graphObject = buildGraphEnvelopeObject({
    runId,
    generatedAt,
    extraction,
    synthesis,
    clarification,
  });
  const reportObject = buildReportEnvelopeObject({
    runId,
    generatedAt,
    repoName,
    extraction,
    synthesis,
    clarification,
  });
  const reportJson = serializeReport(reportObject);
  const reportCheck = await validateReport(reportObject);
  const graphCheck = await validateGraph(graphObject);
  const registeredGraphCheck = (await loadSchemaRegistry()).validate(
    "csm-ddd-graph/1",
    graphObject,
  );
  if (!reportCheck.ok || !graphCheck.ok || !registeredGraphCheck.valid) {
    throw new Error(
      `DDD producer generated an invalid pair: ${[
        ...reportCheck.errors,
        ...graphCheck.errors,
        ...registeredGraphCheck.errors,
      ].join("; ")}`,
    );
  }
  assertReportContract(reportObject, graphObject);
  return {
    runId,
    rootPath: resolve(root),
    generatedAt,
    repoName,
    reportMarkdown,
    reportObject,
    reportJson,
    graphObject,
    graphJson: serializeGraph(graphObject),
    parsedReport: parseReport(reportMarkdown),
    producerDescriptor: DDD_PRODUCER_DESCRIPTOR,
    questions,
    gaps,
    clarification,
    extraction,
    synthesis,
  };
}

export function defaultArtifactPaths(root, runId = "current") {
  const date = new Date().toISOString().slice(0, 10);
  const slug = basename(root);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId))
    throw new Error("runId is not safe for a DDD artifact path");
  const identity = runId;
  return {
    outReport: join(root, ".agents", "ddd", `${date}-${slug}-${identity}-ddd-report.json`),
    outGraph: join(root, ".agents", "ddd", `${date}-${slug}-${identity}-ddd-graph.json`),
  };
}

export function publicationPaths(outReport, outGraph) {
  const reportDir = dirname(outReport);
  return {
    pointer: join(reportDir, ".ddd-publication.json"),
    lock: join(reportDir, ".ddd-publication.lock"),
    recoveryLock: join(reportDir, ".ddd-publication.recovery.lock"),
    generationRoot: join(reportDir, ".ddd-generations"),
    outReport,
    outGraph,
  };
}

async function assertContainedOutputPaths(root, outputPaths) {
  if (!root || typeof root !== "string") throw new Error("analyzed repository root is required");
  const rootPath = resolve(root);
  const { lstat, realpath } = await import("node:fs/promises");
  const realRoot = await realpath(rootPath);
  const checked = new Set();
  for (const outputPath of outputPaths) {
    if (typeof outputPath !== "string" || !isAbsolute(outputPath))
      throw new Error("publication paths must be absolute");
    const lexicalRelative = relative(rootPath, resolve(outputPath));
    if (
      !lexicalRelative ||
      isAbsolute(lexicalRelative) ||
      lexicalRelative === ".." ||
      lexicalRelative.startsWith(`..${sep}`)
    )
      throw new Error("publication output paths must be contained in the analyzed repository");

    let current = rootPath;
    for (const part of lexicalRelative.split(sep)) {
      current = join(current, part);
      if (checked.has(current)) continue;
      checked.add(current);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
      if (info.isSymbolicLink())
        throw new Error("publication output paths must not traverse symlinks");
    }
  }
  let existingParent = dirname(outputPaths[0]);
  while (true) {
    try {
      await lstat(existingParent);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existingParent);
      if (parent === existingParent)
        throw new Error("publication output parent does not exist", { cause: error });
      existingParent = parent;
    }
  }
  const realOutputRoot = await realpath(existingParent);
  const realRelative = relative(realRoot, realOutputRoot);
  if (isAbsolute(realRelative) || realRelative === ".." || realRelative.startsWith(`..${sep}`))
    throw new Error("publication output paths must resolve inside the analyzed repository");
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(file) {
  return readDurableJson(file);
}

export async function readPublishedPair(outReport, outGraph, root = null) {
  const { lstat } = await import("node:fs/promises");
  const paths = publicationPaths(outReport, outGraph);
  const fail = (message) => ({ ok: false, errors: [message], paths });
  try {
    if (root)
      await assertContainedOutputPaths(root, [outReport, outGraph, ...Object.values(paths)]);
    if (dirname(outReport) !== dirname(outGraph))
      return fail("published output pair must use one directory");
    const pointerInfo = await lstat(paths.pointer);
    if (pointerInfo.isSymbolicLink() || !pointerInfo.isFile())
      return fail("publication pointer must be a regular file");
    const pointer = await readJson(paths.pointer);
    if (pointer.format !== "csm-ddd-publication-pointer/1")
      return fail("publication pointer has an unsupported format");
    if (pointer.report !== basename(outReport) || pointer.graph !== basename(outGraph))
      return fail("publication pointer output pair does not match requested paths");
    if (
      typeof pointer.manifest !== "string" ||
      isAbsolute(pointer.manifest) ||
      pointer.manifest.includes("..")
    )
      return fail("publication pointer manifest path is unsafe");
    const manifestPath = join(dirname(paths.pointer), pointer.manifest);
    const manifestInfo = await lstat(manifestPath);
    if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile())
      return fail("publication manifest must be a regular file");
    const manifest = await readJson(manifestPath);
    if (manifest.format !== "csm-ddd-publication/1" || manifest.runId !== pointer.runId)
      return fail("publication manifest and pointer runId do not match");
    if (manifest.report !== basename(outReport) || manifest.graph !== basename(outGraph))
      return fail("publication manifest output pair does not match requested paths");
    if (
      manifest.reportSha256 !== pointer.reportSha256 ||
      manifest.graphSha256 !== pointer.graphSha256
    )
      return fail("publication manifest and pointer digests do not match");
    if (
      manifest.producer?.format !== "csm-ddd-producer/1" ||
      manifest.producer.runId !== manifest.runId ||
      manifest.producer.report?.sha256 !== manifest.reportSha256 ||
      manifest.producer.graph?.sha256 !== manifest.graphSha256
    )
      return fail("publication producer descriptor does not match pair identity or digests");
    if (
      typeof manifest.generation !== "string" ||
      isAbsolute(manifest.generation) ||
      manifest.generation.includes("..") ||
      !manifest.generation.startsWith(".ddd-generations/")
    )
      return fail("publication manifest generation path is unsafe");
    const generationDir = join(dirname(paths.pointer), manifest.generation);
    for (const file of [
      generationDir,
      join(generationDir, "report.artifact"),
      join(generationDir, "graph.artifact"),
    ]) {
      const info = await lstat(file);
      if (
        info.isSymbolicLink() ||
        (!info.isDirectory() && file === generationDir) ||
        (!info.isFile() && file !== generationDir)
      )
        return fail("immutable generation contains an unsafe file type");
    }
    const generationReport = await readDurableBytes(join(generationDir, "report.artifact"));
    const generationGraph = await readDurableBytes(join(generationDir, "graph.artifact"));
    if (
      sha256(generationReport) !== manifest.reportSha256 ||
      sha256(generationGraph) !== manifest.graphSha256
    )
      return fail("immutable generation digest does not match its manifest");
    const { parseJson } = await import("../../../../lib/schema-runtime/index.mjs");
    const report = parseJson(generationReport.toString("utf8"));
    const graph = parseJson(generationGraph.toString("utf8"));
    try {
      assertPairRunId(manifest.runId, report, graph);
    } catch (error) {
      return fail(`published artifacts do not match manifest runId: ${error.message}`);
    }
    const [reportCheck, graphCheck] = await Promise.all([
      validateReport(report),
      validateGraph(graph),
    ]);
    if (!reportCheck.ok || !graphCheck.ok)
      return fail("published generation contains a schema-invalid report/graph");
    const references = validateGraphReferences(graph);
    if (!references.ok)
      return fail(`published graph has dangling references: ${references.errors.join("; ")}`);
    try {
      assertReportContract(report, graph);
    } catch (error) {
      return fail(`published report references are invalid: ${error.message}`);
    }
    return {
      ok: true,
      pointer,
      manifest,
      report: generationReport,
      graph: generationGraph,
      reportObject: report,
      graphObject: graph,
      paths,
    };
  } catch (error) {
    return fail(`published output pair is not valid: ${error.message}`);
  }
}

export async function writeArtifacts(analysis, outReport, outGraph, options = {}) {
  const { access, lstat, mkdir, rename } = await import("node:fs/promises");
  const paths = publicationPaths(outReport, outGraph);
  const reportDir = dirname(outReport);
  const graphDir = dirname(outGraph);

  if (outReport === outGraph) throw new Error("report and graph paths must differ");
  if (reportDir !== graphDir) throw new Error("publication output pair must use one directory");

  if (!isAbsolute(outReport) || !isAbsolute(outGraph))
    throw new Error("publication paths must be absolute");
  await assertContainedOutputPaths(analysis.rootPath ?? options.root, [
    outReport,
    outGraph,
    ...Object.values(paths),
  ]);
  await mkdir(reportDir, { recursive: true });
  await mkdir(graphDir, { recursive: true });
  const token = randomUUID();
  let recoveryHandle;
  let lockHandle;
  let recoveryStat;
  let lockStat;
  try {
    const { open } = await import("node:fs/promises");
    recoveryHandle = await open(paths.recoveryLock, "wx");
    recoveryStat = await lstat(paths.recoveryLock);
    await recoveryHandle.writeFile(
      `${JSON.stringify({ format: "csm-ddd-recovery-lock/1", token })}\n`,
    );
    lockHandle = await open(paths.lock, "wx");
    lockStat = await lstat(paths.lock);
    await lockHandle.writeFile(
      `${JSON.stringify({ format: "csm-ddd-publication-lock/1", token, runId: analysis.runId, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
    );
  } catch (error) {
    const hadRecoveryHandle = Boolean(recoveryHandle);
    if (recoveryHandle && !lockHandle) {
      await recoveryHandle.close().catch(() => {});
      await (await import("node:fs/promises")).rm(paths.recoveryLock, { force: true });
      recoveryHandle = undefined;
    }
    if (error.code === "EEXIST" && hadRecoveryHandle && options.recoverAbandonedLock) {
      const lock = await readJson(paths.lock).catch(() => null);
      const age = lock?.createdAt ? Date.now() - Date.parse(lock.createdAt) : 0;
      if (lock && age >= (options.staleLockMs ?? 60_000)) {
        await options.beforeStaleLockRecheck?.(lock);
        const candidate = `${paths.lock}.stale-candidate-${randomUUID()}`;
        try {
          // Claim the exact inode before any replacement owner can be archived.
          await rename(paths.lock, candidate);
        } catch (claimError) {
          throw new Error(`DDD publication lock changed during stale recovery: ${paths.lock}`, {
            cause: claimError,
          });
        }
        await options.afterStaleLockClaim?.({ candidate, lock });
        const claimed = await readJson(candidate).catch(() => null);
        if (!claimed || claimed.token !== lock.token) {
          if (
            !(await access(paths.lock).then(
              () => true,
              () => false,
            ))
          )
            await rename(candidate, paths.lock);
          throw new Error(`DDD publication lock changed during stale recovery: ${paths.lock}`, {
            cause: error,
          });
        }
        await rename(candidate, `${paths.lock}.abandoned-${Date.now()}-${randomUUID()}`);
        if (
          await access(paths.lock).then(
            () => true,
            () => false,
          )
        ) {
          throw new Error(`DDD publication lock changed during stale recovery: ${paths.lock}`, {
            cause: error,
          });
        }
        return writeArtifacts(analysis, outReport, outGraph, {
          ...options,
          recoverAbandonedLock: false,
        });
      }
    }
    throw new Error(`DDD publication lock is owned by another or abandoned writer: ${paths.lock}`, {
      cause: error,
    });
  }
  const generation = join(paths.generationRoot, `${analysis.runId}-${token}`);
  const stagedReport = join(generation, "report.artifact");
  const stagedGraph = join(generation, "graph.artifact");
  const manifestPath = join(generation, "manifest.json");
  const pairManifest = {
    format: "csm-ddd-publication/1",
    runId: analysis.runId,
    report: basename(outReport),
    graph: basename(outGraph),
    reportSha256: sha256(analysis.reportJson),
    graphSha256: sha256(analysis.graphJson),
    generation: relative(reportDir, generation),
  };
  try {
    assertPairRunId(analysis.runId, analysis.reportObject, analysis.graphObject);
  } catch (error) {
    throw new Error(`DDD publication identity mismatch: ${error.message}`, { cause: error });
  }
  const descriptor = buildPairDescriptor({
    runId: analysis.runId,
    report: relative(analysis.rootPath ?? options.root, outReport),
    graph: relative(analysis.rootPath ?? options.root, outGraph),
    reportSha256: pairManifest.reportSha256,
    graphSha256: pairManifest.graphSha256,
    manifest: relative(analysis.rootPath ?? options.root, manifestPath),
  });
  pairManifest.producer = descriptor;
  const backups = [`${outReport}.prior-${token}`, `${outGraph}.prior-${token}`];
  const installed = [];

  const exists = async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };
  const inject = (point) => {
    if (options.failureAt === point) throw new Error(`injected publication failure at ${point}`);
  };
  const priorPair =
    (await exists(outReport)) &&
    (await exists(outGraph)) &&
    (await readPublishedPair(outReport, outGraph, analysis.rootPath ?? options.root)).ok;

  try {
    await mkdir(paths.generationRoot, { recursive: true });
    await mkdir(generation);
    await atomicWrite(stagedReport, analysis.reportJson, { root: reportDir });
    await atomicWrite(stagedGraph, analysis.graphJson, { root: reportDir });
    await atomicWrite(manifestPath, `${JSON.stringify(pairManifest, null, 2)}\n`, {
      root: reportDir,
    });
    await syncDirectory(generation);
    await syncDirectory(paths.generationRoot);
    inject("after-generation");
    await options.afterGeneration?.({ generation, manifestPath });

    for (let i = 0; i < 2; i += 1) {
      const target = i === 0 ? outReport : outGraph;
      if (await exists(target)) await rename(target, backups[i]);
    }
    if (!priorPair) {
      for (const backup of backups) {
        if (await exists(backup)) {
          const partial = `${backup}.partial-evidence`;
          await rename(backup, partial);
        }
      }
    }
    inject("after-backup");

    await atomicWrite(outReport, await readDurableBytes(stagedReport), { root: reportDir });
    installed.push(outReport);
    inject("after-report");
    await atomicWrite(outGraph, await readDurableBytes(stagedGraph), { root: reportDir });
    installed.push(outGraph);
    inject("after-graph");
    await options.beforePointer?.({ generation, manifestPath });

    const pointer = {
      format: "csm-ddd-publication-pointer/1",
      runId: analysis.runId,
      report: basename(outReport),
      graph: basename(outGraph),
      manifest: relative(reportDir, manifestPath),
      reportSha256: pairManifest.reportSha256,
      graphSha256: pairManifest.graphSha256,
    };
    await atomicWrite(paths.pointer, `${JSON.stringify(pointer, null, 2)}\n`, { root: reportDir });
    return {
      outReport,
      outGraph,
      pointer: paths.pointer,
      manifest: manifestPath,
      generation,
      descriptor,
    };
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    for (const target of installed) await rm(target, { force: true });
    for (let i = 0; i < 2; i += 1) {
      if (priorPair && (await exists(backups[i]))) {
        const target = i === 0 ? outReport : outGraph;
        await rename(backups[i], target);
      }
    }
    await syncDirectory(reportDir);
    throw error;
  } finally {
    await lockHandle?.close();
    const currentLock = await readJson(paths.lock).catch(() => null);
    const currentLockStat = await lstat(paths.lock).catch(() => null);
    if (
      currentLock?.token === token &&
      currentLockStat?.isFile() &&
      currentLockStat.dev === lockStat?.dev &&
      currentLockStat.ino === lockStat?.ino
    )
      await (await import("node:fs/promises")).rm(paths.lock, { force: true });
    await recoveryHandle?.close();
    const currentRecoveryLock = await readJson(paths.recoveryLock).catch(() => null);
    const currentRecoveryStat = await lstat(paths.recoveryLock).catch(() => null);
    if (
      currentRecoveryLock?.token === token &&
      currentRecoveryStat?.isFile() &&
      currentRecoveryStat.dev === recoveryStat?.dev &&
      currentRecoveryStat.ino === recoveryStat?.ino
    )
      await (await import("node:fs/promises")).rm(paths.recoveryLock, { force: true });
  }
}
