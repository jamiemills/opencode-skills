import { test } from "node:test";
import { strict as assert } from "node:assert";

import { parseToml, parseYamlShallow } from "../lib/scan/shared/parse.mjs";

// F6-07: seeded-fuzz properties over the shared config parsers. Every input is
// derived deterministically from a fixed seed and a frozen seed corpus, so any
// failure reproduces exactly. Properties per mutated input:
//   1. never throws an untyped error — a thrown error MUST be an Error whose
//      message matches the parser's typed `TOML|YAML parse error at line N:`
//      shape (the parser's discipline: throw on unsupported constructs);
//   2. on success the result is a sane structure (non-null object; the TOML
//      root is additionally never an array);
//   3. idempotence in FIXED-POINT form over the serialize/reparse cycle with
//      JSON.stringify as serialize (see the per-parser comments below for the
//      exact law — the naive value equality is unsatisfiable, so each parser
//      is pinned to the strongest true fixed-point characterization).

// Mulberry32 PRNG — seeded, deterministic, dependency-free.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo));
}

function pick(rng, arr) {
  return arr[randInt(rng, 0, arr.length)];
}

const TOML_SEED = 0xf6ee07;
const YAML_SEED = 0x5eed7a;
const ITERATIONS = 200;

const TOML_SEEDS = [
  {
    name: "pyproject",
    text: `# demo project
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "demo"
version = "0.1.0"
dynamic = false
keywords = ["cli", "demo"]

[project.scripts]
demo = "demo.cli:main"

[tool.ruff]
line-length = 100
ratio = 1.5
`,
    golden:
      '{"build-system":{"requires":["hatchling"],"build-backend":"hatchling.build"},"project":{"name":"demo","version":"0.1.0","dynamic":false,"keywords":["cli","demo"],"scripts":{"demo":"demo.cli:main"}},"tool":{"ruff":{"line-length":100,"ratio":1.5}}}',
  },
  {
    name: "cargo",
    text: `[package]
name = "tool"
version = "0.4.1"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
regex = "1"

[[bin]]
name = "tool"
path = "src/main.rs"
`,
    golden:
      '{"package":{"name":"tool","version":"0.4.1","edition":"2021"},"dependencies":{"serde":{"version":"1","features":["derive"]},"regex":"1"},"bin":[{"name":"tool","path":"src/main.rs"}]}',
  },
];

const YAML_SEEDS = [
  {
    name: "workflow",
    text: `name: ci
on:
  push:
    branches: [ main, dev ]
  pull_request: null
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout
      - name: run
        run: make check
`,
    golden:
      '{"name":"ci","on":{"push":{"branches":["main","dev"]},"pull_request":null},"jobs":{"build":{"runs-on":"ubuntu-latest","steps":[{"uses":"actions/checkout"},{"name":"run","run":"make check"}]}}}',
  },
  {
    name: "lefthook",
    text: `pre-commit:
  commands:
    lint:
      run: node scripts/check.js
    test:
      skip: false
      tags: [ a, b ]
`,
    golden:
      '{"pre-commit":{"commands":{"lint":{"run":"node scripts/check.js"},"test":{"skip":false,"tags":["a","b"]}}}}',
  },
];

const MUT_CHARS = [..."{}[]=\"':#.,-_0123456789abcdefX&*|> "];
const MUT_WS = ["\n", "\t", "\r\n"];

function mutate(rng, text) {
  const ops = 1 + randInt(rng, 0, 4);
  for (let k = 0; k < ops; k++) {
    const pos = randInt(rng, 0, text.length);
    switch (randInt(rng, 0, 4)) {
      case 0:
        text = text.slice(0, pos) + pick(rng, MUT_CHARS) + text.slice(pos);
        break;
      case 1:
        if (text.length > 0) text = text.slice(0, pos) + text.slice(pos + 1);
        break;
      case 2:
        if (text.length > 1) {
          const i = Math.min(pos, text.length - 2);
          text = text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2);
        }
        break;
      case 3: {
        const len = randInt(rng, 1, Math.min(12, text.length - pos + 1));
        text = text.slice(0, pos) + text.slice(pos, pos + len) + text.slice(pos);
        break;
      }
      default:
        if (text.length > 0) text = text.slice(0, pos) + pick(rng, MUT_CHARS) + text.slice(pos + 1);
        break;
    }
    if (rng() < 0.1) text += pick(rng, MUT_WS);
  }
  return text;
}

