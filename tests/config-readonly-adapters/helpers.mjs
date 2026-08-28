import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csm-config-readonly-adapters-"));
  const ctx = { root, project: join(root, "repo"), xdg: join(root, "xdg") };
  await mkdir(ctx.project, { recursive: true });
  await mkdir(ctx.xdg, { recursive: true });
  return ctx;
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function layerEnv(ctx, extra = {}) {
  return { XDG_CONFIG_HOME: ctx.xdg, HOME: join(ctx.root, "home"), ...extra };
}

export function envelope(skills) {
  return { schema: "csm-skills-config/1", version: 1, skills };
}

export const AUTHORITY_FIELDS = ["credentials", "lifecycle", "writeScope"];
