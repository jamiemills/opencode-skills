"use strict";

import { lstat, open, readdir, realpath } from "node:fs/promises";
import { O_NOFOLLOW, O_RDONLY } from "node:constants";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildClaim, buildEvidence } from "./contracts.mjs";
import { redactEvidenceRecords, redactText } from "./redact.mjs";
import * as gitProbe from "./git.mjs";
import { digest, loadSchemaRegistry, parseJson } from "../../../../lib/schema-runtime/index.mjs";

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist", "build"]);
const CODE_EXTS = new Set([".mjs", ".js", ".ts", ".py", ".go", ".rs"]);
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxBytes: 2_000_000,
  maxFileBytes: 1_000_000,
});

export class ExtractLimits extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractLimits";
  }
}

async function walkFiles(root, limits, state) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (state.files.length >= limits.maxFiles) return;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkFiles(full, limits, state);
      continue;
    }
    if (!entry.isFile()) continue;
    let info;
    try {
      info = await lstat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > limits.maxFileBytes) {
      state.skippedOversizeFiles += 1;
      continue;
    }
    state.bytes += info.size;
    state.files.push(full);
    state.identities.set(full, { dev: info.dev, ino: info.ino, size: info.size });
    if (state.bytes >= limits.maxBytes || state.files.length >= limits.maxFiles) return;
  }
}

function sameIdentity(actual, expected) {
  return (
    !expected ||
    (actual.dev === expected.dev && actual.ino === expected.ino && actual.size === expected.size)
  );
}

async function readStableText(path, expected = null) {
  const handle = await open(path, O_RDONLY | O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !sameIdentity(before, expected)) return null;
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    if (!sameIdentity(after, before)) return null;
    return text;
  } finally {
    await handle.close();
  }
}

function relPath(root, full) {
  return relative(root, full).split(sep).join("/");
}

const DECLARATION_RES = [
  { lang: "js", re: /export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g },
  { lang: "python", re: /^(?:def|class)\s+([A-Za-z_]\w*)/gm },
  { lang: "go", re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm },
];

function collectDeclarations(rel, text) {
  const found = [];
  for (const { lang, re } of DECLARATION_RES) {
    if (lang === "js" && !/\.[cm]?[jt]s$/.test(rel)) continue;
    if (lang === "python" && !rel.endsWith(".py")) continue;
    if (lang === "go" && !rel.endsWith(".go")) continue;
    for (const match of text.matchAll(re)) {
      found.push({ name: match[1], locator: `${lang}:${match[1]}` });
    }
  }
  return found;
}

