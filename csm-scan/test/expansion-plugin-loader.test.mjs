import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { loadPlugins, PluginLoaderError } from "../lib/scan/plugins/loader.mjs";
import {
  PLUGIN_API_VERSION,
  PLUGIN_LIMITS,
  PLUGIN_REGEX_FLAGS,
  PluginSchemaError,
  validatePlugin,
  validatePlugins,
} from "../lib/scan/plugins/schema.mjs";

function capability(dimensionId, categories) {
  return { dimensionId, categories };
}

function provider(id, dimensions) {
  return { id, apiVersion: 1, dimensions };
}

function rule(id, dimensionId, category, selectors = { extensions: [".fixture"] }) {
  return { id, label: "Fixture artifact", dimensionId, category, ...selectors };
}

function plugin(id, overrides = {}) {
  return {
    id,
    apiVersion: 1,
    label: `${id[0].toUpperCase()}${id.slice(1)} language`,
    aliases: [`${id}-alias`],
    providers: [provider(`PRV-${id}-v1`, [capability("DIM-api-v1", ["route"])])],
    rules: [rule(`RUL-${id}-route-v1`, "DIM-api-v1", "route")],
    ...overrides,
  };
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "csm-scan-plugin-loader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writePlugin(root, value, directory = value.id, source = JSON.stringify(value)) {
  const path = join(root, "plugins", directory, "plugin.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
  return path;
}

test("T203 API and valid deterministic registry snapshot are exact and immutable", async (t) => {
  assert.equal(PLUGIN_API_VERSION, 1);
  assert.equal(PLUGIN_REGEX_FLAGS, "u");
  assert.deepEqual(PLUGIN_LIMITS, {
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

  const root = await temporaryRoot(t);
  const zeta = plugin("zeta", {
    aliases: ["z-lang", "zeta-lang"],
    providers: [provider("PRV-zeta-v1", [capability("DIM-stack-v1", ["language", "runtime"])])],
    rules: [
      rule("RUL-zeta-runtime-v1", "DIM-stack-v1", "runtime", {
        extensions: [".zeta"],
        basenames: ["Zetafile"],
        manifestNames: ["zeta.json"],
        artifactTokens: ["config/zeta"],
        regexSource: "^runtime:[ ]+[A-Za-z0-9._-]+$",
      }),
    ],
  });
  const alpha = plugin("alpha", {
    aliases: ["a-lang"],
    rules: [
      rule("RUL-alpha-route-v1", "DIM-api-v1", "route", {
        extensions: [".alpha"],
        literal: "route:",
      }),
    ],
  });
  await writePlugin(root, zeta);
  await writePlugin(root, alpha);

  const loaded = await loadPlugins({ skillRoot: root });
  assert.deepEqual(loaded, [
    {
      id: "alpha",
      apiVersion: 1,
      label: "Alpha language",
      aliases: ["a-lang"],
      providers: [
        {
          id: "PRV-alpha-v1",
          apiVersion: 1,
          dimensions: [{ dimensionId: "DIM-api-v1", categories: ["route"] }],
        },
      ],
      rules: [
        {
          id: "RUL-alpha-route-v1",
          label: "Fixture artifact",
          extensions: [".alpha"],
          basenames: [],
          manifestNames: [],
          artifactTokens: [],
          dimensionId: "DIM-api-v1",
          category: "route",
          literal: "route:",
          regexSource: null,
        },
      ],
    },
    {
      id: "zeta",
      apiVersion: 1,
      label: "Zeta language",
      aliases: ["z-lang", "zeta-lang"],
      providers: [
        {
          id: "PRV-zeta-v1",
          apiVersion: 1,
          dimensions: [{ dimensionId: "DIM-stack-v1", categories: ["language", "runtime"] }],
        },
      ],
      rules: [
        {
          id: "RUL-zeta-runtime-v1",
          label: "Fixture artifact",
          extensions: [".zeta"],
          basenames: ["Zetafile"],
          manifestNames: ["zeta.json"],
          artifactTokens: ["config/zeta"],
          dimensionId: "DIM-stack-v1",
          category: "runtime",
          literal: null,
          regexSource: "^runtime:[ ]+[A-Za-z0-9._-]+$",
        },
      ],
    },
  ]);
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded[0].rules[0]));
  assert.throws(() => loaded.push(alpha), TypeError);
});

test("T203 only an absent plugins directory produces an empty registry", async (t) => {
  const root = await temporaryRoot(t);
  assert.deepEqual(await loadPlugins({ skillRoot: root }), []);
  await assert.rejects(
    loadPlugins({ skillRoot: join(root, "missing") }),
    (error) => error instanceof PluginLoaderError && error.code === "FILESYSTEM",
  );
});

test("T203 rejects malformed and oversized JSON without reflecting content", async (t) => {
  const malformedRoot = await temporaryRoot(t);
  await writePlugin(malformedRoot, plugin("broken"), "broken", '{"secret":"raw-attacker-value"');
  await assert.rejects(
    loadPlugins({ skillRoot: malformedRoot }),
    (error) => error.code === "MALFORMED_JSON" && !error.message.includes("raw-attacker-value"),
  );

  const oversizedRoot = await temporaryRoot(t);
  await writePlugin(
    oversizedRoot,
    plugin("large"),
    "large",
    `{"padding":"${"x".repeat(PLUGIN_LIMITS.fileBytes)}"}`,
  );
  await assert.rejects(
    loadPlugins({ skillRoot: oversizedRoot }),
    (error) => error.code === "FILE_TOO_LARGE",
  );
});

test("T203 rejects symlink skill roots, plugin roots, plugin directories, and files", async (t) => {
  const root = await temporaryRoot(t);
  const realSkill = join(root, "real-skill");
  await mkdir(realSkill);
  const linkedSkill = join(root, "linked-skill");
  await symlink(realSkill, linkedSkill, "dir");
  await assert.rejects(
    loadPlugins({ skillRoot: linkedSkill }),
    (error) => error.code === "SYMLINK",
  );

  const pluginRootSkill = join(root, "plugin-root-skill");
  const externalPlugins = join(root, "external-plugins");
  await mkdir(pluginRootSkill);
  await mkdir(externalPlugins);
  await symlink(externalPlugins, join(pluginRootSkill, "plugins"), "dir");
  await assert.rejects(
    loadPlugins({ skillRoot: pluginRootSkill }),
    (error) => error.code === "SYMLINK",
  );

  const directorySkill = join(root, "directory-skill");
  await mkdir(join(directorySkill, "plugins"), { recursive: true });
  const externalPlugin = join(root, "external-plugin");
  await mkdir(externalPlugin);
  await symlink(externalPlugin, join(directorySkill, "plugins", "linked"), "dir");
  await assert.rejects(
    loadPlugins({ skillRoot: directorySkill }),
    (error) => error.code === "SYMLINK",
  );

  const fileSkill = join(root, "file-skill");
  const target = join(root, "target.json");
  await writeFile(target, JSON.stringify(plugin("linked")));
  await mkdir(join(fileSkill, "plugins", "linked"), { recursive: true });
  await symlink(target, join(fileSkill, "plugins", "linked", "plugin.json"), "file");
  await assert.rejects(loadPlugins({ skillRoot: fileSkill }), (error) => error.code === "SYMLINK");
});

test("T203 rejects relative, non-normalized, symlink-contained, and non-direct layouts", async (t) => {
  await assert.rejects(
    loadPlugins({ skillRoot: "relative/root" }),
    (error) => error.code === "INVALID_ROOT",
  );
  const root = await temporaryRoot(t);
  await assert.rejects(
    loadPlugins({ skillRoot: `${root}/child/..` }),
    (error) => error.code === "INVALID_ROOT",
  );

  const actual = join(root, "actual");
  await mkdir(actual);
  const ancestorLink = join(root, "ancestor-link");
  await symlink(root, ancestorLink, "dir");
  await assert.rejects(
    loadPlugins({ skillRoot: join(ancestorLink, "actual") }),
    (error) => error.code === "SYMLINK",
  );

  const nested = join(root, "nested-skill");
  await mkdir(join(nested, "plugins", "group", "nested"), { recursive: true });
  await writeFile(
    join(nested, "plugins", "group", "nested", "plugin.json"),
    JSON.stringify(plugin("nested")),
  );
  await assert.rejects(
    loadPlugins({ skillRoot: nested }),
    (error) => error.code === "INVALID_LAYOUT",
  );

  const extra = join(root, "extra-skill");
  await writePlugin(extra, plugin("extra"));
  await writeFile(join(extra, "plugins", "extra", "module.mjs"), "export default () => ({})");
  await assert.rejects(
    loadPlugins({ skillRoot: extra }),
    (error) => error.code === "INVALID_LAYOUT",
  );
});

test("T203 enforces directory identity and safe relative artifact selectors", async (t) => {
  const mismatch = await temporaryRoot(t);
  await writePlugin(mismatch, plugin("actual"), "different");
  await assert.rejects(
    loadPlugins({ skillRoot: mismatch }),
    (error) => error.code === "DIRECTORY_ID_MISMATCH",
  );

  for (const [field, value] of [
    ["id", "../escape"],
    ["id", "/absolute"],
    ["aliases", ["../alias"]],
    ["artifactTokens", ["../secret"]],
    ["artifactTokens", ["/absolute"]],
    ["artifactTokens", ["C:/absolute"]],
    ["artifactTokens", ["safe/../../secret"]],
    ["basenames", ["nested/file"]],
    ["manifestNames", ["../manifest.json"]],
    ["extensions", ["../ext"]],
  ]) {
    const valueUnderTest =
      field === "id"
        ? plugin(value)
        : field === "aliases"
          ? plugin("safe", { aliases: value })
          : plugin("safe", {
              rules: [rule("RUL-safe-route-v1", "DIM-api-v1", "route", { [field]: value })],
            });
    assert.throws(() => validatePlugin(valueUnderTest), PluginSchemaError, `${field}:${value}`);
  }
});

test("T203 rejects versions, unknown fields, executable fields, invalid types, and bounds", () => {
  const base = plugin("strict");
  for (const value of [
    { ...base, apiVersion: 2 },
    { ...base, unknown: true },
    { ...base, hooks: ["beforeScan"] },
    { ...base, imports: ["./module.mjs"] },
    { ...base, command: ["node", "plugin.mjs"] },
    { ...base, env: { TOKEN: "value" } },
    { ...base, cli: "--plugin" },
    { ...base, markdown: "# template" },
    { ...base, template: "{{value}}" },
    { ...base, aliases: "strict-alias" },
    {
      ...base,
      aliases: Array.from({ length: PLUGIN_LIMITS.aliases + 1 }, (_, index) => `alias-${index}`),
    },
    { ...base, providers: [] },
    { ...base, providers: Array(PLUGIN_LIMITS.providers + 1).fill(base.providers[0]) },
    { ...base, rules: [] },
    { ...base, rules: Array(PLUGIN_LIMITS.rules + 1).fill(base.rules[0]) },
    { ...base, label: "x".repeat(PLUGIN_LIMITS.label + 1) },
    { ...base, rules: [{ ...base.rules[0], run: "module.mjs" }] },
    { ...base, rules: [{ ...base.rules[0], regex: /route/u }] },
    { ...base, rules: [{ ...base.rules[0], flags: "gi", regexSource: "route" }] },
  ])
    assert.throws(() => validatePlugin(value), PluginSchemaError);

  assert.throws(() => validatePlugins(Array(PLUGIN_LIMITS.plugins + 1).fill(base)), /bounded/);
  assert.throws(
    () => validatePlugin({ ...base, run() {} }),
    (error) => error.code === "DATA_ONLY",
  );
});

test("T203 bounds strings and rejects regex syntax and complexity hazards under fixed flags", () => {
  const base = plugin("regex");
  const withRegex = (regexSource) => ({
    ...base,
    rules: [
      rule("RUL-regex-route-v1", "DIM-api-v1", "route", { extensions: [".rx"], regexSource }),
    ],
  });
  assert.equal(
    validatePlugin(withRegex("^route\\s+[A-Za-z0-9._-]+$")).rules[0].regexSource,
    "^route\\s+[A-Za-z0-9._-]+$",
  );
  for (const source of [
    "x".repeat(PLUGIN_LIMITS.regexSource + 1),
    "(?=secret)",
    "(a+)+",
    "a**",
    "(a)\\1",
    "\\p{Letter}+",
    ".*a.*b",
    "[unterminated",
    "[]",
    "[z-a]",
    "(unterminated",
    "a|",
    "^*",
    "$+",
    "a{1,4}",
  ])
    assert.throws(() => validatePlugin(withRegex(source)), PluginSchemaError, source);

  assert.throws(
    () =>
      validatePlugin({
        ...base,
        rules: [
          rule("RUL-regex-route-v1", "DIM-api-v1", "route", {
            extensions: [".rx"],
            literal: "route",
            regexSource: "route",
          }),
        ],
      }),
    (error) => error.code === "INVALID_MATCH",
  );
  assert.throws(
    () =>
      validatePlugin({
        ...base,
        rules: [
          rule("RUL-regex-route-v1", "DIM-api-v1", "route", {
            extensions: [".rx"],
            literal: "x".repeat(PLUGIN_LIMITS.literal + 1),
          }),
        ],
      }),
    PluginSchemaError,
  );
});

test("T203R1 rejects overlapping quantified atoms while keeping safe partition patterns", () => {
  const base = plugin("partition");
  const withRegex = (regexSource) => ({
    ...base,
    rules: [
      rule("RUL-partition-route-v1", "DIM-api-v1", "route", { extensions: [".px"], regexSource }),
    ],
  });
  for (const source of [
    "a*a*",
    "[a-z]*[a-z]*",
    "[a-z]+[b-z]+",
    ".*.*",
    ".*a*",
    "\\d*\\w*",
    "\\w*\\d*",
    "\\d*[0-9]*",
    "[\\w]*[A-Za-z0-9_]*",
    "\\s*\\w*",
  ]) {
    assert.throws(
      () => validatePlugin(withRegex(source)),
      (error) => {
        assert.ok(error instanceof PluginSchemaError);
        assert.equal(error.code, "REGEX_COMPLEXITY");
        return true;
      },
      source,
    );
  }
  for (const source of [
    "^runtime:[ ]+[A-Za-z0-9._-]+$",
    "^[.]?[A-Za-z0-9._-]+$",
    "^[A-Za-z0-9._-]+$",
    "^route\\s+[A-Za-z0-9._-]+$",
    "\\s+[A-Za-z0-9._-]+",
    "[ ]+[A-Za-z0-9._-]+",
    "a*b*c*",
    "a*b*a",
  ]) {
    assert.equal(validatePlugin(withRegex(source)).rules[0].regexSource, source);
  }
});

test("T203 rejects duplicate plugin identities, aliases, rules, providers, and capabilities", () => {
  const first = plugin("first");
  assert.throws(
    () => validatePlugins([first, first]),
    (error) => error.code === "DUPLICATE_ALIAS",
  );
  assert.throws(
    () => validatePlugins([first, plugin("second", { aliases: ["first-alias"] })]),
    (error) => error.code === "DUPLICATE_ALIAS",
  );
  assert.throws(
    () =>
      validatePlugin({
        ...first,
        rules: [first.rules[0], first.rules[0]],
      }),
    (error) => error.code === "DUPLICATE_RULE",
  );
  assert.throws(
    () =>
      validatePlugins([
        first,
        plugin("second", {
          providers: [provider("PRV-second-v1", [capability("DIM-stack-v1", ["runtime"])])],
          rules: [
            { ...rule(first.rules[0].id, "DIM-stack-v1", "runtime"), extensions: [".second"] },
          ],
        }),
      ]),
    (error) => error.code === "DUPLICATE_RULE",
  );
  assert.throws(
    () =>
      validatePlugin({
        ...first,
        providers: [first.providers[0], first.providers[0]],
      }),
    (error) => error.code === "DUPLICATE_PROVIDER",
  );
  assert.throws(
    () => validatePlugins([first, plugin("second", { providers: [{ ...first.providers[0] }] })]),
    (error) => error.code === "DUPLICATE_PROVIDER",
  );
  assert.throws(
    () =>
      validatePlugin({
        ...first,
        providers: [
          provider("PRV-first-v1", [
            capability("DIM-api-v1", ["route"]),
            capability("DIM-api-v1", ["rpc"]),
          ]),
        ],
      }),
    (error) => error.code === "INVALID_PROVIDER",
  );
  const sharing = validatePlugins([
    first,
    plugin("second", {
      providers: [provider("PRV-second-v1", [capability("DIM-api-v1", ["route"])])],
    }),
  ]);
  assert.equal(
    sharing.length,
    2,
    "distinct plugins may both contribute the same dimension/category",
  );
});

test("T203 validates categories through T202 and rejects rule capability mismatches", () => {
  const base = plugin("category");
  assert.throws(
    () =>
      validatePlugin({
        ...base,
        providers: [provider("PRV-category-v1", [capability("DIM-api-v1", ["runtime"])])],
      }),
    (error) => error.code === "INVALID_PROVIDER",
  );
  assert.throws(
    () =>
      validatePlugin({
        ...base,
        rules: [rule("RUL-category-runtime-v1", "DIM-stack-v1", "runtime")],
      }),
    (error) => error.code === "CATEGORY_MISMATCH",
  );
});

test("T203 errors are typed and sanitized across filesystem, JSON, schema, and regex failures", async (t) => {
  const root = await temporaryRoot(t);
  const secret = "attacker-secret-regex-value";
  await writePlugin(
    root,
    plugin("unsafe", {
      rules: [
        rule("RUL-unsafe-route-v1", "DIM-api-v1", "route", {
          extensions: [".unsafe"],
          regexSource: `(?=${secret})`,
        }),
      ],
    }),
  );
  await assert.rejects(loadPlugins({ skillRoot: root }), (error) => {
    assert.ok(error instanceof PluginLoaderError);
    assert.equal(error.name, "PluginLoaderError");
    assert.equal(error.code, "REGEX_COMPLEXITY");
    assert.equal(error.message.includes(root), false);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes("(?="), false);
    return true;
  });
});

