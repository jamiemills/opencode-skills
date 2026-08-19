import { assertDataOnly, compareAscii, deepFreeze } from '../contracts/dimension.mjs';
import { ProviderContractError, validateProvider } from '../contracts/provider.mjs';

export const PLUGIN_API_VERSION = 1;
export const PLUGIN_REGEX_FLAGS = 'u';

export const PLUGIN_LIMITS = deepFreeze({
  aliases: 32,
  artifactTokens: 64,
  basenames: 64,
  extensions: 64,
  fileBytes: 65_536,
  label: 80,
  literal: 128,
  manifestNames: 64,
  plugins: 64,
  providers: 32,
  regexAlternatives: 8,
  regexGroups: 8,
  regexQuantifiers: 16,
  regexSource: 128,
  rules: 256,
  string: 128,
  tokenSegments: 8,
});

const PLUGIN_KEYS = Object.freeze(['aliases', 'apiVersion', 'id', 'label', 'providers', 'rules']);
const RULE_KEYS = Object.freeze([
  'artifactTokens', 'basenames', 'category', 'dimensionId', 'extensions', 'id',
  'label', 'literal', 'manifestNames', 'regexSource',
]);
const RULE_REQUIRED_KEYS = Object.freeze(['category', 'dimensionId', 'id', 'label']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RULE_ID_PATTERN = /^RUL-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+():/-]*$/;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const EXTENSION_PATTERN = /^\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const TOKEN_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SAFE_REGEX_ESCAPE = /^[dDsSwWbB.^$*+?()[\]{}|/\\-]$/;

export class PluginSchemaError extends TypeError {
  constructor(code, message) {
    super(`Invalid plugin schema: ${message}`);
    this.name = 'PluginSchemaError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PluginSchemaError(code, message);
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', `${label} must be an object`);
  }
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function allowedKeys(value, allowed, required, label) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function safeSlug(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !SLUG_PATTERN.test(value)) {
    fail('INVALID_ID', `${label} must be a bounded lowercase ASCII slug`);
  }
  return value;
}

function safeLabel(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLUGIN_LIMITS.label
      || value !== value.trim() || !LABEL_PATTERN.test(value)) {
    fail('INVALID_LABEL', `${label} must be bounded renderer-safe ASCII`);
  }
  return value;
}

function uniqueStrings(value, maximum, normalize, label) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('BOUND_EXCEEDED', `${label} must be a bounded array`);
  }
  const result = value.map((entry) => normalize(entry, label)).sort(compareAscii);
  if (new Set(result).size !== result.length) fail('DUPLICATE_ID', `${label} must be unique`);
  return result;
}

function fileName(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLUGIN_LIMITS.string
      || !FILE_NAME_PATTERN.test(value) || value === '.' || value === '..') {
    fail('INVALID_ARTIFACT', `${label} must contain bounded artifact names`);
  }
  return value;
}

function extension(value, label) {
  if (typeof value !== 'string' || value.length > 17 || !EXTENSION_PATTERN.test(value)) {
    fail('INVALID_ARTIFACT', `${label} must contain bounded extensions`);
  }
  return value;
}

function artifactToken(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLUGIN_LIMITS.string
      || value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)
      || value.includes('\\') || value.includes('\0')) {
    fail('INVALID_PATH', `${label} must contain bounded relative artifact tokens`);
  }
  const segments = value.split('/');
  if (segments.length > PLUGIN_LIMITS.tokenSegments
      || segments.some((segment) => segment === '.' || segment === '..' || !TOKEN_SEGMENT_PATTERN.test(segment))) {
    fail('INVALID_PATH', `${label} must contain bounded relative artifact tokens`);
  }
  return value;
}

function asciiSet(from, to) {
  const set = new Set();
  for (let code = from; code <= to; code++) set.add(String.fromCharCode(code));
  return set;
}

const DIGIT_CHARS = asciiSet(0x30, 0x39);
const WORD_CHARS = asciiSet(0x41, 0x5a);
for (const character of asciiSet(0x61, 0x7a)) WORD_CHARS.add(character);
for (const character of DIGIT_CHARS) WORD_CHARS.add(character);
WORD_CHARS.add('_');
const SPACE_CHARS = new Set([' ', '\t', '\n', '\r', '\v', '\f']);
const QUANTIFIER_FAMILIES = Object.freeze({
  d: { digit: true, chars: DIGIT_CHARS },
  w: { word: true, chars: WORD_CHARS },
  s: { space: true, chars: SPACE_CHARS },
});