function assertTypedError(err, kind, label) {
  assert.ok(
    err instanceof Error && new RegExp(`^${kind} parse error at line \\d+: `).test(err.message),
    `${label}: untyped error ${err?.constructor?.name}: ${err?.message}`,
  );
}

test("fuzz-parse: seed corpora still parse to their frozen goldens", () => {
  // Anchors the corpus: a corrupted seed flips this red deterministically.
  for (const seed of [...TOML_SEEDS, ...YAML_SEEDS]) {
    const parse = TOML_SEEDS.includes(seed) ? parseToml : parseYamlShallow;
    assert.equal(JSON.stringify(parse(seed.text)), seed.golden, `corpus drifted: ${seed.name}`);
  }
});

test("fuzz-parse: parseToml properties over seeded mutated inputs", () => {
  console.log(`[fuzz-parse] parseToml seed=0x${TOML_SEED.toString(16)} iterations=${ITERATIONS}`);
  const rng = mulberry32(TOML_SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const seed = pick(rng, TOML_SEEDS);
    const input = mutate(rng, seed.text);
    const label = `iter ${i} (seed corpus ${seed.name}) input ${JSON.stringify(input)}`;
    let v1;
    try {
      v1 = parseToml(input);
    } catch (err) {
      assertTypedError(err, "TOML", label);
      continue;
    }
    assert.ok(v1 !== null && typeof v1 === "object" && !Array.isArray(v1), label);
    // Fixed point (no silent divergence): reparsing the JSON serialization of a
    // successful parse either fails with a typed error (JSON's `k: v` colon
    // syntax is outside parseToml's `k = v` subset — the expected arm today)
    // or deep-equals the original value. A parse that silently returned a
    // DIFFERENT structure for a serialization would fail here.
    let v2;
    try {
      v2 = parseToml(JSON.stringify(v1));
    } catch (err) {
      assertTypedError(err, "TOML", `${label} (serialize/reparse cycle)`);
      continue;
    }
    assert.deepStrictEqual(v2, v1, `${label}: reparse diverged from fixed point`);
  }
});

test("fuzz-parse: parseYamlShallow properties over seeded mutated inputs", () => {
  console.log(
    `[fuzz-parse] parseYamlShallow seed=0x${YAML_SEED.toString(16)} iterations=${ITERATIONS}`,
  );
  const rng = mulberry32(YAML_SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const seed = pick(rng, YAML_SEEDS);
    const input = mutate(rng, seed.text);
    const label = `iter ${i} (seed corpus ${seed.name}) input ${JSON.stringify(input)}`;
    let v1;
    try {
      v1 = parseYamlShallow(input);
    } catch (err) {
      assertTypedError(err, "YAML", label);
      continue;
    }
    assert.ok(v1 !== null && typeof v1 === "object", label);
    // Fixed point (absorbing scalar-wrap): a shallow YAML parser cannot
    // round-trip a JSON serialization as a mapping (every colon of a JSON
    // document is brace-nested, so no top-level colon exists and the whole
    // single-line document parses as a bare scalar). The strongest true law:
    // reparse(serialize(v)) is EXACTLY { value: serialize(v) } — the
    // scalar-wrap is the absorbing fixed-point shape of the cycle, and the
    // serialized structure is preserved verbatim inside it.
    const s1 = JSON.stringify(v1);
    let v2;
    try {
      v2 = parseYamlShallow(s1);
    } catch (err) {
      assertTypedError(err, "YAML", `${label} (serialize/reparse cycle)`);
      continue;
    }
    assert.deepStrictEqual(v2, { value: s1 }, `${label}: absorbing scalar-wrap law violated`);
  }
});
