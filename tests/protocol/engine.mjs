import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  rmdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, loadKeyring, validateEnvelope } from "./trust-policy.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const defaultEnvelopePath = join(root, "bootstrap/fixtures/valid.json");
const defaultIndexPath = join(root, "bootstrap/payload-index.json");
const defaultSourceRoot = join(root, "bootstrap/package");

export const EXIT_CODES = {
  PLACED: 0,
  E_NO_NPX: 1,
  E_NO_WRITE: 2,
  E_NO_DESTINATION: 3,
  E_AMBIGUOUS_DESTINATION: 4,
  E_UNTRUSTED: 5,
  E_UNSUPPORTED_FORMAT: 6,
  E_MALICIOUS_STEPS: 7,
  E_DESTINATION_SYMLINK: 8,
  E_TRAVERSAL: 9,
  E_DUPLICATE: 10,
  E_MODIFIED_EXISTING: 11,
  E_HASH_MISMATCH: 12,
  E_INTERRUPTED: 13,
};
export const PROTOCOL_STATES = [
  "DISCOVER",
  "TRUST",
  "PLAN_DESTINATION",
  "CONFIRM_IF_NEEDED",
  "MATERIALIZE",
  "VERIFY",
  "REPORT",
];
export const MANAGED_MARKER = ".csm-bootstrap.json";

const capabilityKeys = [
  "hasNpx",
  "hasFileWrite",
  "knowsDestination",
  "supportsStaging",
  "supportsLock",
  "supportsRollback",
  "knowsReload",
];
const classKeys = ["skills", "supportingFiles", "helperBins", "metadata"];
const placedPrefix = "payload/skills/";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const refuse = (state, code, message) => {
  const error = new Error(message);
  error.state = state;
  error.code = code;
  error.exitCode = EXIT_CODES[code];
  throw error;
};
const isSafeRelativePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value
    .split("/")
    .every((component) => component.length > 0 && component !== "." && component !== "..");
const isEntryShape = (entry) =>
  entry !== null &&
  typeof entry === "object" &&
  !Array.isArray(entry) &&
  typeof entry.path === "string" &&
  entry.path.length > 0 &&
  /^[a-f0-9]{64}$/.test(entry.sha256) &&
  Number.isInteger(entry.bytes) &&
  entry.bytes >= 0 &&
  /^[0-7]{3,4}$/.test(entry.mode);
const normalizeCapabilities = (input) => {
  const source = input && typeof input === "object" ? input : {};
  const capabilities = {};
  for (const key of capabilityKeys) capabilities[key] = source[key] === true;
  return capabilities;
};
const defaultTransport = {
  copyFile: async (source, target, mode) => {
    await copyFile(source, target);
    await chmod(target, mode);
  },
};
const defaultFinalizeTransport = defaultTransport;

async function pruneEmptyDirs(destination, relPaths) {
  const dirs = new Set();
  for (const rel of relPaths) {
    const parts = rel.split("/");
    for (let index = 0; index < parts.length - 1; index += 1)
      dirs.add(parts.slice(0, index + 1).join("/"));
  }
  const ordered = [...dirs].toSorted((a, b) =>
    a.length < b.length ? 1 : a.length > b.length ? -1 : 0,
  );
  for (const dir of ordered) {
    try {
      await rmdir(join(destination, dir));
    } catch {
      continue;
    }
  }
}

async function assertPlannableDestination(destination, state) {
  if (typeof destination !== "string" || !isAbsolute(destination))
    refuse(state, "E_NO_DESTINATION", "destination must be an absolute path");
  const { root: fsRoot } = parse(destination);
  const components = destination
    .slice(fsRoot.length)
    .split(sep)
    .filter((component) => component.length > 0);
  let current = fsRoot;
  for (const component of components) {
    current = join(current, component);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink())
      refuse(state, "E_DESTINATION_SYMLINK", `symlink component ${current}`);
    if (stat.isFile()) refuse(state, "E_NO_DESTINATION", `non-directory component ${current}`);
  }
}

