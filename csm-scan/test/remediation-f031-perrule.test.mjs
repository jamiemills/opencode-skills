// F-031 — a per-rule match cap stops only that rule; the total cap is the sole
// outer-break condition.
//
// Before this fix hitting maxMatchesPerRule set `capped` and the outer
// `if (capped) break` aborted ALL remaining rules for the plugin, so one chatty
// rule silently suppressed every later rule's detections. After the fix a
// per-rule cap breaks just that rule's inner loop.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRules, RULE_EVALUATION_LIMITS } from '../lib/scan/providers/rules.mjs';

function rule(overrides = {}) {
  return {
    id: 'RUL-test-v1',
    label: 'Test artifact',
    dimensionId: 'DIM-api-v1',
    category: 'route',
    extensions: ['.x'],
    basenames: [],
    manifestNames: [],
    artifactTokens: [],
    literal: null,
    regexSource: null,
    ...overrides,
  };
}

function artifacts(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({ path: `${prefix}/${index}.x`, size: 1, content: '' }));
}

test('F-031: a chatty rule that hits its per-rule cap does not suppress later rules', () => {
  const chatty = rule({ extensions: ['.x'] });
  const later = rule({ id: 'RUL-later-v1', extensions: ['.x'] });
  // 200 artifacts: BOTH rules cap at maxMatchesPerRule (128) and both must
  // contribute. Before the fix the chatty rule's per-rule cap set `capped` and
  // broke the outer loop, so the later rule contributed nothing.
  const result = evaluateRules({ rules: [chatty, later], artifacts: artifacts('a', 200) });
  const perRule = new Map();
  for (const match of result.matches) {
    perRule.set(match.ruleId, (perRule.get(match.ruleId) ?? 0) + 1);
  }
  assert.equal(perRule.get('RUL-test-v1'), RULE_EVALUATION_LIMITS.maxMatchesPerRule, 'chatty rule capped at its per-rule limit');
  assert.equal(perRule.get('RUL-later-v1'), RULE_EVALUATION_LIMITS.maxMatchesPerRule, 'later rule must still be evaluated');
  assert.equal(result.matches.length, RULE_EVALUATION_LIMITS.maxMatchesPerRule * 2);
  // The per-rule cap is disclosed via `capped`.
  assert.equal(result.capped, true);
});

test('F-031: the total match cap still stops evaluation as the sole outer break', () => {
  // 30 rules x 100 artifacts = 3000 potential matches; no single rule reaches
  // its per-rule cap (100 < 128), so only the TOTAL cap (maxMatches) can stop
  // evaluation.
  const rules = Array.from({ length: 30 }, (_, index) => rule({ id: `RUL-${index}-v1`, extensions: ['.x'] }));
  const result = evaluateRules({ rules, artifacts: artifacts('t', 100) });
  assert.equal(result.matches.length, RULE_EVALUATION_LIMITS.maxMatches);
  assert.equal(result.capped, true);
});
