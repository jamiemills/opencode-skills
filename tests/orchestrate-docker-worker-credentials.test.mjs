import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

import {
  attestDockerWorker,
  parseInspect,
} from "../csm-orchestrate/lib/docker-worker-provider.mjs";

const DOCKER_AVAILABLE = (() => {
  try {
    return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

// Docker reports a container's environment at top-level `Config.Env`; it never
// emits `HostConfig.Env`. These fixtures encode the real `docker inspect` shape.
const inspectJson = ({ env, omitConfig = false, envOverride } = {}) => {
  const entry = {
    Id: "cid-credentials",
    Image: "sha256:image",
    RepoDigests: [],
    Mounts: [],
    HostConfig: {
      ReadonlyRootfs: true,
      NetworkMode: "none",
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: 512,
      Memory: 2147483648,
      Init: true,
      Mounts: [],
      Binds: [],
    },
  };
  if (!omitConfig) entry.Config = { Env: envOverride !== undefined ? envOverride : env };
  return JSON.stringify([entry]);
};

test("parseInspect reads container env from Config.Env", () => {
  const inspect = parseInspect(inspectJson({ env: ["CSM_SECRET_MARKER=leaked", "PATH=/usr/bin"] }));
  assert.deepEqual(inspect.env, ["CSM_SECRET_MARKER=leaked", "PATH=/usr/bin"]);
  assert.equal(inspect.envReadable, true);
});

test("credentialsNone is false when a credential-shaped variable is present", () => {
  assert.equal(
    attestDockerWorker(parseInspect(inspectJson({ env: ["AWS_ACCESS_KEY_ID=AKIA"] })))
      .credentialsNone,
    false,
  );
  assert.equal(
    attestDockerWorker(parseInspect(inspectJson({ env: ["GITHUB_TOKEN=ghp_x"] }))).credentialsNone,
    false,
  );
  assert.equal(
    attestDockerWorker(parseInspect(inspectJson({ env: ["MYSQL_PWD=hunter2"] }))).credentialsNone,
    false,
  );
  assert.equal(
    attestDockerWorker(parseInspect(inspectJson({ env: ["CI_JOB_JWT=eyJhbGci"] }))).credentialsNone,
    false,
  );
});

test("credentialsNone is false when a URL value embeds userinfo", () => {
  const inspect = parseInspect(
    inspectJson({ env: ["DATABASE_URL=postgres://user:pw@host/db", "PATH=/usr/bin"] }),
  );
  assert.equal(attestDockerWorker(inspect).credentialsNone, false);
});

test("credentialsNone is true for a real container with only benign defaults", () => {
  const inspect = parseInspect(
    inspectJson({
      env: ["PATH=/usr/local/bin", "HOSTNAME=abc", "LANG=C.UTF-8", "NODE_VERSION=22.0.0"],
    }),
  );
  assert.equal(attestDockerWorker(inspect).credentialsNone, true);
});

test("benign names that merely contain 'token' or 'key' are not credentials", () => {
  const inspect = parseInspect(
    inspectJson({
      env: ["TOKENIZERS_PARALLELISM=false", "PUBLIC_KEY=ssh-rsa AAAA", "SORT_KEY=asc"],
    }),
  );
  assert.equal(attestDockerWorker(inspect).credentialsNone, true);
});

test("a HostConfig.Env field is ignored because Docker never emits it", () => {
  const raw = JSON.parse(inspectJson({ env: [] }));
  raw[0].HostConfig.Env = ["API_KEY=should-not-count"];
  const inspect = parseInspect(JSON.stringify(raw));
  assert.deepEqual(inspect.env, []);
  assert.equal(attestDockerWorker(inspect).credentialsNone, true);
});

test("an unreadable env fails closed as credentialsNone=false", () => {
  // Config present but Env is not an array.
  const nonArray = parseInspect(inspectJson({ envOverride: "AWS_SECRET_ACCESS_KEY=leak" }));
  assert.equal(nonArray.envReadable, false);
  assert.equal(attestDockerWorker(nonArray).credentialsNone, false);
  // Config absent entirely.
  const absent = parseInspect(inspectJson({ omitConfig: true }));
  assert.equal(absent.envReadable, false);
  assert.equal(attestDockerWorker(absent).credentialsNone, false);
});

test(
  "a real container with -e SECRET reports credentialsNone=false (docker-gated)",
  { skip: !DOCKER_AVAILABLE },
  () => {
    const name = `csm-cred-${process.pid}`;
    try {
      execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--rm",
          "--name",
          name,
          "-e",
          "CSM_SECRET_MARKER=leaked",
          "node:22-bookworm-slim",
          "sleep",
          "30",
        ],
        { stdio: "ignore" },
      );
      const raw = execFileSync("docker", ["inspect", name], { encoding: "utf8" });
      const inspect = parseInspect(raw);
      assert.equal(
        inspect.env.some((entry) => entry.startsWith("CSM_SECRET_MARKER=")),
        true,
      );
      assert.equal(attestDockerWorker(inspect).credentialsNone, false);
    } finally {
      spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    }
  },
);