test("T203 loading is atomic when a malformed entry follows a valid entry", async (t) => {
  const root = await temporaryRoot(t);
  await writePlugin(root, plugin("a-valid"));
  await writePlugin(root, plugin("z-invalid"), "z-invalid", "{not-json");
  let published = "unchanged";
  try {
    published = await loadPlugins({ skillRoot: root });
  } catch (error) {
    assert.ok(error instanceof PluginLoaderError);
    assert.equal(error.code, "MALFORMED_JSON");
  }
  assert.equal(published, "unchanged");
});

test("T203R1 enumerates the plugin root with a bounded opendir sweep and preserves sorted order at the limit", async (t) => {
  const root = await temporaryRoot(t);
  for (let index = 0; index < PLUGIN_LIMITS.plugins; index++) {
    await writePlugin(root, plugin(`plug-${String(index).padStart(2, "0")}`));
  }
  const loaded = await loadPlugins({ skillRoot: root });
  assert.equal(loaded.length, PLUGIN_LIMITS.plugins);
  assert.equal(loaded[0].id, "plug-00");
  assert.equal(loaded[loaded.length - 1].id, "plug-63");
});

test("T203R1 fails PLUGIN_LIMIT at the count cap without materializing or touching later entries", async (t) => {
  const root = await temporaryRoot(t);
  for (let index = 0; index <= PLUGIN_LIMITS.plugins; index++) {
    await writePlugin(root, plugin(`plug-${String(index).padStart(2, "0")}`));
  }
  await writePlugin(root, plugin("trap"), "0-trap", "{trap-json");
  await assert.rejects(loadPlugins({ skillRoot: root }), (error) => {
    assert.ok(error instanceof PluginLoaderError);
    assert.equal(error.code, "PLUGIN_LIMIT");
    assert.equal(error.message.includes("trap"), false);
    assert.equal(error.message.includes("{trap-json"), false);
    return true;
  });
});
