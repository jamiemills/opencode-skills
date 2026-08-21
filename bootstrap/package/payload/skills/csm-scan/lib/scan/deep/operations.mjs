import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { commandBroker } from "../shared/command.mjs";
import { readManifest } from "../shared/manifest.mjs";
import { MONITORING_LIBS, matchDep } from "../shared/detection.mjs";
import { readBoundedFile } from "../shared/reads.mjs";

// Bounds for the direct-read replacements of the former rg pipelines.
const SCAN_FILE_LIMIT = 400;
const SCAN_BYTE_LIMIT = 1024 * 1024;

// Step-level practice-tool scan bounds. The step scan is deliberately
// shallower than the job/trigger inventory (which stays byte-identical): any
// workflow above these caps degrades to `unverified` rather than reporting a
// partial (and possibly misleadingly empty) tool set.
const STEP_SCAN_BYTE_LIMIT = 256 * 1024;
const STEP_SCAN_LINE_LIMIT = 4000;

// Practice tools recognised at workflow-step level. Keys are canonical tool
// ids; each regex is a bounded literal (word-boundary anchored) so step names,
// `run:` commands and `uses:` action names are matched without backtracking
// risk. Block scalars under `run:` are simply deeper-indented lines to the
// line-based extraction below, so they never throw.
const STEP_TOOL_PATTERNS = [
  { tool: "actionlint", re: /\bactionlint\b/ },
  { tool: "bandit", re: /\bbandit\b/ },
  { tool: "coverage", re: /(?:pytest-cov|\bcoverage\b|--cov)/ },
  { tool: "diff-cover", re: /\bdiff-cover\b/ },
  { tool: "gitleaks", re: /\bgitleaks\b/ },
  { tool: "mutmut", re: /\bmutmut\b/ },
  { tool: "mypy", re: /\bmypy\b/ },
  { tool: "pip-audit", re: /\bpip-audit\b/ },
  { tool: "pyright", re: /\bpyright\b/ },
  { tool: "ruff", re: /\bruff\b/ },
  { tool: "safety", re: /\bsafety\b/ },
  { tool: "scorecard", re: /\bscorecard\b/ },
  { tool: "semgrep", re: /\bsemgrep\b/ },
  { tool: "stryker", re: /\bstryker\b/ },
];

