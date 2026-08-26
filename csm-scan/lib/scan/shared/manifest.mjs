// Normalized manifest reader.
// Reads pyproject.toml / package.json / Cargo.toml (whichever exist) and
// returns a single normalized shape describing the project.
//
// ESM only. Zero npm deps. Builtins only.
// Read-only with respect to the scanned repo.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deepFreeze } from "../contracts/evidence.mjs";
import { createProviderResult } from "../providers/base.mjs";
import { descriptorFor } from "./ecosystem.mjs";
import { parseToml } from "./parse.mjs";
import { expandRepositoryDirectoryPatterns } from "./glob.mjs";
import { parseJson } from "../../../../lib/schema-runtime/index.mjs";

function readJSON(path) {
  try {
    return parseJson(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readToml(path) {
  try {
    return parseToml(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function empty() {
  return {
    ecosystems: [],
    name: null,
    version: null,
    description: null,
    buildBackend: null,
    requiresPython: null,
    dependencies: {},
    devDependencies: {},
    optionalDeps: {},
    entrypoints: [],
    sourceLayout: null,
    // --- JavaScript (package.json) ---
    main: null,
    module: null,
    exports: null,
    imports: null,
    engines: null,
    peerDependencies: {},
    workspaces: null,
    nodeVersion: null,
    // --- Rust (Cargo.toml) ---
    buildDependencies: {},
    edition: null,
    rustVersion: null,
    features: {},
    lib: null,
    crateType: null,
    workspace: null,
  };
}

/**
 * Read manifests at repoPath and return a normalized summary.
 * Missing manifests are skipped silently (never thrown).
 */
export function readManifest(repoPath) {
  const result = empty();

  const hasPyproject = existsSync(join(repoPath, "pyproject.toml"));
  const hasSetupPy = existsSync(join(repoPath, "setup.py"));
  const hasRequirementsTxt = existsSync(join(repoPath, "requirements.txt"));
  const hasRequirementsDev = existsSync(join(repoPath, "requirements-dev.txt"));
  const hasConstraints = existsSync(join(repoPath, "constraints.txt"));
  const hasRequirements = hasRequirementsTxt || hasRequirementsDev || hasConstraints;
  const hasPackageJson = existsSync(join(repoPath, "package.json"));
  const hasCargo = existsSync(join(repoPath, "Cargo.toml"));
  const hasTsConfig = existsSync(join(repoPath, "tsconfig.json"));

  // Python: priority 1 (highest)
  if (hasPyproject) {
    const pp = readToml(join(repoPath, "pyproject.toml"));
    if (pp) {
      if (!result.ecosystems.includes("python")) result.ecosystems.push("python");
      applyPyproject(result, pp);
    }
  } else if (hasSetupPy || hasRequirements) {
    if (!result.ecosystems.includes("python")) result.ecosystems.push("python");
  }

  // Requirements / constraints files (read whenever present, even alongside
  // pyproject). Never throw on a malformed line — skip silently.
  if (hasRequirementsTxt)
    parseRequirementsFile(join(repoPath, "requirements.txt"), result.dependencies);
  if (hasRequirementsDev)
    parseRequirementsFile(join(repoPath, "requirements-dev.txt"), result.devDependencies);
  if (hasConstraints) parseRequirementsFile(join(repoPath, "constraints.txt"), result.dependencies);

  // JS/TS: priority 2
  if (hasPackageJson) {
    const pkg = readJSON(join(repoPath, "package.json"));
    if (pkg) {
      const isTS = detectTypeScript(pkg, hasTsConfig);
      if (!result.ecosystems.includes(isTS ? "typescript" : "javascript")) {
        result.ecosystems.push(isTS ? "typescript" : "javascript");
      }
      applyPackageJson(result, pkg);
    }
  }

  // Rust: priority 3
  if (hasCargo) {
    const cargo = readToml(join(repoPath, "Cargo.toml"));
    if (cargo) {
      if (!result.ecosystems.includes("rust")) result.ecosystems.push("rust");
      applyCargo(result, cargo, repoPath);
    }
  }

  return result;
}

function detectTypeScript(pkg, hasTsConfig) {
  if (hasTsConfig) return true;
  const dev = pkg.devDependencies || {};
  const deps = pkg.dependencies || {};
  if (dev.typescript || deps.typescript) return true;
  const allDeps = { ...deps, ...dev };
  for (const name of Object.keys(allDeps)) {
    if (name.startsWith("@types/")) return true;
  }
  return false;
}

function applyPyproject(result, pp) {
  const project = pp.project || null;

  if (project) {
    // priority fields (name/version/description): set if currently null
    if (project.name != null && result.name === null) result.name = String(project.name);
    if (project.version != null && result.version === null)
      result.version = String(project.version);
    if (project.description != null && result.description === null)
      result.description = String(project.description);
    if (project["requires-python"] != null)
      result.requiresPython = String(project["requires-python"]);

    if (Array.isArray(project.dependencies)) {
      for (const spec of project.dependencies) {
        const d = parsePythonDep(spec);
        if (d) result.dependencies[d.name] = d.spec;
      }
    }
    if (project["optional-dependencies"] && typeof project["optional-dependencies"] === "object") {
      for (const group of Object.keys(project["optional-dependencies"])) {
        const list = project["optional-dependencies"][group];
        if (!Array.isArray(list)) continue;
        for (const spec of list) {
          const d = parsePythonDep(spec);
          if (d) result.optionalDeps[d.name] = d.spec;
        }
      }
    }
    if (project.scripts && typeof project.scripts === "object") {
      for (const [k, v] of Object.entries(project.scripts)) {
        result.entrypoints.push(`${k}=${v}`);
      }
    }
    // PEP 621 GUI scripts (same shape as [project.scripts]).
    if (project["gui-scripts"] && typeof project["gui-scripts"] === "object") {
      for (const [k, v] of Object.entries(project["gui-scripts"])) {
        result.entrypoints.push(`${k}=${v}`);
      }
    }
    // PEP 621 entry-point groups: [project.entry-points."group"].
    if (project["entry-points"] && typeof project["entry-points"] === "object") {
      for (const [group, mapping] of Object.entries(project["entry-points"])) {
        if (!mapping || typeof mapping !== "object") continue;
        for (const [k, v] of Object.entries(mapping)) {
          result.entrypoints.push(`${group}/${k}=${v}`);
        }
      }
    }
  }

  // Poetry fallback
  const poetry = pp.tool && pp.tool.poetry;
  if (poetry) {
    if (result.name === null && poetry.name != null) result.name = String(poetry.name);
    if (result.version === null && poetry.version != null) result.version = String(poetry.version);
    if (result.description === null && poetry.description != null)
      result.description = String(poetry.description);
    if (poetry.dependencies && typeof poetry.dependencies === "object") {
      for (const [k, v] of Object.entries(poetry.dependencies)) {
        if (k === "python") {
          if (result.requiresPython === null) result.requiresPython = String(v);
        } else if (!(k in result.dependencies)) {
          result.dependencies[k] = String(v);
        }
      }
    }
    if (poetry["dev-dependencies"] && typeof poetry["dev-dependencies"] === "object") {
      for (const [k, v] of Object.entries(poetry["dev-dependencies"])) {
        result.devDependencies[k] = String(v);
      }
    }
  }

  // PEP 735 [dependency-groups] -> devDependencies (merged).
  const depGroups = pp["dependency-groups"];
  if (depGroups && typeof depGroups === "object") {
    for (const group of Object.keys(depGroups)) {
      const list = depGroups[group];
      if (!Array.isArray(list)) continue;
      for (const spec of list) {
        const d = parsePythonDep(spec);
        if (d && d.name) result.devDependencies[d.name] = d.spec;
      }
    }
  }

  // build backend
  const bs = pp["build-system"];
  if (bs && Array.isArray(bs.requires)) {
    const requires = bs.requires.map((r) => String(r));
    let detected = null;
    if (requires.some((r) => r.startsWith("hatchling"))) detected = "hatchling";
    else if (requires.some((r) => r.startsWith("poetry-core"))) detected = "poetry-core";
    else if (requires.some((r) => r.startsWith("flit_core") || r.startsWith("flit-core")))
      detected = "flit_core";
    else if (requires.some((r) => r.startsWith("setuptools"))) detected = "setuptools";
    if (result.buildBackend === null && detected) result.buildBackend = detected;
  }
  if (bs && bs["build-backend"]) {
    // The explicit build-backend string wins; normalize the leading segment
    // (e.g. "setuptools.build_meta" -> "setuptools", "hatchling.build" -> "hatchling").
    const bb = String(bs["build-backend"]);
    const head = bb.split(".")[0] || bb;
    result.buildBackend = head;
  }

  // source layout
  const find =
    pp.tool &&
    pp.tool.setuptools &&
    pp.tool.setuptools.packages &&
    pp.tool.setuptools.packages.find;
  if (find && Array.isArray(find.where) && find.where.includes("src")) {
    result.sourceLayout = "src-layout";
  }
  const pkgDir = pp.tool && pp.tool.setuptools && pp.tool.setuptools["package-dir"];
  if (result.sourceLayout === null && pkgDir && pkgDir[""] === "src") {
    result.sourceLayout = "src-layout";
  }
}

/**
 * Parse a PEP 508 dependency spec like "click>=8.0", "mcp>=1.28.1,<2.0.0",
 * or "atheris>=3.1.0; sys_platform == 'linux' and platform_machine == 'x86_64'".
 * Returns {name, spec} or null if it cannot be parsed.
 */
function parsePythonDep(spec) {
  if (typeof spec !== "string") return null;
  let s = spec;
  const semi = s.indexOf(";");
  if (semi !== -1) s = s.slice(0, semi); // drop environment marker
  s = s.trim();
  const m = s.match(/^([A-Za-z0-9_.-]+)/);
  if (!m) return null;
  const name = m[1];
  const rest = s.slice(name.length).trim();
  return { name, spec: rest };
}

/**
 * Parse a requirements/constraints file (PEP 508 lines) into `target`.
 * Strips comments (`#`), environment markers (`;`), and extras are folded into
 * the spec. Skips pip option lines (`-r`, `-e`, `-c`, `--hash`...), blank lines,
 * URL/VCS specs, and anything unparseable — never throws.
 */
function parseRequirementsFile(path, target) {
  let text;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    let s = raw;
    // Comment handling: a `#` begins a comment when it starts the line or is
    // preceded by whitespace (the pip rule). A leading-`#` line is skipped.
    const hi = s.indexOf("#");
    if (hi !== -1) {
      if (s.slice(0, hi).trim() === "") continue;
      const before = s[hi - 1];
      if (before === " " || before === "\t") s = s.slice(0, hi);
    }
    s = s.trim();
    if (s === "") continue;
    if (s.startsWith("-")) continue; // pip options: -r, -e, -c, --hash...
    if (/:\/\//.test(s)) continue; // URLs / VCS specs (git+https://, ...)
    const d = parsePythonDep(s);
    if (d && d.name && /^[A-Za-z0-9]/.test(d.name)) target[d.name] = d.spec;
  }
}

function resolveExportsDot(exports) {
  if (typeof exports === "string") return exports;
  if (exports && typeof exports === "object") {
    const dot = exports["."];
    if (dot == null) return null;
    if (typeof dot === "string") return dot;
    if (typeof dot === "object") {
      // Conditional exports: prefer import > node > default > require.
      for (const cond of ["import", "node", "default", "require"]) {
        const v = dot[cond];
        if (typeof v === "string") return v;
      }
      for (const v of Object.values(dot)) {
        if (typeof v === "string") return v;
      }
    }
  }
  return null;
}

function applyPackageJson(result, pkg) {
  if (pkg.name != null && result.name === null) result.name = String(pkg.name);
  if (pkg.version != null && result.version === null) result.version = String(pkg.version);
  if (pkg.description != null && result.description === null)
    result.description = String(pkg.description);

  if (pkg.dependencies && typeof pkg.dependencies === "object") {
    for (const [k, v] of Object.entries(pkg.dependencies)) result.dependencies[k] = String(v);
  }
  if (pkg.devDependencies && typeof pkg.devDependencies === "object") {
    for (const [k, v] of Object.entries(pkg.devDependencies)) result.devDependencies[k] = String(v);
  }
  if (pkg.optionalDependencies && typeof pkg.optionalDependencies === "object") {
    for (const [k, v] of Object.entries(pkg.optionalDependencies))
      result.optionalDeps[k] = String(v);
  }
  if (pkg.peerDependencies && typeof pkg.peerDependencies === "object") {
    for (const [k, v] of Object.entries(pkg.peerDependencies))
      result.peerDependencies[k] = String(v);
  }
  if (pkg.bin) {
    if (typeof pkg.bin === "string") {
      result.entrypoints.push(`${pkg.name || "bin"}=${pkg.bin}`);
    } else if (typeof pkg.bin === "object") {
      for (const [k, v] of Object.entries(pkg.bin)) result.entrypoints.push(`${k}=${v}`);
    }
  }

  // Entrypoints / module entry fields.
  if (pkg.main != null) {
    if (result.main === null) result.main = String(pkg.main);
    result.entrypoints.push(`main=${pkg.main}`);
  }
  if (pkg.module != null) {
    if (result.module === null) result.module = String(pkg.module);
    result.entrypoints.push(`module=${pkg.module}`);
  }
  if (pkg.exports !== undefined && pkg.exports !== null && result.exports === null) {
    result.exports = pkg.exports;
    const dot = resolveExportsDot(pkg.exports);
    if (dot) result.entrypoints.push(`exports=${dot}`);
  }

  // Subpath imports / engines / workspaces (passthrough shapes).
  if (pkg.imports !== undefined && pkg.imports !== null && result.imports === null) {
    result.imports = pkg.imports;
  }
  if (pkg.engines !== undefined && pkg.engines !== null && result.engines === null) {
    result.engines = pkg.engines;
    if (pkg.engines && pkg.engines.node != null && result.nodeVersion === null) {
      result.nodeVersion = String(pkg.engines.node);
    }
  }
  if (pkg.workspaces !== undefined && pkg.workspaces !== null && result.workspaces === null) {
    result.workspaces = pkg.workspaces;
  }
}

function cargoDepSpec(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (v.version != null) return String(v.version);
    return JSON.stringify(v);
  }
  return String(v);
}

function resolveCargoMembers(repoPath, members, excludes) {
  return expandRepositoryDirectoryPatterns(repoPath, members, {
    exclude: excludes,
    marker: "Cargo.toml",
  });
}

function mergeCargoDependencies(
  target,
  dependencies,
  workspaceDependencies = {},
  poolReferences = null,
) {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, value] of Object.entries(dependencies)) {
    if (value && typeof value === "object" && value.workspace === true) {
      if (name in workspaceDependencies) {
        // F-027: a member referencing the pool via `workspace = true` is
        // recorded as a pool reference even when the eager pool merge already
        // placed the spec in the root inventory (so the member loop's
        // `name in target` guard cannot mask the reference).
        if (poolReferences !== null) poolReferences.add(name);
        if (!(name in target)) target[name] = workspaceDependencies[name];
      }
      continue;
    }
    if (name in target) continue;
    target[name] = cargoDepSpec(value);
  }
}

function applyCargo(result, cargo, repoPath) {
  const pkg = cargo.package;
  if (pkg) {
    if (pkg.name != null && result.name === null) result.name = String(pkg.name);
    if (pkg.version != null && result.version === null) result.version = String(pkg.version);
    if (pkg.description != null && result.description === null)
      result.description = String(pkg.description);
  }

  if (cargo.dependencies && typeof cargo.dependencies === "object") {
    for (const [k, v] of Object.entries(cargo.dependencies)) {
      if (typeof v === "string") result.dependencies[k] = v;
      else if (v && typeof v === "object")
        result.dependencies[k] = v.version ? String(v.version) : JSON.stringify(v);
    }
  }
  if (cargo["dev-dependencies"] && typeof cargo["dev-dependencies"] === "object") {
    for (const [k, v] of Object.entries(cargo["dev-dependencies"])) {
      if (typeof v === "string") result.devDependencies[k] = v;
      else if (v && typeof v === "object")
        result.devDependencies[k] = v.version ? String(v.version) : JSON.stringify(v);
    }
  }
  if (cargo["build-dependencies"] && typeof cargo["build-dependencies"] === "object") {
    for (const [k, v] of Object.entries(cargo["build-dependencies"])) {
      result.buildDependencies[k] = cargoDepSpec(v);
    }
  }
  if (Array.isArray(cargo.bin)) {
    for (const b of cargo.bin) {
      if (b && b.name) result.entrypoints.push(`${b.name}=${b.path || ""}`);
    }
  }

  // edition / rust-version (MSRV): prefer [package], fall back to [workspace.package].
  const wsPkg = cargo.workspace && cargo.workspace.package;
  for (const src of [pkg || null, wsPkg || null]) {
    if (!src) continue;
    if (result.edition === null && src.edition != null) result.edition = String(src.edition);
    if (result.rustVersion === null && src["rust-version"] != null)
      result.rustVersion = String(src["rust-version"]);
  }

  // [features]
  if (cargo.features && typeof cargo.features === "object") {
    for (const [k, v] of Object.entries(cargo.features)) {
      result.features[k] = Array.isArray(v) ? v.slice() : v;
    }
  }

  // [lib]
  if (cargo.lib && typeof cargo.lib === "object") {
    result.lib = { ...cargo.lib };
    const ct = cargo.lib["crate-type"];
    if (ct != null) {
      result.crateType = Array.isArray(ct) ? ct.map(String).join(",") : String(ct);
    }
  }

  // [workspace]
  if (cargo.workspace && typeof cargo.workspace === "object") {
    const ws = cargo.workspace;
    const members = Array.isArray(ws.members) ? ws.members.map(String) : [];
    const exclude = Array.isArray(ws.exclude) ? ws.exclude.map(String) : [];
    const resolvedMembers = resolveCargoMembers(repoPath, members, exclude);
    result.workspace = {
      members,
      resolvedMembers,
      defaultMembers: Array.isArray(ws["default-members"]) ? ws["default-members"].map(String) : [],
      exclude,
    };
    // [workspace.dependencies] — shared version source for member crates.
    // F-027: in a virtual workspace the root has no [package], so the pool is
    // NOT the root's own dependency inventory. Pool entries are merged into
    // the root inventory for backward compatibility, but each one is marked
    // with distinct declared-pool provenance so downstream detection can tell
    // an unused pool declaration from a real dependency: the declared pool
    // map, the sorted pool names, and the subset actually referenced by member
    // crates via `workspace = true`. The fields are added ONLY when the pool
    // declares entries, so a pool-less workspace keeps a byte-identical
    // manifest (the legacy semantic baseline).
    const workspaceDependencies = {};
    const poolReferences = new Set();
    if (ws.dependencies && typeof ws.dependencies === "object") {
      for (const [k, v] of Object.entries(ws.dependencies)) {
        workspaceDependencies[k] = cargoDepSpec(v);
        if (!(k in result.dependencies)) result.dependencies[k] = workspaceDependencies[k];
      }
    }
    if (Object.keys(workspaceDependencies).length > 0) {
      result.workspace.dependencies = workspaceDependencies;
      result.workspace.declaredPool = Object.keys(workspaceDependencies).toSorted();
    }
    // Best-effort: union dependency classes from each resolved member crate.
    for (const member of resolvedMembers) {
      const memberCargo = readToml(join(repoPath, member, "Cargo.toml"));
      if (!memberCargo) continue;
      mergeCargoDependencies(
        result.dependencies,
        memberCargo.dependencies,
        workspaceDependencies,
        poolReferences,
      );
      mergeCargoDependencies(
        result.devDependencies,
        memberCargo["dev-dependencies"],
        workspaceDependencies,
        poolReferences,
      );
      mergeCargoDependencies(
        result.buildDependencies,
        memberCargo["build-dependencies"],
        workspaceDependencies,
        poolReferences,
      );
    }
    if (Object.keys(workspaceDependencies).length > 0) {
      result.workspace.referencedPool = [...poolReferences].toSorted();
    }
  }
}

// ---------------------------------------------------------------------------
// T210 provider contribution point
// ---------------------------------------------------------------------------
// `manifestObservations` / `manifestProviderResult` expose the normalized
// manifest as inert provider observations. They are ADDITIVE: `readManifest`
// output is unchanged, so the focused manifest tests stay byte-identical.
// Language and declared-runtime observations mirror what the stack scanner
// currently derives from the same manifest fields.

function manifestObservation(category, matchedKey, details, sourceKind) {
  return { category, path: null, matchedKey, details, sourceKind };
}

/**
 * Derive provider observations from a normalized manifest (readManifest).
 * Pure and deterministic; never throws.
 * @param {object} manifest - normalized manifest shape.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen).
 */
export function manifestObservations(manifest) {
  const mf = manifest || {};
  const stack = [];
  const languages = Array.isArray(mf.ecosystems)
    ? mf.ecosystems.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  for (const id of languages) {
    const label = descriptorFor(id)?.label ?? id;
    stack.push(manifestObservation("language", `language:${id}`, { name: id, label }, "manifest"));
  }
  if (mf.requiresPython != null) {
    stack.push(
      manifestObservation(
        "runtime",
        "runtime:Python",
        {
          name: "Python",
          declared: String(mf.requiresPython),
        },
        "manifest",
      ),
    );
  }
  if (mf.nodeVersion != null) {
    stack.push(
      manifestObservation(
        "runtime",
        "runtime:Node.js",
        {
          name: "Node.js",
          declared: String(mf.nodeVersion),
        },
        "manifest",
      ),
    );
  }
  if (mf.rustVersion != null) {
    stack.push(
      manifestObservation(
        "runtime",
        "runtime:Rust",
        {
          name: "Rust",
          declared: String(mf.rustVersion),
        },
        "manifest",
      ),
    );
  }
  return deepFreeze(stack.length > 0 ? [{ dimensionId: "DIM-stack-v1", observations: stack }] : []);
}

/**
 * Build immutable provider results from a normalized manifest. Inert:
 * consumed only by tests and future provider catalogs.
 * @param {object} manifest
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function manifestProviderResult(manifest) {
  return manifestObservations(manifest).map(({ dimensionId, observations }) =>
    createProviderResult({ providerId: "PRV-manifest-v1", dimensionId, observations }),
  );
}