// F-047: re-lstat the FULL parent chain — every component from the filesystem
// root down to the immediate parent directory — immediately before each final
// write, creating missing components one at a time and lstat-verifying each
// created component. This replaces the plan-time assertPlannableDestination
// inside MATERIALIZE and never uses recursive mkdir, which would traverse a
// symlink planted at a mid-depth component (creating attacker-chosen
// directories outside the destination). A component swapped after planning
// therefore refuses E_DESTINATION_SYMLINK at MATERIALIZE with zero writes
// through it. Residual window: a component swapped between this walk and the
// atomic rename inside the same directory cannot escape the re-validated parent
// inode and is caught by the post-write hash verification.
async function ensureWriteChain(target, state) {
  const { root: fsRoot } = parse(target);
  const components = dirname(target)
    .slice(fsRoot.length)
    .split(sep)
    .filter((component) => component.length > 0);
  let current = fsRoot;
  for (const component of components) {
    current = join(current, component);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink())
      refuse(state, "E_DESTINATION_SYMLINK", `symlink component ${current}`);
    if (!stat.isDirectory())
      refuse(state, "E_NO_DESTINATION", `non-directory component ${current}`);
  }
}

// F-047: the write target lives inside a parent chain that ensureWriteChain has
// just re-lstat-verified. The file is written to a fresh crypto-random temp
// name inside that re-validated directory and atomically renamed onto the final
// name. The temp path is reserved with O_CREAT|O_EXCL (flag 'wx') so a
// pre-planted entry at that name — for example a symlink — fails EEXIST instead
// of being followed; the name is random, so this is a second layer against a
// same-directory attacker who can predict names. rename() replaces any existing
// entry at the final name, including a symlink, rather than following it.
async function writeFileInValidatedDir(
  state,
  parent,
  target,
  source,
  mode,
  finalizeTransport,
  tmpName,
) {
  const tmp = join(parent, `.csm-tmp-${tmpName}`);
  try {
    const reserved = await open(tmp, "wx", 0o600);
    await reserved.close();
  } catch (error) {
    if (error.code === "EEXIST") refuse(state, "E_DESTINATION_SYMLINK", `planted temp path ${tmp}`);
    throw error;
  }
  try {
    await finalizeTransport.copyFile(source, tmp, mode);
    await rename(tmp, target);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      // best-effort temp cleanup
    }
    throw error;
  }
}