async function listFiles(repoPath, overview, broker) {
  const fromOverview =
    overview && Array.isArray(overview.files) && overview.files.length > 0 ? overview.files : null;
  if (fromOverview) return fromOverview;
  try {
    const result = await broker.execute("rg:files", { cwd: repoPath });
    const raw = result.ok || result.noMatch ? result.stdout : "";
    return raw
      .split("\n")
      .map((s) => s.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .toSorted();
  } catch {
    return [];
  }
}

// F-022/F-062: bounded whole-file read shared across the deep scanners. A file
// above the byte bound is never allocated; `containmentRoot` optionally
// enforces realpath containment for well-known-file reads (F-023).
function readContent(absPath, containmentRoot = null) {
  return readBoundedFile(absPath, { byteLimit: SCAN_BYTE_LIMIT, containmentRoot });
}

// ---------------------------------------------------------------------------
// GitHub Actions workflow parsing (regex-based, NOT a YAML parser)
//
// parseYamlShallow THROWS on block scalars (`|`/`>`) which are ubiquitous in
// `run:` steps, so workflow files are parsed with targeted regex instead. All
// parsing is scoped to a single top-level (column-0) subtree to avoid
// misclassifying `permissions:`/`concurrency:`/`env:` keys (or their children
// like `contents:`/`group:`) as jobs.
// ---------------------------------------------------------------------------

// Return the lines between a top-level `key:` line and the next column-0 key
// (or EOF). The key may be quoted (`'on':` / `"on":`) as GitHub Actions
// commonly quotes `on:`/`jobs:` to dodge YAML 1.1 boolean coercion.
function extractTopSubtree(content, key) {
  const lines = String(content).split(/\r?\n/);
  const keyRe = new RegExp(`^['"]?${key}['"]?:[ \\t]*(?:#.*)?$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    out.push(lines[i]);
  }
  return out.join("\n");
}

// Job ids are the direct children of the `jobs:` mapping (exactly 2-space
// indent). Job ids allow letters, digits, `-` and `_`, so `[\w-]+` is used
// (a bare `\w+` would silently drop hyphenated ids like `secret-scan`).
function extractJobNames(content) {
  const subtree = extractTopSubtree(content, "jobs");
  const names = [];
  for (const m of subtree.matchAll(/^  ([\w-]+):/gm)) names.push(m[1]);
  return names;
}

// Trigger event names from `on:`. Handles:
//   - inline scalar:   `on: push`
//   - inline flow seq: `on: [push, pull_request]`
//   - inline flow map: `on: {push: ..., pull_request: ...}`
//   - block mapping:   `on:\n  push:\n  pull_request:`
//   - block sequence:  `on:\n  - push\n  - pull_request`
function extractOnTriggers(content) {
  const triggers = new Set();
  const src = String(content);
  const onLine = src.match(/^['"]?on['"]?:[ \t]*([^\n#]*)/m);
  if (onLine) {
    const inline = onLine[1].trim();
    if (inline) {
      if (inline.startsWith("[")) {
        const inner = inline.slice(1, inline.lastIndexOf("]"));
        for (const part of inner.split(",")) {
          const t = part.trim().replace(/^['"]|['"]$/g, "");
          if (t) triggers.add(t);
        }
        return triggers;
      }
      if (inline.startsWith("{")) {
        const inner = inline.slice(1, inline.lastIndexOf("}"));
        for (const part of inner.split(",")) {
          const k = part
            .split(":")[0]
            .trim()
            .replace(/^['"]|['"]$/g, "");
          if (k) triggers.add(k);
        }
        return triggers;
      }
      triggers.add(inline.replace(/^['"]|['"]$/g, ""));
      return triggers;
    }
  }
  const subtree = extractTopSubtree(src, "on");
  for (const m of subtree.matchAll(/^  ([\w-]+):/gm)) triggers.add(m[1]);
  for (const m of subtree.matchAll(/^  -[ \t]+([^\s]+)/gm)) {
    const t = m[1].replace(/^['"]|['"]$/g, "");
    if (t) triggers.add(t);
  }
  return triggers;
}

// Collect the `steps:` blocks of every GitHub Actions job as raw text. Job ids
// are the 2-space-indented keys of the `jobs:` subtree; within each job block
// a 4-space `steps:` key opens a block that closes at the next 4-space key.
// Step list items (6-space `- ...`) and block-scalar bodies (8+ spaces) all
// survive the extraction, so `run: |`-style commands stay scannable.
function collectJobStepLines(jobBlock) {
  const stepLines = [];
  let inSteps = false;
  for (const line of jobBlock) {
    if (line.startsWith("    steps:")) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    if (/^    \S/.test(line)) break; // next 4-space key closes the steps block
    stepLines.push(line);
  }
  return stepLines;
}

function extractStepsBlocks(content) {
  const jobsSubtree = extractTopSubtree(content, "jobs");
  if (!jobsSubtree) return "";
  const lines = jobsSubtree.split(/\r?\n/);
  const jobBlocks = [];
  let current = null;
  for (const line of lines) {
    if (/^  [\w-]+:/.test(line)) {
      current = [line];
      jobBlocks.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  const stepLines = [];
  for (const jobBlock of jobBlocks) {
    stepLines.push(...collectJobStepLines(jobBlock));
  }
  return stepLines.join("\n");
}

// Return the sorted unique tool ids detected across a workflow's steps.
function scanWorkflowSteps(content) {
  const steps = extractStepsBlocks(content);
  const found = new Set();
  for (const { tool, re } of STEP_TOOL_PATTERNS) {
    if (re.test(steps)) found.add(tool);
  }
  return [...found].toSorted();
}

// ---------------------------------------------------------------------------
// Workflow anatomy: pins, permissions, per-job semantics, concurrency.
//
// Everything here is DECLARATION-backed: the `if:` / `continue-on-error` /
// `needs:` facts report what the workflow declares, never verified runtime
// enforcement. Parsing stays regex/line-based (the shared shallow YAML parser
// throws on the block scalars under `run:`), and all emitted tokens are
// bounded projection values (no full SHAs, no URLs).
// ---------------------------------------------------------------------------

const SHA40_RE = /^[0-9a-f]{40}$/i;

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractWorkflowName(content) {
  const match = String(content).match(/^name:[ \t]*(.+)$/m);
  return match ? stripQuotes(match[1].trim()) : null;
}

// Top-level `permissions:` as a bounded scope -> value map. Scalar forms
// (`permissions: read-all`) collapse to a single `all` key.
function extractWorkflowPermissions(content) {
  const src = String(content);
  const inlineMatch = src.match(/^permissions:[ \t]*(.+)$/m);
  if (inlineMatch) {
    const value = inlineMatch[1].trim();
    if (!value || value === "{}") return {};
    const token = stripQuotes(value);
    if (["read", "write", "read-all", "write-all", "none"].includes(token)) return { all: token };
    return null;
  }
  const subtree = extractTopSubtree(src, "permissions");
  if (!subtree) return null;
  const map = {};
  for (const line of subtree.split(/\r?\n/)) {
    const match = line.match(/^ {2}([\w-]+):[ \t]*(.*)$/);
    if (match) map[match[1]] = stripQuotes(match[2].trim());
  }
  return Object.keys(map).length ? map : null;
}

// Top-level `concurrency:` block: group + cancel-in-progress.
function extractWorkflowConcurrency(content) {
  const src = String(content);
  const inlineMatch = src.match(/^concurrency:[ \t]*(.+)$/m);
  if (inlineMatch && inlineMatch[1].trim()) {
    const group = stripQuotes(inlineMatch[1].trim());
    return group ? { group, cancelInProgress: null } : null;
  }
  const subtree = extractTopSubtree(src, "concurrency");
  if (!subtree) return null;
  let group = null;
  let cancel = null;
  for (const line of subtree.split(/\r?\n/)) {
    const groupMatch = line.match(/^ {2}group:[ \t]*(.*)$/);
    if (groupMatch) group = groupMatch[1].trim() ? stripQuotes(groupMatch[1].trim()) : null;
    const cancelMatch = line.match(/^ {2}cancel-in-progress:[ \t]*(.+)$/);
    if (cancelMatch) cancel = /^true$/i.test(cancelMatch[1].trim());
  }
  if (group === null && cancel === null) return null;
  return { group, cancelInProgress: cancel };
}

// Split the `jobs:` subtree into per-job blocks (job ids sit at 2-space).
function splitJobBlocks(subtree) {
  const blocks = [];
  let current = null;
  for (const line of subtree.split(/\r?\n/)) {
    if (/^ {2}[\w-]+:/.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return blocks;
}

// Group a job block into (key, lines) sections at 4-space indent; continuation
// lines keep their original leading whitespace for the nested parsers.
function jobPropertySections(block) {
  const sections = [];
  let currentKey = null;
  let currentLines = [];
  for (const line of block) {
    const match = line.match(/^ {4}([\w-]+):(.*)$/);
    if (match) {
      if (currentKey) sections.push({ key: currentKey, lines: currentLines });
      currentKey = match[1];
      currentLines = [match[2]];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  if (currentKey) sections.push({ key: currentKey, lines: currentLines });
  return sections;
}

function inlineScalar(lines) {
  const value = (lines[0] ?? "").trim();
  return value ? stripQuotes(value) : null;
}

function inlineBool(lines) {
  const value = inlineScalar(lines);
  if (value === null) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return null;
}

function parseFlowSeq(value) {
  const inner = value.slice(1, value.lastIndexOf("]"));
  return inner
    .split(",")
    .map((part) => stripQuotes(part.trim()))
    .filter(Boolean);
}

// `runs-on:` / `needs:` accept an inline scalar, a flow sequence, or a block
// sequence of 6-space list items.
function parseLabelList(lines) {
  const inline = (lines[0] ?? "").trim();
  if (inline) {
    if (inline.startsWith("[")) return parseFlowSeq(inline);
    return [stripQuotes(inline)];
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/^ {6}-[ \t]+(.+)$/);
    if (match) out.push(stripQuotes(match[1].trim()));
  }
  return out;
}

function parseStrategy(lines) {
  let failFast = null;
  for (const line of lines) {
    const match = line.match(/^ {6}fail-fast:[ \t]+(.+)$/);
    if (match) failFast = /^true$/i.test(match[1].trim());
  }
  return { failFast, matrix: parseMatrix(lines) };
}

// Matrix rows as a bounded dimension -> value-list map. `include`/`exclude`
// expanders are skipped (their values are per-row maps, not row columns).
function parseMatrix(lines) {
  const matrix = {};
  let currentKey = null;
  for (const line of lines) {
    if (/^ {6}matrix:$/.test(line) || /^ {6}(?:include|exclude):$/.test(line)) {
      currentKey = null;
      continue;
    }
    const keyMatch = line.match(/^ {8}([\w-]+):(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const inline = keyMatch[2].trim();
      matrix[currentKey] = inline
        ? inline.startsWith("[")
          ? parseFlowSeq(inline)
          : [stripQuotes(inline)]
        : [];
      continue;
    }
    if (currentKey && /^ {10}-[ \t]+/.test(line)) {
      matrix[currentKey].push(stripQuotes(line.replace(/^ {10}-[ \t]+/, "").trim()));
    }
  }
  return Object.keys(matrix).length ? matrix : null;
}

function parsePermissionsBlock(lines, indent) {
  const map = {};
  const re = new RegExp(`^ {${indent}}([\\w-]+):[ \\t]*(.*)$`);
  for (const line of lines) {
    const match = line.match(re);
    if (match) map[match[1]] = stripQuotes(match[2].trim());
  }
  return Object.keys(map).length ? map : null;
}

function parseJobBlock(block) {
  const idMatch = block[0].match(/^ {2}([\w-]+):/);
  if (!idMatch) return null;
  const sections = jobPropertySections(block);
  const props = {};
  for (const section of sections) props[section.key] = section;
  const job = {
    id: idMatch[1],
    name: null,
    runsOn: [],
    needs: [],
    if: null,
    continueOnError: null,
    failFast: null,
    matrix: null,
    permissions: null,
  };
  if (props.name) job.name = inlineScalar(props.name.lines);
  if (props["runs-on"]) job.runsOn = parseLabelList(props["runs-on"].lines);
  if (props.needs) job.needs = parseLabelList(props.needs.lines);
  if (props.if) job.if = inlineScalar(props.if.lines);
  if (props["continue-on-error"])
    job.continueOnError = inlineBool(props["continue-on-error"].lines);
  if (props.strategy) {
    const strategy = parseStrategy(props.strategy.lines);
    job.failFast = strategy.failFast;
    job.matrix = strategy.matrix;
  }
  if (props.permissions) job.permissions = parsePermissionsBlock(props.permissions.lines, 6);
  return job;
}

function extractJobs(content) {
  const subtree = extractTopSubtree(content, "jobs");
  if (!subtree) return [];
  return splitJobBlocks(subtree).map(parseJobBlock).filter(Boolean);
}

// Collect every `uses:` ref line (with its trailing version comment). Both the
// `- uses: ...` step-item form and the `uses:` property form are matched.
function collectUsesRefs(content) {
  const refs = [];
  for (const match of String(content).matchAll(/^\s+(?:-\s+)?uses:[ \t]*([^\n]+)$/gm)) {
    refs.push(match[1].trim());
  }
  return refs;
}

// Project a single `uses:` ref into a bounded pin token: owner/repo + short
// sha (or declared tag ref) + the version comment. Full SHAs and URLs never
// reach the model.
function parsePin(rawUses) {
  const commentMatch = rawUses.match(/#[ \t]*([^\s]+)[ \t]*$/);
  const version = commentMatch ? commentMatch[1] : null;
  const refPart = commentMatch ? rawUses.slice(0, commentMatch.index).trim() : rawUses.trim();
  const at = refPart.lastIndexOf("@");
  if (at <= 0) return null;
  const action = refPart.slice(0, at).trim();
  const ref = refPart.slice(at + 1).trim();
  if (!action || !ref) return null;
  if (action.startsWith(".") || action.startsWith("docker://")) return null;
  const parts = action.split("/");
  if (parts.length < 2) return null;
  const ownerRepo = `${parts[0]}/${parts[1]}`;
  if (SHA40_RE.test(ref)) return { action: ownerRepo, sha: ref.slice(0, 8).toLowerCase(), version };
  return { action: ownerRepo, ref, version };
}

function collectPins(content) {
  const pins = [];
  const seen = new Set();
  for (const rawUses of collectUsesRefs(content)) {
    const pin = parsePin(rawUses);
    if (!pin) continue;
    const key = `${pin.action}@${pin.sha || pin.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push(pin);
  }
  return pins;
}

// Workflows escalate beyond `contents: read` when any workflow- or job-level
// permission scope carries a write value. Scopes are deduped and emitted in
// declaration order.
function escalatedScopes(workflowPermissions, jobs) {
  const out = [];
  const seen = new Set();
  const consider = (permissions) => {
    if (!permissions) return;
    for (const [scope, value] of Object.entries(permissions)) {
      const token = String(value);
      if (/^write(?:-all)?$/.test(token) || token === "all") {
        const label = `${scope}: ${token}`;
        if (!seen.has(label)) {
          seen.add(label);
          out.push(label);
        }
      }
    }
  };
  consider(workflowPermissions);
  for (const job of jobs) consider(job.permissions);
  return out;
}

// Release/publish pipeline declarations: OIDC `id-token`, `skip-existing`, and
// the triple-match (tag == pyproject == runtime) version gate, all as static
// facts. Detection is triggered by publish/release naming or actions.
function detectReleasePipeline(file, content) {
  const src = String(content);
  const usesRefs = collectUsesRefs(src).join(" ");
  const name = extractWorkflowName(src) ?? "";
  const releaseish =
    /publish|release/i.test(file) ||
    /publish|release/i.test(name) ||
    /gh-action-pypi-publish|action-gh-release|release-drafter\/release-drafter/.test(usesRefs);
  if (!releaseish) return null;
  const permissions = extractWorkflowPermissions(src);
  const idTokenWrite =
    (permissions &&
      (permissions["id-token"] === "write" || permissions["id-token"] === "write-all")) ||
    /^ {2,6}id-token:[ \t]*write(?:-all)?[ \t]*$/m.test(src);
  const oidc = idTokenWrite || /gh-action-pypi-publish/.test(usesRefs);
  const skipExisting =
    /gh-action-pypi-publish/.test(usesRefs) && /skip-existing:[ \t]*true/.test(src);
  return { declared: true, oidc, skipExisting, tripleMatch: detectTripleMatch(src) };
}

// A step declares a tag/package version-match gate (the repo's triple-match
// publish gate compares the tag, pyproject and runtime __version__).
function detectTripleMatch(src) {
  for (const line of src.split(/\r?\n/)) {
    const nameMatch = line.match(/^\s+- name:[ \t]*(.+)$/);
    if (!nameMatch) continue;
    const title = nameMatch[1].toLowerCase();
    if (
      title.includes("version") &&
      /match/.test(title) &&
      (title.includes("tag") || title.includes("package") || title.includes("pyproject"))
    ) {
      return true;
    }
  }
  return /TAG_VERSION[\s\S]*PY_VERSION[\s\S]*RUNTIME_VERSION/.test(src);
}

function analyzeWorkflow(file, content) {
  const jobs = extractJobs(content);
  const permissions = extractWorkflowPermissions(content);
  return {
    file,
    name: extractWorkflowName(content),
    triggers: [...extractOnTriggers(content)],
    permissions,
    concurrency: extractWorkflowConcurrency(content),
    jobs,
    pins: collectPins(content),
    escalatedScopes: escalatedScopes(permissions, jobs),
    releasePipeline: detectReleasePipeline(file, content),
  };
}

function analyzeDockerfile(repoPath) {
  const dockerfilePaths = [
    "Dockerfile",
    "Dockerfile.prod",
    "Dockerfile.dev",
    "Dockerfile.production",
    "Dockerfile.staging",
  ];
  const dockerfiles = [];

  for (const name of dockerfilePaths) {
    const path = join(repoPath, name);
    // F-022/F-023: bounded, contained read of the well-known Dockerfile names.
    const content = readBoundedFile(path, { containmentRoot: repoPath });
    if (content == null) continue;

    const lines = content.split("\n");

    const baseImages = [];
    const exposedPorts = [];
    let isMultiStage = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^FROM\s/i.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const img = parts[1];
          if (img.toLowerCase() !== "scratch") {
            baseImages.push(img);
          }
        }
        if (baseImages.length > 1) isMultiStage = true;
      }
      const portMatch = trimmed.match(/^EXPOSE\s+(\d+)/i);
      if (portMatch) {
        exposedPorts.push(parseInt(portMatch[1], 10));
      }
    }

    const hasHealthcheck = /HEALTHCHECK/i.test(content);
    const hasUser = /^USER\s/i.test(content);
    const isAlpine = baseImages.some((img) => /alpine/i.test(img));
    const isSlim = baseImages.some((img) => /slim/i.test(img));
    const hasEntrypoint = /ENTRYPOINT/i.test(content);
    const hasCmd = /CMD/i.test(content);

    dockerfiles.push({
      name,
      baseImages,
      exposedPorts,
      isMultiStage,
      hasHealthcheck,
      hasUser,
      isAlpine,
      isSlim,
      hasEntrypoint,
      hasCmd,
      lineCount: lines.length,
    });
  }

  return dockerfiles;
}

