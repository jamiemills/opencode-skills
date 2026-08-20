// Pure declarative rule evaluation for T203 plugin rule selectors.
//
// T210 owns this module. It evaluates plugin artifact rules against bounded,
// repository-relative artifact metadata and nothing else:
//
//   - Selectors supported: extensions, basenames, manifestNames,
//     artifactTokens, literal, regexSource (T203 plugin.json rule fields).
//   - No evaluation of anything executable: rules are plain JSON data and this
//     module performs no filesystem, child-process, or dynamic-module access.
//   - No path escape: artifact paths are normalized repository-relative paths;
//     artifactTokens match only at directory boundaries inside those paths.
//   - Regexes are compiled ONLY from the fixed `u`-validated source at evaluate
//     time; the T203 policy (partition/quantifier/complexity rules) is enforced
//     at this evaluation boundary by delegating every regexSource to the plugin
//     schema validator before any new RegExp, never re-implemented here.
//   - Match counts are bounded and the result never includes matched content,
//     so sensitive literal/regex hits cannot leak through evaluation output.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no side effects.
//
// Source-policy note (T201): this module imports only contracts and the plugin
// schema validator and never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  EVIDENCE_LIMITS,
  normalizeEvidencePath,
} from '../contracts/evidence.mjs';
import { PluginSchemaError, validatePluginRegexSource } from '../plugins/schema.mjs';

export const RULE_EVALUATION_LIMITS = deepFreeze({
  contentBytes: 65_536,
  maxArtifacts: 4096,
  maxMatches: 2048,
  maxMatchesPerRule: 128,
  maxRules: 256,
  regexSource: 128,
  selectorEntries: 64,
});

const RULE_KEYS = Object.freeze([
  'artifactTokens', 'basenames', 'category', 'dimensionId', 'extensions',
  'id', 'label', 'literal', 'manifestNames', 'regexSource',
]);
const ARTIFACT_KEYS = Object.freeze(['content', 'path', 'size']);

export class RuleEvaluationError extends TypeError {
  constructor(code, message) {
    super(`Rule evaluation failed: ${message}`);
    this.name = 'RuleEvaluationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuleEvaluationError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function boundedSelectorArray(value, label) {
  if (!Array.isArray(value) || value.length > RULE_EVALUATION_LIMITS.selectorEntries) {
    fail('BOUND_EXCEEDED', `${label} must be a bounded array`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > RULE_EVALUATION_LIMITS.regexSource) {
      fail('INVALID_SELECTOR', `${label} must contain bounded strings`);
    }
    return entry;
  });
}

function optionalString(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > RULE_EVALUATION_LIMITS.regexSource) {
    fail('INVALID_SELECTOR', `${label} must be a bounded string or null`);
  }
  return value;
}

/**
 * Enforce the T203 regex complexity/partition policy at the evaluation
 * boundary. The plugin schema validator is the single source of truth for
 * that policy; this module delegates to it unchanged (never re-implements it)
 * so catastrophic sources such as `(a+)+b` or `a*a*b` are rejected here with
 * a typed sanitized error before any new RegExp is compiled.
 */
function validateRegexSourcePolicy(source) {
  try {
    validatePluginRegexSource(source);
  } catch (error) {
    if (error instanceof PluginSchemaError) {
      fail(error.code, 'regexSource violates the fixed T203 complexity policy');
    }
    throw error;
  }
}

/**
 * Validate a rule shape for evaluation. This mirrors the T203 plugin schema
 * shape and enforces the T203 regex complexity/partition policy by delegating
 * every regexSource to the exported plugin schema validator, so an unvalidated
 * catastrophic source cannot reach new RegExp. Returns a frozen normalized rule.
 */