function emptySignature() {
  return { any: false, digit: false, word: false, space: false, chars: new Set() };
}

function unionFamily(signature, family) {
  if (family.digit) signature.digit = true;
  if (family.word) signature.word = true;
  if (family.space) signature.space = true;
  for (const member of family.chars) signature.chars.add(member);
}

function quantifierFamiliesOverlap(left, right) {
  return (left.digit || left.word || left.space) && (right.digit || right.word || right.space);
}

function signaturesIntersect(left, right) {
  if (left.any || right.any) return true;
  if (quantifierFamiliesOverlap(left, right)) return true;
  if (left.chars.size === 0 || right.chars.size === 0) return false;
  for (const character of left.chars) {
    if (right.chars.has(character)) return true;
  }
  return false;
}

function regexSource(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLUGIN_LIMITS.regexSource
      || value !== value.trim() || /[^\x20-\x7e]/.test(value)) {
    fail('INVALID_REGEX', 'regexSource must be bounded printable ASCII');
  }
  if (value.includes('(?') || /\\(?:[1-9]|k|p|P)/.test(value) || /[{}]/.test(value)) {
    fail('REGEX_COMPLEXITY', 'regexSource uses a prohibited construct');
  }

  let escaped = false;
  let inClass = false;
  let groups = 0;
  let depth = 0;
  let alternatives = 0;
  let quantifiers = 0;
  let previous = 'start';
  let unboundedWildcards = 0;
  let classAtoms = 0;
  let classPrevious = null;
  let classRange = false;
  let classRangeStart = null;
  let classSignature = null;
  let lastAtom = null;
  const quantifiedSignatures = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      if (!SAFE_REGEX_ESCAPE.test(character)) fail('INVALID_REGEX', 'regexSource contains an invalid escape');
      escaped = false;
      if (inClass) {
        if (classRange) fail('INVALID_REGEX', 'regexSource character range is invalid');
        classAtoms++;
        classPrevious = null;
        if (character === 'D' || character === 'W' || character === 'S') {
          classSignature.any = true;
        } else {
          const family = QUANTIFIER_FAMILIES[character];
          if (family !== undefined) {
            unionFamily(classSignature, family);
          } else {
            classSignature.chars.add(character);
          }
        }
      } else if (character === 'b' || character === 'B') {
        previous = 'anchor';
        lastAtom = null;
      } else {
        previous = 'atom';
        lastAtom = emptySignature();
        if (character === 'D' || character === 'W' || character === 'S') {
          lastAtom.any = true;
        } else {
          const family = QUANTIFIER_FAMILIES[character];
          if (family !== undefined) {
            unionFamily(lastAtom, family);
          } else {
            lastAtom.chars.add(character);
          }
        }
      }
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (character === ']') {
        if (classAtoms === 0 || classRange) fail('INVALID_REGEX', 'regexSource character class is invalid');
        inClass = false;
        previous = 'atom';
        lastAtom = emptySignature();
        lastAtom.any = classSignature.any;
        lastAtom.digit = classSignature.digit;
        lastAtom.word = classSignature.word;
        lastAtom.space = classSignature.space;
        for (const member of classSignature.chars) lastAtom.chars.add(member);
      } else if (character === '[') {
        fail('INVALID_REGEX', 'regexSource character class is invalid');
      } else if (character === '-' && index + 1 < value.length && value[index + 1] !== ']') {
        if (classRange || classPrevious === null) fail('INVALID_REGEX', 'regexSource character range is invalid');
        classRange = true;
        classRangeStart = classPrevious;
      } else {
        if (classRange) {
          if (classRangeStart.codePointAt(0) > character.codePointAt(0)) {
            fail('INVALID_REGEX', 'regexSource character range is invalid');
          }
          for (let code = classRangeStart.codePointAt(0); code <= character.codePointAt(0); code++) {
            classSignature.chars.add(String.fromCodePoint(code));
          }
          classAtoms++;
          classPrevious = null;
          classRange = false;
          classRangeStart = null;
        } else {
          classAtoms++;
          classPrevious = character;
          classSignature.chars.add(character);
        }
      }
      continue;
    }
    if (character === '[') {
      inClass = true;
      classAtoms = 0;
      classPrevious = null;
      classRange = false;
      classRangeStart = null;
      classSignature = emptySignature();
      lastAtom = null;
      continue;
    }
    if (character === ']') fail('INVALID_REGEX', 'regexSource delimiters are unbalanced');
    if (character === '(') {
      groups++;
      depth++;
      previous = 'open';
      lastAtom = null;
    } else if (character === ')') {
      if (depth === 0 || !['atom', 'quantifier', 'close'].includes(previous)) {
        fail('INVALID_REGEX', 'regexSource groups are invalid');
      }
      depth--;
      previous = 'close';
      lastAtom = null;
    } else if (character === '|') {
      if (!['atom', 'quantifier', 'close'].includes(previous)) {
        fail('INVALID_REGEX', 'regexSource alternatives are invalid');
      }
      alternatives++;
      previous = 'alternative';
      lastAtom = null;
    } else if ('*+?'.includes(character)) {
      if (!['atom'].includes(previous)) fail('REGEX_COMPLEXITY', 'regexSource quantifier placement is unsafe');
      quantifiers++;
      if (value[index - 1] === '.' && (character === '*' || character === '+')) unboundedWildcards++;
      if (character !== '?' && lastAtom !== null) {
        if (quantifiedSignatures.some((earlier) => signaturesIntersect(earlier, lastAtom))) {
          fail('REGEX_COMPLEXITY', 'regexSource quantified atoms overlap unsafely');
        }
        quantifiedSignatures.push(lastAtom);
      }
      previous = 'quantifier';
    } else if (character === '^' || character === '$') {
      previous = 'anchor';
      lastAtom = null;
    } else {
      previous = 'atom';
      lastAtom = emptySignature();
      if (character === '.') {
        lastAtom.any = true;
      } else {
        lastAtom.chars.add(character);
      }
    }
  }
  if (escaped || inClass || depth !== 0 || previous === 'alternative') {
    fail('INVALID_REGEX', 'regexSource delimiters are unbalanced');
  }
  if (groups > PLUGIN_LIMITS.regexGroups || alternatives > PLUGIN_LIMITS.regexAlternatives
      || quantifiers > PLUGIN_LIMITS.regexQuantifiers || unboundedWildcards > 1) {
    fail('REGEX_COMPLEXITY', 'regexSource exceeds the fixed complexity policy');
  }
  return value;
}