function analyzeDockerCompose(repoPath) {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.override.yml",
  ];
  const services = [];
  let networks = [];
  let volumes = [];

  for (const name of composeFiles) {
    const path = join(repoPath, name);
    // F-022/F-023: bounded, contained read of the well-known compose names.
    const content = readBoundedFile(path, { containmentRoot: repoPath });
    if (content == null) continue;

    const serviceMatch = content.match(/^  (\w+):/gm);
    const serviceSet = new Set();
    if (serviceMatch) {
      for (const m of serviceMatch) {
        const svc = m.replace(/^  /, "").replace(/:$/, "");
        if (!["services", "networks", "volumes"].includes(svc)) {
          serviceSet.add(svc);
        }
      }
    }

    const depMap = {};
    for (const svc of serviceSet) {
      const depRe = new RegExp(`^  ${svc}:\\n[\\s\\S]*?(?=^\\S|\\Z)`, "m");
      const depSection = content.match(depRe);
      if (depSection) {
        const depends = depSection[0].match(/^\s+-\s+(\w+)/gm);
        if (depends) {
          depMap[svc] = depends.map((d) => d.replace(/^\s+-\s+/, ""));
        } else {
          depMap[svc] = [];
        }
      }
    }

    services.push({
      file: name,
      names: [...serviceSet],
      count: serviceSet.size,
      dependencies: depMap,
    });

    const netMatch = content.match(/^networks:\n([\s\S]*?)(?=^volumes|^services|Z)/m);
    if (netMatch) {
      const netNames = netMatch[1].match(/^  (\w+):/gm) || [];
      networks = netNames.map((n) => n.replace(/^  /, "").replace(/:$/, ""));
    }

    const volMatch = content.match(/^volumes:\n([\s\S]*?)(?=Z)/m);
    if (volMatch) {
      const volNames = volMatch[1].match(/^  (\w+):/gm) || [];
      volumes = volNames.map((v) => v.replace(/^  /, "").replace(/:$/, ""));
    }
  }

  return { present: services.length > 0, services, networks, volumes };
}