export function validateRuleForEvaluation(rule) {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    fail('INVALID_TYPE', 'rule must be an object');
  }
  try {
    assertDataOnly(rule, RuleEvaluationError, {
      maxArray: RULE_EVALUATION_LIMITS.selectorEntries,
      maxDepth: 4,
      maxNodes: RULE_EVALUATION_LIMITS.selectorEntries * 8,
      maxObjectKeys: RULE_KEYS.length,
      maxString: RULE_EVALUATION_LIMITS.regexSource,
    });
  } catch (error) {
    if (error instanceof RuleEvaluationError) throw error;
    fail('INVALID_DATA', 'rule must contain plain bounded data');
  }
  exactKeys(rule, RULE_KEYS, 'rule');
  for (const field of ['id', 'label', 'dimensionId', 'category']) {
    if (typeof rule[field] !== 'string' || rule[field].length === 0 || rule[field].length > 128) {
      fail('INVALID_SELECTOR', `${field} must be a bounded string`);
    }
  }
  const extensions = boundedSelectorArray(rule.extensions, 'extensions');
  const basenames = boundedSelectorArray(rule.basenames, 'basenames');
  const manifestNames = boundedSelectorArray(rule.manifestNames, 'manifestNames');
  const artifactTokens = boundedSelectorArray(rule.artifactTokens, 'artifactTokens');
  const literal = optionalString(rule.literal, 'literal');
  const regexSource = optionalString(rule.regexSource, 'regexSource');
  if (literal !== null && regexSource !== null) fail('INVALID_MATCH', 'rule may declare literal or regexSource, not both');
  if (regexSource !== null) validateRegexSourcePolicy(regexSource);
  if (extensions.length + basenames.length + manifestNames.length + artifactTokens.length === 0
      && literal === null && regexSource === null) {
    fail('INVALID_MATCH', 'rule must declare at least one artifact selector');
  }
  return deepFreeze({
    id: rule.id,
    label: rule.label,
    dimensionId: rule.dimensionId,
    category: rule.category,
    extensions,
    basenames,
    manifestNames,
    artifactTokens,
    literal,
    regexSource,
  });
}

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function directoryOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function extensionOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Validate and normalize a bounded repository-relative artifact for rule
 * evaluation. Only path, size, and bounded content are accepted; extension,
 * basename, and directory are derived from the normalized path so no
 * inconsistent or escaping path can be introduced. Returns a frozen record.
 */
export function validateArtifactMetadata(artifact) {
  if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
    fail('INVALID_TYPE', 'artifact metadata must be an object');
  }
  exactKeys(artifact, ARTIFACT_KEYS, 'artifact metadata');
  let path;
  try {
    path = normalizeEvidencePath(artifact.path);
  } catch {
    fail('INVALID_PATH', 'artifact path is not a normalized repository-relative POSIX path');
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 0 || artifact.size > EVIDENCE_LIMITS.bytes) {
    fail('INVALID_SIZE', 'artifact size is outside the explicit bound');
  }
  if (typeof artifact.content !== 'string') fail('INVALID_CONTENT', 'artifact content must be a string');
  const content = artifact.content.length > RULE_EVALUATION_LIMITS.contentBytes
    ? artifact.content.slice(0, RULE_EVALUATION_LIMITS.contentBytes)
    : artifact.content;
  const bounded = { path, size: artifact.size, content };
  try {
    assertDataOnly(bounded, RuleEvaluationError, {
      maxArray: RULE_EVALUATION_LIMITS.maxArtifacts,
      maxDepth: 3,
      maxNodes: RULE_EVALUATION_LIMITS.maxArtifacts,
      maxObjectKeys: 16,
      maxString: RULE_EVALUATION_LIMITS.contentBytes,
    });
  } catch (error) {
    if (error instanceof RuleEvaluationError) throw error;
    fail('INVALID_DATA', 'artifact metadata must contain plain bounded data');
  }
  return deepFreeze({
    path,
    size: artifact.size,
    content,
    basename: basenameOf(path),
    directory: directoryOf(path),
    extension: extensionOf(path),
  });
}

function tokensMatchPath(path, tokens) {
  return tokens.some((token) => path === token || path.startsWith(`${token}/`));
}

function extensionMatches(extension, extensions) {
  return extensions.some((entry) => entry.toLowerCase() === extension);
}

/**
 * Evaluate a single declarative rule against a single artifact. Selectors are
 * alternatives (OR): the rule selects the artifact when any declared selector
 * matches. Every regexSource has already passed the T203 policy validation in
 * validateRuleForEvaluation, so the fixed `u` compile here operates only on
 * policy-validated sources; a compile failure is a defensive typed error.
 *
 * @returns {boolean} true when the rule selects the artifact.
 */
export function evaluateRule(rule, artifact) {
  const normalizedRule = validateRuleForEvaluation(rule);
  const normalizedArtifact = validateArtifactMetadata(artifact);
  return evaluateNormalizedRule(normalizedRule, normalizedArtifact);
}