async function writeFileAtomic(parent, name, content, tmpName) {
  const tmp = join(parent, `.csm-tmp-${tmpName}`);
  try {
    await writeFile(tmp, content, { mode: 0o644, flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST")
      refuse("MATERIALIZE", "E_DESTINATION_SYMLINK", `planted temp path ${tmp}`);
    throw error;
  }
  await rename(tmp, join(parent, name));
}

async function copyTree(source, target) {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isDirectory()) await copyTree(join(source, entry.name), join(target, entry.name));
    else if (entry.isFile()) await copyFile(join(source, entry.name), join(target, entry.name));
  }
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function runProtocol(input) {
  const trace = [];
  const push = (state, action, refusal = null) => trace.push({ state, action, refusal });
  const capabilities = normalizeCapabilities(input?.capabilities);
  const now = input?.now !== undefined ? new Date(input.now) : new Date();
  // F-047 test seam: the temp-write name defaults to a fresh crypto-random hex
  // string per write; a caller may fix it (deterministic temp path) only for
  // planted-temp-path tests. Randomness makes the temp name unguessable.
  const tmpName =
    typeof input?.tmpName === "string" && input.tmpName.length > 0
      ? input.tmpName
      : randomBytes(16).toString("hex");
  let destination = null;
  let restoreFailed = false;
  try {
    push("DISCOVER", "accepted");
    if (!capabilities.hasNpx) refuse("DISCOVER", "E_NO_NPX", "exact-version npx is unavailable");
    if (!capabilities.hasFileWrite)
      refuse("DISCOVER", "E_NO_WRITE", "file-write capability is unavailable");

    push("TRUST", "accepted");
    const envelope =
      input?.envelope !== undefined ? input.envelope : await readJsonOrNull(defaultEnvelopePath);
    const indexInput = input?.index;
    const indexJson = indexInput !== undefined ? null : await readFile(defaultIndexPath, "utf8");
    const index = indexInput !== undefined ? indexInput : JSON.parse(indexJson);
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope))
      refuse("TRUST", "E_UNTRUSTED", "envelope is missing");
    const keyring = await loadKeyring();
    // R6: payload_index_sha256 binds a FILE-BYTE digest — the exact bytes of
    // the shipped payload-index.json (the same convention the shipped bin's
    // verify subcommand uses). When the index is supplied as an OBJECT the
    // engine hashes the deterministic canonical serialization (canonicalJson),
    // i.e. the same byte string a signer must produce via the shared signing
    // tooling; a signer binding an object-form index must serialize canonically
    // (see protocol.md for the documented limitation).
    const indexSha256 = indexJson !== null ? sha256(indexJson) : sha256(canonicalJson(indexInput));
    try {
      validateEnvelope(envelope, keyring, { now, indexSha256 });
    } catch (error) {
      if (error.code === "SHELL_POLICY") refuse("TRUST", "E_MALICIOUS_STEPS", error.message);
      refuse("TRUST", "E_UNTRUSTED", error.message);
    }
    if (index === null || typeof index !== "object" || Array.isArray(index))
      refuse("TRUST", "E_UNSUPPORTED_FORMAT", "payload index is missing");
    if (index.schema !== "csm-payload-index/1")
      refuse("TRUST", "E_UNSUPPORTED_FORMAT", "payload index schema mismatch");
    for (const classKey of classKeys) {
      if (!Array.isArray(index.classes?.[classKey]))
        refuse("TRUST", "E_UNSUPPORTED_FORMAT", `payload index class ${classKey} is malformed`);
      for (const entry of index.classes[classKey]) {
        if (!isEntryShape(entry))
          refuse(
            "TRUST",
            "E_UNSUPPORTED_FORMAT",
            `payload index entry in ${classKey} is malformed`,
          );
      }
    }
    if (!isEntryShape(index.fixedBin))
      refuse("TRUST", "E_UNSUPPORTED_FORMAT", "fixedBin entry is malformed");
    const needsTrustConfirmation = input?.trustRootApproved !== true;

    let ambiguous = false;
    const stated =
      typeof input?.destination === "string" && input.destination.length > 0
        ? input.destination
        : null;
    if (stated !== null) {
      await assertPlannableDestination(stated, "PLAN_DESTINATION");
      destination = stated;
      push("PLAN_DESTINATION", "planned");
    } else if (capabilities.knowsDestination) {
      refuse("PLAN_DESTINATION", "E_NO_DESTINATION", "destination is known but was not stated");
    } else if (
      Array.isArray(input?.destinationCandidates) &&
      input.destinationCandidates.length > 0
    ) {
      ambiguous = true;
      push("PLAN_DESTINATION", "ambiguous");
    } else {
      refuse("PLAN_DESTINATION", "E_NO_DESTINATION", "no destination is discoverable");
    }

    const confirmation = input?.confirmation !== undefined ? input.confirmation : null;
    if (!ambiguous && !needsTrustConfirmation) {
      push("CONFIRM_IF_NEEDED", "not-needed");
    } else {
      if (needsTrustConfirmation && confirmation?.trustRootApproved !== true)
        refuse("CONFIRM_IF_NEEDED", "E_UNTRUSTED", "trust root is not approved");
      if (ambiguous) {
        const confirmed =
          typeof confirmation?.destination === "string" && confirmation.destination.length > 0
            ? confirmation.destination
            : null;
        if (confirmed === null)
          refuse(
            "CONFIRM_IF_NEEDED",
            "E_AMBIGUOUS_DESTINATION",
            "destination is ambiguous and no confirmation was provided",
          );
        await assertPlannableDestination(confirmed, "CONFIRM_IF_NEEDED");
        destination = confirmed;
      }
      push("CONFIRM_IF_NEEDED", "confirmed");
    }

    push("MATERIALIZE", "staged");
    const sandbox =
      typeof input?.sandbox === "string" && isAbsolute(input.sandbox) ? input.sandbox : null;
    if (sandbox === null) refuse("MATERIALIZE", "E_NO_WRITE", "staging sandbox is unavailable");
    const sourceRoot = typeof input?.sourceRoot === "string" ? input.sourceRoot : defaultSourceRoot;
    const everyEntry = [
      ...classKeys.flatMap((classKey) => index.classes[classKey]),
      index.fixedBin,
    ];
    const seen = new Set();
    for (const entry of everyEntry) {
      if (!isSafeRelativePath(entry.path))
        refuse("MATERIALIZE", "E_TRAVERSAL", `payload entry escapes its root: ${entry.path}`);
      if (seen.has(entry.path))
        refuse("MATERIALIZE", "E_DUPLICATE", `duplicate payload entry: ${entry.path}`);
      seen.add(entry.path);
    }
    const placedEntries = [...index.classes.skills, ...index.classes.supportingFiles];
    for (const entry of placedEntries)
      if (!entry.path.startsWith(placedPrefix))
        refuse(
          "MATERIALIZE",
          "E_UNSUPPORTED_FORMAT",
          `placed entry outside payload/skills: ${entry.path}`,
        );
    const relOf = (entry) => entry.path.slice(placedPrefix.length);
    const skillDirs = [
      ...new Set(placedEntries.map((entry) => relOf(entry).split("/")[0])),
    ].toSorted();

    const marker = await readJsonOrNull(join(destination, MANAGED_MARKER));
    const managed = marker !== null && marker.schema === "csm-managed/1";
    const existingBefore = new Set();
    if (!managed) {
      for (const entry of placedEntries) {
        let existing;
        try {
          existing = await readFile(join(destination, relOf(entry)));
        } catch {
          continue;
        }
        if (sha256(existing) !== entry.sha256)
          refuse(
            "MATERIALIZE",
            "E_MODIFIED_EXISTING",
            `unmanaged differing file: ${join(destination, relOf(entry))}`,
          );
        existingBefore.add(relOf(entry));
      }
    }

    const staging = join(sandbox, "staging");
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const transport =
      input?.transport !== undefined && input.transport !== null
        ? input.transport
        : defaultTransport;
    try {
      for (const entry of placedEntries) {
        const target = join(staging, relOf(entry));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await transport.copyFile(join(sourceRoot, entry.path), target, parseInt(entry.mode, 8));
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      refuse("MATERIALIZE", "E_INTERRUPTED", `transport failed mid-copy: ${error.message}`);
    }

    push("VERIFY", "verified");
    for (const entry of placedEntries) {
      const staged = await readFile(join(staging, relOf(entry)));
      if (sha256(staged) !== entry.sha256) {
        await rm(staging, { recursive: true, force: true });
        refuse("VERIFY", "E_HASH_MISMATCH", `staged hash mismatch: ${entry.path}`);
      }
    }

    let backupPath = null;
    if (managed) {
      try {
        backupPath = join(sandbox, "backup");
        await rm(backupPath, { recursive: true, force: true });
        await mkdir(backupPath, { recursive: true, mode: 0o700 });
        for (const skill of skillDirs)
          await copyTree(join(destination, skill), join(backupPath, skill));
        for (const skill of skillDirs)
          await rm(join(destination, skill), { recursive: true, force: true });
      } catch (error) {
        refuse("MATERIALIZE", "E_INTERRUPTED", `managed backup failed: ${error.message}`);
      }
    }
    const filesPlaced = [];
    const finalizeTransport =
      input?.finalizeTransport !== undefined && input.finalizeTransport !== null
        ? input.finalizeTransport
        : defaultFinalizeTransport;
    try {
      for (const entry of placedEntries) {
        const target = join(destination, relOf(entry));
        const parent = dirname(target);
        await ensureWriteChain(target, "MATERIALIZE");
        await writeFileInValidatedDir(
          "MATERIALIZE",
          parent,
          target,
          join(staging, relOf(entry)),
          parseInt(entry.mode, 8),
          finalizeTransport,
          tmpName,
        );
        const placed = await readFile(target);
        if (sha256(placed) !== entry.sha256)
          throw Object.assign(new Error(`placed hash mismatch: ${entry.path}`), {
            code: "E_HASH_MISMATCH",
          });
        filesPlaced.push({
          path: relOf(entry),
          sha256: entry.sha256,
          bytes: entry.bytes,
          verified: true,
        });
      }
    } catch (error) {
      if (backupPath !== null) {
        try {
          for (const skill of skillDirs)
            await rm(join(destination, skill), { recursive: true, force: true });
          for (const skill of skillDirs)
            await copyTree(join(backupPath, skill), join(destination, skill));
        } catch {
          restoreFailed = true;
        }
      } else {
        const created = placedEntries
          .map((entry) => relOf(entry))
          .filter((path) => !existingBefore.has(path));
        for (const rel of created) await rm(join(destination, rel), { force: true });
        if (created.length > 0) await pruneEmptyDirs(destination, created);
      }
      await rm(staging, { recursive: true, force: true });
      if (error.code === "E_HASH_MISMATCH") refuse("VERIFY", "E_HASH_MISMATCH", error.message);
      if (Object.prototype.hasOwnProperty.call(EXIT_CODES, error.code)) throw error;
      refuse("MATERIALIZE", "E_INTERRUPTED", `finalization transport failed: ${error.message}`);
    }
    await rm(staging, { recursive: true, force: true });
    await writeFileAtomic(
      destination,
      MANAGED_MARKER,
      `${JSON.stringify({ schema: "csm-managed/1", protocol: "csm-skills-bootstrap/1", payload_release: envelope.policy?.payload_release ?? null, skills: skillDirs }, null, 2)}\n`,
      tmpName,
    );

    push("REPORT", "emitted");
    const reloadAction = capabilities.knowsReload
      ? {
          status: "declared",
          action:
            typeof input?.reloadAction === "string" && input.reloadAction.length > 0
              ? input.reloadAction
              : null,
        }
      : { status: "unknown", action: null };
    const limitations = ["capabilities-are-agent-reported"];
    if (!capabilities.knowsReload) limitations.push("reload-unknown");
    if (!capabilities.supportsLock) limitations.push("locking-unavailable");
    return {
      exitCode: EXIT_CODES.PLACED,
      report: {
        schema: "csm-agent-report/1",
        protocol: "csm-skills-bootstrap/1",
        result: "placed",
        exitCode: EXIT_CODES.PLACED,
        states: trace,
        destination,
        skillsPlaced: skillDirs,
        filesPlaced,
        hashVerification: {
          algorithm: "sha256",
          verified: filesPlaced.length,
          total: placedEntries.length,
        },
        reloadAction,
        capabilities,
        availability: {
          staging: true,
          locking: capabilities.supportsLock,
          rollback: backupPath !== null,
        },
        backupPath,
        limitations,
      },
    };
  } catch (error) {
    if (!Object.prototype.hasOwnProperty.call(EXIT_CODES, error.code)) throw error;
    const reloadAction = capabilities.knowsReload
      ? { status: "declared", action: null }
      : { status: "unknown", action: null };
    const limitations = ["capabilities-are-agent-reported"];
    if (!capabilities.knowsReload) limitations.push("reload-unknown");
    if (!capabilities.supportsLock) limitations.push("locking-unavailable");
    if (restoreFailed) limitations.push("restore-failed");
    push(error.state, "refused", error.code);
    return {
      exitCode: error.exitCode,
      report: {
        schema: "csm-agent-report/1",
        protocol: "csm-skills-bootstrap/1",
        result: "refused",
        exitCode: error.exitCode,
        refusal: { code: error.code, state: error.state },
        states: trace,
        destination: null,
        skillsPlaced: [],
        filesPlaced: [],
        hashVerification: { algorithm: "sha256", verified: 0, total: 0 },
        reloadAction,
        capabilities,
        availability: { staging: false, locking: capabilities.supportsLock, rollback: false },
        backupPath: null,
        limitations,
      },
    };
  }
}