function analyzeCI(repoPath) {
  const ciSystems = [];

  const ghWorkflows = join(repoPath, ".github/workflows");
  if (existsSync(ghWorkflows)) {
    try {
      let workflowFiles = [];
      try {
        workflowFiles = readdirSync(ghWorkflows)
          .filter((n) => /\.(ya?ml)$/i.test(n))
          .toSorted();
      } catch {}

      const jobs = new Set();
      const triggers = new Set();
      const stepTools = new Set();
      const workflows = [];
      let stepScanVerified = true;
      for (const f of workflowFiles) {
        const content = readBoundedFile(join(ghWorkflows, f), { containmentRoot: repoPath });
        if (content == null) {
          stepScanVerified = false;
          continue;
        }
        for (const j of extractJobNames(content)) jobs.add(j);
        for (const t of extractOnTriggers(content)) triggers.add(t);
        workflows.push(analyzeWorkflow(f, content));
        const lineCount = content.split(/\r?\n/).length;
        if (content.length > STEP_SCAN_BYTE_LIMIT || lineCount > STEP_SCAN_LINE_LIMIT) {
          stepScanVerified = false;
          continue;
        }
        for (const tool of scanWorkflowSteps(content)) stepTools.add(tool);
      }

      ciSystems.push({
        platform: "GitHub Actions",
        workflowCount: workflowFiles.length,
        jobs: [...jobs],
        triggers: [...triggers],
        stepTools: [...stepTools].toSorted(),
        stepToolScan: stepScanVerified ? "verified" : "unverified",
        workflows,
      });
    } catch {}
  }

  const gitlabCI = join(repoPath, ".gitlab-ci.yml");
  const gitlabContent = readBoundedFile(gitlabCI, { containmentRoot: repoPath });
  if (gitlabContent != null) {
    const stages = gitlabContent.match(/^stages:\n([\s\S]*?)(?=\n\S|Z)/m);
    let stageList = [];
    if (stages) {
      stageList = stages[1].match(/^\s+-\s+(.+)/gm)?.map((s) => s.replace(/^\s+-\s+/, "")) || [];
    }
    ciSystems.push({
      platform: "GitLab CI",
      stages: stageList,
      present: true,
    });
  }

  const jenkinsfile = join(repoPath, "Jenkinsfile");
  const hasJenkins = existsSync(jenkinsfile);
  if (hasJenkins) {
    ciSystems.push({ platform: "Jenkins", present: true });
  }

  const circleConfig = join(repoPath, ".circleci/config.yml");
  const hasCircle = existsSync(circleConfig);
  if (hasCircle) {
    ciSystems.push({ platform: "CircleCI", present: true });
  }

  const travis = join(repoPath, ".travis.yml");
  const hasTravis = existsSync(travis);
  if (hasTravis) {
    ciSystems.push({ platform: "Travis CI", present: true });
  }

  return ciSystems;
}

const ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".env.staging",
  ".env.example",
  ".env.sample",
];

// Recognized app/config files across ecosystems.
const APP_CONFIG_FILES = [
  // JS / TS
  "app.config.js",
  "app.config.ts",
  "config.js",
  "config.ts",
  "configuration.ts",
  // Python
  "settings.py",
  "config.py",
  "alembic.ini",
  ".env.toml",
];

function detectEnvConfig(repoPath, overview) {
  const envFiles = [];

  // Allow lowercase env-var names (python/django convention) in addition to
  // SCREAMING_SNAKE_CASE. Comments and blank lines are ignored.
  for (const name of ENV_FILE_NAMES) {
    const path = join(repoPath, name);
    // F-022/F-023: bounded, contained read — a symlinked `.env` resolving
    // outside the repo (e.g. `.env -> /dev/zero`) is never read.
    const content = readBoundedFile(path, { containmentRoot: repoPath });
    if (content != null) {
      const varCount = content
        .split("\n")
        .filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)).length;
      envFiles.push({ file: name, varCount });
    }
  }

  const fileList = Array.isArray(overview?.files) ? overview.files : null;
  let appConfigDetected = false;
  if (fileList) {
    // Prefer the enumerated file list (produced by shared/enum.mjs via survey),
    // which sees config files anywhere in the tree, not only at the repo root.
    const set = new Set(APP_CONFIG_FILES);
    for (const f of fileList) {
      if (set.has(f.split("/").pop())) {
        appConfigDetected = true;
        break;
      }
    }
  } else {
    for (const name of APP_CONFIG_FILES) {
      if (existsSync(join(repoPath, name))) {
        appConfigDetected = true;
        break;
      }
    }
  }

  const hasConfigDir = existsSync(join(repoPath, "config"));

  return { envFiles, configDir: hasConfigDir, appConfigFile: appConfigDetected };
}