function evaluateNormalizedRule(normalizedRule, normalizedArtifact) {
  if (normalizedRule.extensions.length > 0 && extensionMatches(normalizedArtifact.extension, normalizedRule.extensions)) {
    return true;
  }
  if (normalizedRule.basenames.length > 0 && normalizedRule.basenames.includes(normalizedArtifact.basename)) {
    return true;
  }
  if (normalizedRule.manifestNames.length > 0 && normalizedRule.manifestNames.includes(normalizedArtifact.basename)) {
    return true;
  }
  if (normalizedRule.artifactTokens.length > 0 && tokensMatchPath(normalizedArtifact.path, normalizedRule.artifactTokens)) {
    return true;
  }
  if (normalizedRule.literal !== null && normalizedArtifact.content.includes(normalizedRule.literal)) {
    return true;
  }
  if (normalizedRule.regexSource !== null) {
    let regex;
    try {
      regex = new RegExp(normalizedRule.regexSource, 'u');
    } catch {
      fail('INVALID_REGEX', 'regexSource is not compilable under the fixed policy');
    }
    if (regex.test(normalizedArtifact.content)) return true;
  }
  return false;
}

function canonicalMatch(rule, artifact) {
  return {
    ruleId: rule.id,
    label: rule.label,
    dimensionId: rule.dimensionId,
    category: rule.category,
    path: artifact.path,
  };
}

/**
 * Evaluate a bounded set of rules against a bounded set of artifacts and
 * return deterministic, bounded matches. Matches reference only rule identity
 * and normalized artifact path — never matched content, so sensitive literal
 * or regex hits cannot leak through the result.
 *
 * @param {object} input - `{ rules, artifacts }`.
 * @returns {{ matches: object[], capped: boolean, rulesInspected: number, artifactsInspected: number }}
 *   A deep-frozen result; `capped` is true when the total or per-rule match
 *   bound was reached and evaluation stopped early.
 */
export function evaluateRules({ rules, artifacts }) {
  try {
    assertDataOnly({ rules, artifacts }, RuleEvaluationError, {
      maxArray: RULE_EVALUATION_LIMITS.maxArtifacts,
      maxDepth: 5,
      maxNodes: RULE_EVALUATION_LIMITS.maxArtifacts * 16,
      maxObjectKeys: RULE_KEYS.length + 8,
      maxString: RULE_EVALUATION_LIMITS.contentBytes,
    });
  } catch (error) {
    if (error instanceof RuleEvaluationError) throw error;
    fail('INVALID_DATA', 'evaluation inputs must contain plain bounded data');
  }
  if (!Array.isArray(rules) || rules.length > RULE_EVALUATION_LIMITS.maxRules) {
    fail('BOUND_EXCEEDED', 'rules must be a bounded array');
  }
  if (!Array.isArray(artifacts) || artifacts.length > RULE_EVALUATION_LIMITS.maxArtifacts) {
    fail('BOUND_EXCEEDED', 'artifacts must be a bounded array');
  }
  const normalizedRules = rules.map(validateRuleForEvaluation);
  const normalizedArtifacts = artifacts.map(validateArtifactMetadata);
  const matches = [];
  let capped = false;
  const perRuleCounts = new Map();
  for (const rule of normalizedRules) {
    for (const artifact of normalizedArtifacts) {
      if (matches.length >= RULE_EVALUATION_LIMITS.maxMatches) {
        capped = true;
        break;
      }
      if ((perRuleCounts.get(rule.id) ?? 0) >= RULE_EVALUATION_LIMITS.maxMatchesPerRule) {
        capped = true;
        break;
      }
      if (evaluateNormalizedRule(rule, artifact)) {
        matches.push(canonicalMatch(rule, artifact));
        perRuleCounts.set(rule.id, (perRuleCounts.get(rule.id) ?? 0) + 1);
      }
    }
    if (capped) break;
  }
  matches.sort((left, right) => compareAscii(
    `${left.dimensionId}\0${left.category}\0${left.ruleId}\0${left.path}`,
    `${right.dimensionId}\0${right.category}\0${right.ruleId}\0${right.path}`,
  ));
  return deepFreeze({
    matches,
    capped,
    rulesInspected: normalizedRules.length,
    artifactsInspected: normalizedArtifacts.length,
  });
}