export const validatePluginRegexSource = regexSource;

function optionalMatch(value, field, normalize) {
  if (!Object.hasOwn(value, field)) return null;
  if (value[field] === null) return null;
  return normalize(value[field]);
}

function normalizeRule(rule) {
  plainObject(rule, 'rule');
  allowedKeys(rule, RULE_KEYS, RULE_REQUIRED_KEYS, 'rule');
  if (typeof rule.id !== 'string' || rule.id.length > 96 || !RULE_ID_PATTERN.test(rule.id)) {
    fail('INVALID_ID', 'rule id must be a stable versioned ASCII identifier');
  }
  const extensions = uniqueStrings(rule.extensions ?? [], PLUGIN_LIMITS.extensions, extension, 'extensions');
  const basenames = uniqueStrings(rule.basenames ?? [], PLUGIN_LIMITS.basenames, fileName, 'basenames');
  const manifestNames = uniqueStrings(
    rule.manifestNames ?? [], PLUGIN_LIMITS.manifestNames, fileName, 'manifestNames',
  );
  const artifactTokens = uniqueStrings(
    rule.artifactTokens ?? [], PLUGIN_LIMITS.artifactTokens, artifactToken, 'artifactTokens',
  );
  if (extensions.length + basenames.length + manifestNames.length + artifactTokens.length === 0) {
    fail('INVALID_ARTIFACT', 'rule must declare at least one bounded artifact selector');
  }
  const literal = optionalMatch(rule, 'literal', (entry) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > PLUGIN_LIMITS.literal
        || entry !== entry.trim() || /[^\x20-\x7e]/.test(entry)) {
      fail('INVALID_LITERAL', 'literal must be bounded printable ASCII');
    }
    return entry;
  });
  const source = optionalMatch(rule, 'regexSource', regexSource);
  if (literal !== null && source !== null) fail('INVALID_MATCH', 'rule may declare literal or regexSource, not both');
  return {
    id: rule.id,
    label: safeLabel(rule.label, 'rule label'),
    extensions,
    basenames,
    manifestNames,
    artifactTokens,
    dimensionId: rule.dimensionId,
    category: rule.category,
    literal,
    regexSource: source,
  };
}