function detectHealthChecks(repoPath, files) {
  const checks = [];

  const re =
    /healthcheck|health[-_]?check|readiness[-_]?probe|liveness[-_]?probe|\/health\b|\/ready\b|\/live\b|\/ping\b/;
  for (const f of files.slice(0, SCAN_FILE_LIMIT)) {
    const content = readContent(join(repoPath, f));
    if (content && re.test(content) && checks.length < 10) {
      checks.push(f);
    }
  }

  return {
    detected: checks.length > 0,
    references: checks,
  };
}

function detectGracefulShutdown(repoPath, files) {
  const patterns = [
    { name: "SIGTERM handler", re: /(?:SIGTERM|SIGINT|SIGQUIT)/ },
    { name: "BeforeExit", re: /beforeExit/ },
    { name: "Graceful close", re: /graceful[-_]?(?:shutdown|close|exit)/i },
    { name: "Process exit handler", re: /process\.on(['"]exit['"])/ },
    { name: "Server close", re: /server\.close\(\)/ },
  ];

  const detections = [];
  const bounded = files.slice(0, SCAN_FILE_LIMIT);
  for (const { name, re } of patterns) {
    let n = 0;
    for (const f of bounded) {
      const content = readContent(join(repoPath, f));
      if (content && re.test(content)) n++;
    }
    if (n > 0) {
      detections.push({ pattern: name, fileCount: n });
    }
  }

  return detections;
}

// Ecosystem-aware monitoring/observability detection.
//
// The historic implementation held an inline JS-only map and only inspected a
// package.json-shaped deps object. It now defers to shared/detection.mjs
// MONITORING_LIBS (keyed by ecosystem) so that Python
// (structlog/loguru/sentry-sdk/prometheus-client/opentelemetry-*), Rust
// (tracing/opentelemetry/sentry/slog/...) and JS/TS projects all surface.
//
// `matchDep` accepts an array of dependency names OR a `{name: version}` map;
// it returns one entry per matched dep carrying the table's `label`/`type` and
// honours trailing-`*` prefix keys (e.g. `opentelemetry-*`, `@opentelemetry/*`).
function detectMonitoring(manifest) {
  if (!manifest) return { libraries: [] };
  const ecosystems = Array.isArray(manifest.ecosystems) ? manifest.ecosystems : [];
  if (ecosystems.length === 0) return { libraries: [] };

  // allDepNames = union of runtime + dev dependency names across every
  // ecosystem the manifest normalized (Python/JVM/JS/Rust deps collapse into
  // the same `dependencies`/`devDependencies` buckets in shared/manifest.mjs).
  const allDepNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });

  const libraries = [];
  const seen = new Set();
  for (const eco of ecosystems) {
    const table = MONITORING_LIBS[eco];
    if (!table) continue;
    for (const m of matchDep(allDepNames, table)) {
      if (seen.has(m.name)) continue; // a dep name lives in one ecosystem
      seen.add(m.name);
      libraries.push({
        package: m.name,
        label: m.label,
        ...(m.type ? { type: m.type } : {}),
      });
    }
  }

  return { libraries };
}

export async function scan(repoPath, overview, broker = commandBroker) {
  const manifest = readManifest(repoPath);
  const files = await listFiles(repoPath, overview, broker);

  const dockerfiles = analyzeDockerfile(repoPath);
  const dockerCompose = analyzeDockerCompose(repoPath);
  const ci = analyzeCI(repoPath);
  const envConfig = detectEnvConfig(repoPath, overview);

  const hasDockerignore = existsSync(join(repoPath, ".dockerignore"));
  const hasMakefile =
    existsSync(join(repoPath, "Makefile")) ||
    existsSync(join(repoPath, "makefile")) ||
    existsSync(join(repoPath, "GNUmakefile"));

  // Just (justfile.dev) task runner — Just itself accepts `Justfile` or
  // `justfile`; `justfile.just` is an explicit --justfile target some repos
  // commit. Surfaced as its own boolean; render wiring is deferred (P1).
  const hasJustfile =
    existsSync(join(repoPath, "Justfile")) ||
    existsSync(join(repoPath, "justfile")) ||
    existsSync(join(repoPath, "justfile.just"));

  const hasDeployScripts =
    existsSync(join(repoPath, "deploy")) ||
    existsSync(join(repoPath, "deploy.sh")) ||
    existsSync(join(repoPath, "scripts/deploy.sh")) ||
    existsSync(join(repoPath, "scripts/deploy"));

  const healthChecks = detectHealthChecks(repoPath, files);
  const gracefulShutdown = detectGracefulShutdown(repoPath, files);
  const monitoring = detectMonitoring(manifest);

  const procfile = join(repoPath, "Procfile");
  const hasProcfile = existsSync(procfile);

  let procfileContent = null;
  if (hasProcfile) {
    // F-022/F-023: bounded, contained read of the well-known Procfile name.
    procfileContent = readBoundedFile(procfile, { containmentRoot: repoPath });
  }

  const ciWorkflowCount = ci.reduce((sum, c) => sum + (c.workflowCount || (c.present ? 1 : 0)), 0);
  const signal =
    dockerfiles.length > 0 || ciWorkflowCount > 0 ? "high" : hasDockerignore ? "medium" : "low";

  return {
    dimension: "operations",
    signal,
    findings: {
      dockerfiles,
      dockerCompose,
      ci,
      envConfig,
      hasDockerignore,
      hasMakefile,
      hasJustfile,
      hasDeployScripts,
      healthChecks,
      gracefulShutdown,
      monitoring,
      procfile: hasProcfile ? { content: procfileContent } : null,
    },
  };
}
