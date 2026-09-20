"use strict";
// Resolve the configured shared trace-log path from CSM's effective-config
// envelope `csm-skills-config/1` ONLY. This module never reads opencode.json
// (its schema rejects the extra `skills` key), and it never parses JSON itself:
// each layer is read through the hardened loader in lib/config/index.mjs
// (strict JSON with duplicate-key rejection, symlink/size/depth protection).
//
// PRECEDENCE (deliberate; documented in the plan as A3):
//   1. CSM_TRACE_LOG environment variable, only when absolute and non-empty
//   2. PROJECT (per-repo) layer: <repoMainRoot(root)>/.csm-skills.json
//   3. USER (host) layer:        $XDG_CONFIG_HOME/csm/skills.json (or ~/.config)
//   4. null
//
// This deliberately makes the PROJECT layer win over the USER layer for this
// key. That DIFFERS from resolveConfig's generic merge order
// (defaults < project < user < run), where the user layer overrides the project
// layer. The reason is semantic: the user layer is a HOST-WIDE DEFAULT and the
// project layer is a PER-REPO OVERRIDE, so the more specific repository choice
// must win. The generic resolver's merge is left untouched for every other key.
//
// Fail-safe: a missing, malformed, oversized, symlinked, too-deep, non-CSM, or
// duplicate-keyed config file NEVER throws. A present-but-invalid layer resolves
// to null (we do not silently fall through to a less specific layer and write
// traces somewhere unexpected); a merely absent layer falls through. A layer is
// invalid — not absent — when it exists but its envelope is malformed (wrong
// version, unknown top-level key, non-object `skills`, or a non-object
// `skills["csm-orchestrate"]`), so a clone-controlled project file can never
// silently defer to the user layer.
//
// The extracted value is used verbatim: unlike resolveConfig's generic merge it
// is NOT `${ENV}`-expanded. A literal `${VAR}` here is written as-is (and, being
// non-absolute, resolved relative to the main worktree root). Use the
// CSM_TRACE_LOG environment variable or an absolute literal path instead.
import { isAbsolute } from "node:path";
import {
  CONFIG_SCHEMA_ID,
  CONFIG_SCHEMA_VERSION,
  projectConfigPath,
  readConfigLayer,
  userConfigPath,
} from "../../lib/config/index.mjs";
import { repoMainRoot } from "./repo-state.mjs";

const SKILL_NAME = "csm-orchestrate";
const CONFIG_KEY = "traceLogPath";
const TOP_LEVEL_KEYS = new Set(["schema", "version", "skills"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Read one layer and classify it:
//   { state: "absent" }          -> no layer, or a valid CSM envelope without the key
//   { state: "invalid" }         -> present but unreadable/non-CSM (fail safe to null)
//   { state: "value", value }    -> a non-empty configured path
async function readLayerValue(kind, filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return { state: "absent" };
  let read;
  try {
    read = await readConfigLayer(kind, filePath, { required: false });
  } catch {
    return { state: "invalid" };
  }
  if (!read.present) return { state: "absent" };
  const config = read.config;
  if (!isPlainObject(config)) return { state: "invalid" };
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) return { state: "invalid" };
  }
  if (config.schema !== CONFIG_SCHEMA_ID) return { state: "invalid" };
  if (Object.hasOwn(config, "version") && config.version !== CONFIG_SCHEMA_VERSION)
    return { state: "invalid" };
  if (!isPlainObject(config.skills)) return { state: "invalid" };
  if (Object.hasOwn(config.skills, SKILL_NAME) && !isPlainObject(config.skills[SKILL_NAME]))
    return { state: "invalid" };
  const value = config.skills[SKILL_NAME]?.[CONFIG_KEY];
  if (typeof value === "string" && value.length > 0) return { state: "value", value };
  return { state: "absent" };
}

export async function resolveTraceLogPath({ root = process.cwd(), env = process.env } = {}) {
  const override = env?.CSM_TRACE_LOG;
  if (typeof override === "string" && override.length > 0 && isAbsolute(override)) return override;

  const project = await readLayerValue("project", projectConfigPath(repoMainRoot(root)));
  if (project.state === "invalid") return null;
  if (project.state === "value") return project.value;

  const user = await readLayerValue("user", userConfigPath(env));
  if (user.state === "invalid") return null;
  if (user.state === "value") return user.value;

  return null;
}
