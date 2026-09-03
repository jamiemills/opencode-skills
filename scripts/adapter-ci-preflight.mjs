import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const uid = process.getuid();
const root = resolve(process.env.RUNNER_TEMP || tmpdir(), "csm-adapter-runtime");

async function validate(path, { requirePrivate = false } = {}) {
  const absolute = resolve(path);
  const parts = absolute.split("/");
  let current = parts[0] || "/";
  for (const part of parts.slice(1)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(`unsafe path component: ${current}`);
    const canonical = await realpath(current);
    if (canonical !== current) throw new Error(`path realpath changed: ${current} -> ${canonical}`);
    const stickyShared = (info.mode & 0o7777) === 0o1777;
    const rootOwnedNonWritable = info.uid === 0 && (info.mode & 0o22) === 0;
    if (info.uid !== uid && !stickyShared && !rootOwnedNonWritable)
      throw new Error(`unsafe path ownership: ${current}`);
    if (info.uid === uid && (info.mode & 0o22) !== 0 && !stickyShared)
      throw new Error(`unsafe path mode: ${current}`);
  }
  const info = await lstat(absolute);
  if (!info.isDirectory()) throw new Error(`unsafe private directory: ${absolute}`);
  if (requirePrivate && (info.uid !== uid || (info.mode & 0o7777) !== 0o700))
    throw new Error(`unsafe private directory: ${absolute}`);
  return absolute;
}

async function ensurePrivate(path) {
  const absolute = resolve(path);
  const parts = absolute.split("/");
  let current = parts[0] || "/";
  for (const part of parts.slice(1)) {
    current = join(current, part);
    try {
      await validate(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      await validate(current);
    }
  }
  return validate(absolute, { requirePrivate: true });
}

await ensurePrivate(root);
const paths = {
  home: join(root, "home"),
  config: join(root, "config"),
  data: join(root, "data"),
  state: join(root, "state"),
  runtime: join(root, "runtime"),
  sessions: join(root, "sessions"),
};
for (const path of Object.values(paths)) await ensurePrivate(path);
const browserConfig = join(paths.config, "csm-browse");
await ensurePrivate(browserConfig);
await ensurePrivate(join(browserConfig, "container-config"));

const output =
  Object.entries({
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    XDG_RUNTIME_DIR: paths.runtime,
    CSM_BROWSE_SESSIONS_ROOT: paths.sessions,
    CSM_BROWSE_CONFIG_ROOT: browserConfig,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
const outputArg = process.argv.indexOf("--output");
const envFile = outputArg >= 0 ? process.argv[outputArg + 1] : process.env.ADAPTER_ENV_FILE;
const outputPath = resolve(envFile || join(root, "adapter-env"));
await writeFile(outputPath, output, { flag: "w", mode: 0o600 });
if (process.env.GITHUB_ENV && process.env.GITHUB_ENV !== outputPath)
  await writeFile(process.env.GITHUB_ENV, output, { flag: "a", mode: 0o600 });
console.log(`Validated private adapter runtime components under ${root}`);