function provider(value) {
  try {
    return validateProvider(value);
  } catch (error) {
    if (error instanceof ProviderContractError) {
      fail('INVALID_PROVIDER', 'provider capability failed canonical validation');
    }
    throw error;
  }
}

export function validatePlugin(value) {
  assertDataOnly(value, PluginSchemaError, {
    maxArray: PLUGIN_LIMITS.rules,
    maxDepth: 8,
    maxNodes: 16_384,
    maxObjectKeys: 32,
    maxString: 512,
  });
  plainObject(value, 'plugin');
  exactKeys(value, PLUGIN_KEYS, 'plugin');
  if (value.apiVersion !== PLUGIN_API_VERSION) fail('INVALID_VERSION', 'apiVersion is unsupported');
  const id = safeSlug(value.id, 'plugin id');
  const aliases = uniqueStrings(value.aliases, PLUGIN_LIMITS.aliases, safeSlug, 'aliases');
  if (aliases.includes(id)) fail('DUPLICATE_ALIAS', 'plugin id and aliases must be unique');
  if (!Array.isArray(value.providers) || value.providers.length === 0
      || value.providers.length > PLUGIN_LIMITS.providers) {
    fail('BOUND_EXCEEDED', 'providers must be a bounded non-empty array');
  }
  const providers = value.providers.map(provider).sort((left, right) => compareAscii(left.id, right.id));
  if (new Set(providers.map((entry) => entry.id)).size !== providers.length) {
    fail('DUPLICATE_PROVIDER', 'provider identifiers must be unique');
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0 || value.rules.length > PLUGIN_LIMITS.rules) {
    fail('BOUND_EXCEEDED', 'rules must be a bounded non-empty array');
  }
  const rules = value.rules.map(normalizeRule).sort((left, right) => compareAscii(left.id, right.id));
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) {
    fail('DUPLICATE_RULE', 'rule identifiers must be unique');
  }
  const capabilities = new Set(providers.flatMap(({ dimensions }) => dimensions.flatMap(
    ({ dimensionId, categories }) => categories.map((category) => `${dimensionId}:${category}`),
  )));
  for (const rule of rules) {
    if (!capabilities.has(`${rule.dimensionId}:${rule.category}`)) {
      fail('CATEGORY_MISMATCH', 'rule category is not declared by a provider capability');
    }
  }
  return deepFreeze({
    id,
    apiVersion: PLUGIN_API_VERSION,
    label: safeLabel(value.label, 'plugin label'),
    aliases,
    providers,
    rules,
  });
}

export function validatePlugins(values) {
  assertDataOnly(values, PluginSchemaError, {
    maxArray: PLUGIN_LIMITS.rules * PLUGIN_LIMITS.plugins,
    maxDepth: 9,
    maxNodes: 1_048_576,
    maxObjectKeys: 32,
    maxString: 512,
  });
  if (!Array.isArray(values) || values.length > PLUGIN_LIMITS.plugins) {
    fail('BOUND_EXCEEDED', 'plugins must be a bounded array');
  }
  const plugins = values.map(validatePlugin).sort((left, right) => compareAscii(left.id, right.id));
  const identities = new Set();
  const providerIds = new Set();
  const ruleIds = new Set();
  for (const plugin of plugins) {
    for (const identity of [plugin.id, ...plugin.aliases]) {
      if (identities.has(identity)) fail('DUPLICATE_ALIAS', 'plugin identifiers and aliases must be globally unique');
      identities.add(identity);
    }
    for (const providerEntry of plugin.providers) {
      if (providerIds.has(providerEntry.id)) fail('DUPLICATE_PROVIDER', 'provider identifiers must be globally unique');
      providerIds.add(providerEntry.id);
    }
    for (const rule of plugin.rules) {
      if (ruleIds.has(rule.id)) fail('DUPLICATE_RULE', 'rule identifiers must be globally unique');
      ruleIds.add(rule.id);
    }
  }
  return deepFreeze(plugins);
}