function collectSignals(rel, text) {
  const signals = [];
  const emit = /(emit|dispatch|publish)\s*\(\s*["'`]([\w:.-]+)["'`]/g;
  for (const m of text.matchAll(emit))
    signals.push({ kind: "event-emitted", key: m[2], locator: `emit:${m[2]}` });
  const listen = /\bon\s*\(\s*["'`]([\w:.-]+)["'`]/g;
  for (const m of text.matchAll(listen))
    signals.push({ kind: "event-consumed", key: m[1], locator: `on:${m[1]}` });
  const envRead = /process\.env\.([A-Z0-9_]+)|os\.environ(?:\.get)?\(\s*["']([A-Z0-9_]+)/g;
  for (const m of text.matchAll(envRead))
    signals.push({ kind: "env", key: m[1] ?? m[2], locator: `env:${m[1] ?? m[2]}` });
  const http = /https?:\/\/[\w.-]+[:\d]*\/?[\w/.-]*/g;
  for (const m of text.matchAll(http))
    signals.push({ kind: "integration-url", key: redactText(m[0]), locator: "url" });
  const imports =
    /(?:from\s+["']([^"']+)["']|import\s+[^"']*["']([^"']+)["']|(?:import|from)\s+([\w.]+)\s+import)/g;
  for (const m of text.matchAll(imports)) {
    const target = m[1] ?? m[2] ?? m[3];
    if (target) signals.push({ kind: "consumer-import", key: target, locator: `import:${target}` });
  }
  return signals.map((signal) => ({ ...signal, path: rel }));
}

async function loadNorms(root, normsPath, claims, evidence, makeClaim) {
  const rootPath = resolve(root);
  const rejectSymlinkComponents = async (target) => {
    let current = rootPath;
    for (const component of relative(rootPath, target).split(sep).filter(Boolean)) {
      current = join(current, component);
      const info = await lstat(current).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error("explicit norms path must not contain symlinks");
    }
  };
  if (normsPath !== null && normsPath !== undefined) {
    const requested = resolve(normsPath);
    const lexicalRelative = relative(rootPath, requested);
    if (
      !lexicalRelative ||
      isAbsolute(lexicalRelative) ||
      lexicalRelative === ".." ||
      lexicalRelative.startsWith(`..${sep}`)
    )
      throw new Error("explicit norms path must be contained in the analyzed repository");
  }
  const jsonCandidate =
    normsPath === null || normsPath === undefined
      ? join(rootPath, "NORMS.json")
      : resolve(normsPath);
  if (normsPath !== null && normsPath !== undefined && /\.json$/i.test(normsPath)) {
    try {
      await rejectSymlinkComponents(jsonCandidate);
      const [realRoot, realCandidate] = await Promise.all([
        realpath(rootPath),
        realpath(jsonCandidate),
      ]);
      const realRelative = relative(realRoot, realCandidate);
      if (
        !realRelative ||
        isAbsolute(realRelative) ||
        realRelative === ".." ||
        realRelative.startsWith(`..${sep}`)
      )
        throw new Error("explicit norms path must resolve inside the analyzed repository");
    } catch (error) {
      if (
        error.message.includes("must resolve inside") ||
        error.message.includes("must not contain symlinks")
      )
        throw error;
    }
  }
  if (normsPath === null || normsPath === undefined || /\.json$/i.test(normsPath)) {
    try {
      const text = await readStableText(jsonCandidate);
      if (text !== null) {
        const value = parseJson(text);
        const registry = await loadSchemaRegistry();
        const result = registry.validate("csm-envelope/1", value);
        if (!result.valid)
          return {
            loaded: false,
            authoritative: false,
            path: relPath(root, jsonCandidate),
            code: "schema-invalid",
          };
        if (value.payloadSchema?.id !== "csm-norms/1" || value.payloadSchema.revision !== 1)
          return {
            loaded: false,
            authoritative: false,
            path: relPath(root, jsonCandidate),
            code: "schema-invalid",
          };
        const payload = value.payload;
        const expected = value.artifact.digest;
        const copy = structuredClone(payload);
        copy.artifactDigest = null;
        if (expected !== digest(payload) && expected !== digest(copy))
          return {
            loaded: false,
            authoritative: false,
            path: relPath(root, jsonCandidate),
            code: "digest-mismatch",
          };
        const id = makeClaim("norms-loaded", {
          claimKind: "term",
          status: "observed",
          subject: "NORMS.json",
          basis: "static_analysis",
          confidence: "high",
          note: "registered csm-norms/1 JSON is authoritative machine input",
        });
        evidence.push(
          buildEvidence({
            claimId: id,
            sourceKind: "norms-json",
            path: relPath(root, jsonCandidate),
            locator: "file",
            matchedKey: "csm-norms/1",
          }),
        );
        return {
          loaded: true,
          authoritative: true,
          path: relPath(root, jsonCandidate),
          schema: "csm-norms/1",
          owner: value.artifact.owner,
          runId: value.run.runId,
          digest: expected,
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        return {
          loaded: false,
          authoritative: false,
          path: relPath(root, jsonCandidate),
          code: error.code ?? "invalid-json",
        };
    }
  }
  if (normsPath !== null && normsPath !== undefined && /\.md$/i.test(normsPath))
    return {
      loaded: false,
      authoritative: false,
      historyOnly: true,
      migrationRequired: true,
      path: relPath(root, resolve(normsPath)),
      code: "migration-required",
    };
  const candidate =
    normsPath === null || normsPath === undefined ? join(rootPath, "NORMS.md") : resolve(normsPath);
  if (normsPath !== null && normsPath !== undefined) {
    try {
      const [realRoot, realCandidate] = await Promise.all([
        realpath(rootPath),
        realpath(candidate),
      ]);
      const realRelative = relative(realRoot, realCandidate);
      if (
        !realRelative ||
        isAbsolute(realRelative) ||
        realRelative === ".." ||
        realRelative.startsWith(`..${sep}`)
      ) {
        throw new Error("explicit norms path must resolve inside the analyzed repository");
      }
    } catch (error) {
      if (error.message.includes("must resolve inside")) throw error;
    }
  }
  let text;
  try {
    text = await readStableText(candidate);
    if (text === null) return { loaded: false, path: relPath(root, candidate), authentic: false };
  } catch {
    return { loaded: false, path: relPath(root, candidate), authentic: false };
  }
  const authentic =
    text.includes("Generated by csm-scan") || text.includes("## Repository Overview");
  const id = makeClaim("norms-loaded", {
    claimKind: "term",
    status: "observed",
    subject: "NORMS.md",
    basis: "norms_md",
    confidence: authentic ? "medium" : "low",
    note: authentic
      ? "authentic csm-scan markers present"
      : "untrusted: no csm-scan markers; treated as hints only",
  });
  evidence.push(
    buildEvidence({
      claimId: id,
      sourceKind: "norms-md",
      path: relPath(root, candidate),
      locator: "file",
      matchedKey: authentic ? "markers-present" : "markers-absent",
    }),
  );
  void claims;
  return {
    loaded: true,
    authoritative: false,
    path: relPath(root, candidate),
    authentic,
    historyOnly: true,
  };
}

export async function extractRepository(options = {}) {
  const root = options.root;
  if (!root || typeof root !== "string") throw new ExtractLimits("root is required");
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const state = { files: [], identities: new Map(), bytes: 0, skippedOversizeFiles: 0 };
  await walkFiles(root, limits, state);
  const truncatedByFiles = state.files.length >= limits.maxFiles;
  const truncatedByBytes = state.bytes >= limits.maxBytes;

  const inventory = {
    declarations: [],
    commands: [],
    workflows: [],
    events: [],
    states: [],
    consumers: [],
    dataSignals: [],
    integrationSignals: [],
    ownershipHints: [],
  };
  const evidence = [];
  const claims = [];
  let claimSeq = 0;
  const makeClaim = (slug, spec) => {
    claimSeq += 1;
    const claim = buildClaim({ id: `cl-${slug}-${String(claimSeq).padStart(4, "0")}`, ...spec });
    claims.push(claim);
    return claim.id;
  };

  const relFiles = state.files.map((full) => relPath(root, full));

  for (let i = 0; i < state.files.length; i += 1) {
    const full = state.files[i];
    const rel = relFiles[i];
    let text;
    try {
      text = await readStableText(full, state.identities.get(full));
      if (text === null) continue;
    } catch {
      continue;
    }
    // Text may embed absolute paths or secrets; the evidence records assembled from
    // repository content are sanitized through the redactEvidenceRecords funnel at the
    // return statement below (F2-16/F6-05).
    for (const decl of collectDeclarations(rel, text)) {
      inventory.declarations.push({ path: rel, ...decl });
    }
    for (const signal of collectSignals(rel, text)) {
      if (signal.kind === "event-emitted" || signal.kind === "event-consumed")
        inventory.events.push(signal);
      else if (signal.kind === "consumer-import") inventory.consumers.push(signal);
      else if (signal.kind === "env") inventory.dataSignals.push(signal);
      else if (signal.kind === "integration-url") inventory.integrationSignals.push(signal);
    }
    const base = rel.split("/").pop();
    if (base === "package.json") {
      try {
        const pkg = JSON.parse(text);
        for (const [name] of Object.entries(pkg.scripts ?? {}))
          inventory.commands.push({ path: rel, name, locator: `script:${name}` });
      } catch {
        /* unparseable package.json is not fatal */
      }
    }
    if (base === "Makefile") {
      for (const m of text.matchAll(/^([a-zA-Z][\w-]*):(?:[^=]|$)/gm))
        inventory.commands.push({ path: rel, name: m[1], locator: `make:${m[1]}` });
      inventory.workflows.push({ path: rel, key: "Makefile targets", locator: "make" });
    }
    if (base === "CODEOWNERS") {
      const handles = new Set();
      for (const m of text.matchAll(/@[\w.-]+/g)) handles.add(m[0]);
      inventory.ownershipHints.push({ path: rel, owners: handles.size, locator: "codeowners" });
    }
    if (/state[-.]?machine/i.test(base) || /\bSTATES\b|\bfsm\b/i.test(text.slice(0, 4000))) {
      inventory.states.push({ path: rel, key: base, locator: `state-file:${base}` });
    }
  }

  if (relFiles.some((f) => f.startsWith(".github/workflows/"))) {
    inventory.workflows.push({ path: ".github/workflows/", key: "CI workflows", locator: "ci" });
  }

  const capped = truncatedByFiles || truncatedByBytes;
  const coverageStatus = capped ? "unverified" : "observed";
  const oversizeNote =
    state.skippedOversizeFiles > 0
      ? `; skipped ${state.skippedOversizeFiles} file(s) exceeding maxFileBytes=${limits.maxFileBytes}`
      : "";
  const capNote = capped
    ? `coverage capped at maxFiles=${limits.maxFiles}/maxBytes=${limits.maxBytes}; scanned ${state.files.length} files/${state.bytes} bytes${oversizeNote}`
    : `complete bounded scan: ${state.files.length} files/${state.bytes} bytes${oversizeNote}`;

  const invId = makeClaim("inventory", {
    claimKind: "capability",
    status: coverageStatus,
    subject: "repository-inventory",
    basis: "static_analysis",
    confidence: capped ? "low" : "high",
    note: capNote,
    evidenceIds: [],
  });

  const declEvidencePath =
    relFiles.find((f) => CODE_EXTS.has(f.slice(f.lastIndexOf(".")))) ?? relFiles[0];
  if (declEvidencePath) {
    const ev = buildEvidence({
      claimId: invId,
      sourceKind: "walk",
      path: declEvidencePath,
      locator: capped ? "bounded-walk:capped" : "bounded-walk:complete",
      matchedKey: `${inventory.declarations.length}-declarations`,
    });
    evidence.push(ev);
    claims.find((c) => c.id === invId).evidenceIds.push(ev.id);
  }

  const norms = await loadNorms(root, options.normsPath ?? null, claims, evidence, makeClaim);

  let git = null;
  if (await gitProbe.isGitRepository(root)) {
    try {
      const summary = await gitProbe.authorshipSummary(root);
      const pairs = await gitProbe.coChangePairs(root);
      const count = await gitProbe.commitCount(root);
      const head = await gitProbe.headCommit(root);
      const gid = makeClaim("git-history", {
        claimKind: "workflow",
        status: "observed",
        subject: "git-history",
        basis: "git_history",
        confidence: "medium",
        note: `${count} commits, ${summary.authors} authors (aggregate only), ${pairs.length} co-change pairs`,
      });
      const gev = buildEvidence({
        claimId: gid,
        sourceKind: "git-log",
        path: relFiles[0] ?? ".",
        locator: `git:head=${head?.slice(0, 12)}`,
        matchedKey: `commits:${count}`,
      });
      evidence.push(gev);
      claims.find((c) => c.id === gid).evidenceIds.push(gev.id);
      git = {
        available: true,
        head,
        commitCount: count,
        authorship: summary,
        coChangePairs: pairs,
      };
    } catch (error) {
      git = {
        available: false,
        reason: error instanceof gitProbe.GitUnavailableError ? "git-unavailable" : "git-error",
      };
      makeClaim("git-history", {
        claimKind: "workflow",
        status: "unverified",
        subject: "git-history",
        basis: "git_history",
        confidence: "low",
        note: "git inspection failed; history evidence unverified",
      });
    }
  } else {
    git = { available: false, reason: "not-a-git-repository" };
  }

  // Privacy funnel (F2-16/F6-05): every assembled evidence record is redacted here,
  // immediately before records are returned toward artifact assembly.
  const redactedEvidence = redactEvidenceRecords(evidence);

  return {
    root,
    caps: {
      maxFiles: limits.maxFiles,
      maxBytes: limits.maxBytes,
      maxFileBytes: limits.maxFileBytes,
      filesScanned: state.files.length,
      bytesScanned: state.bytes,
      skippedOversizeFiles: state.skippedOversizeFiles,
      truncatedByFiles,
      truncatedByBytes,
      disclosedIn: "claims[subject=repository-inventory].note",
    },
    files: relFiles,
    inventory,
    claims,
    evidence: redactedEvidence,
    norms,
    git,
  };
}
