import { enumerate } from "../shared/enum.mjs";
import { isIgnoredPath } from "../shared/ignore.mjs";

const MAX_ENTRIES = 20;
const MAX_DEPTH = 3;

function computeDepth(files) {
  let max = 0;
  for (const f of files) {
    const segs = String(f).replace(/^\.\//, "").split("/").filter(Boolean).length;
    if (segs - 1 > max) max = segs - 1;
  }
  return max;
}

function buildChildren(files) {
  const children = new Map();
  const ensure = (k) => {
    if (!children.has(k)) children.set(k, new Set());
    return children.get(k);
  };
  ensure("");
  for (const file of files) {
    const clean = String(file).replace(/^\.\//, "");
    const segs = clean.split("/");
    let cur = "";
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg) continue;
      ensure(cur).add(seg);
      const childKey = cur === "" ? seg : `${cur}/${seg}`;
      cur = childKey;
      if (i + 1 < segs.length) ensure(childKey);
    }
  }
  return children;
}

function isDir(children, key) {
  return children.has(key) && children.get(key).size > 0;
}

function sortNames(children, key, names) {
  return names.toSorted((a, b) => {
    const aKey = key === "" ? a : `${key}/${a}`;
    const bKey = key === "" ? b : `${key}/${b}`;
    const aDir = isDir(children, aKey);
    const bDir = isDir(children, bKey);
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function renderTree(children, rootName) {
  const lines = [`${rootName}/`];

  function recurse(key, prefix, level) {
    const set = children.get(key);
    if (!set || set.size === 0) return;
    const names = sortNames(children, key, [...set]);
    const total = names.length;
    const capped = total > MAX_ENTRIES;
    const shown = capped ? names.slice(0, MAX_ENTRIES - 1) : names;

    for (let i = 0; i < shown.length; i++) {
      const name = shown[i];
      const childKey = key === "" ? name : `${key}/${name}`;
      const dir = isDir(children, childKey);
      const isLast = !capped && i === shown.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const beyond = dir && level >= MAX_DEPTH;
      const label = beyond ? `${name}/ (…)` : dir ? `${name}/` : name;
      lines.push(`${prefix}${connector}${label}`);
      if (dir && !beyond) {
        recurse(childKey, prefix + (isLast ? "    " : "│   "), level + 1);
      }
    }

    if (capped) {
      lines.push(`${prefix}└── … +${total - shown.length} more`);
    }
  }

  recurse("", "", 1);
  return lines.join("\n");
}

function topDirectories(children) {
  const set = children.get("");
  if (!set) return [];
  const out = [];
  for (const name of set) {
    if (isIgnoredPath(name)) continue;
    if (isDir(children, name)) out.push(name);
  }
  return out.toSorted();
}

export async function scan(repoPath, overview) {
  let files;
  let extCounts;
  let totalFiles;
  let gitTrackedTotalFiles = null;
  let gitTrackedExtCounts = null;

  const hasOverview =
    overview &&
    Array.isArray(overview.files) &&
    overview.extCounts &&
    typeof overview.extCounts === "object";

  if (hasOverview) {
    files = overview.files;
    extCounts = overview.extCounts;
    totalFiles = overview.totalFiles != null ? overview.totalFiles : files.length;
    if (overview.gitTrackedTotalFiles != null) {
      gitTrackedTotalFiles = overview.gitTrackedTotalFiles;
      gitTrackedExtCounts = overview.gitTrackedExtCounts || {};
    }
  } else {
    try {
      const result = await enumerate(repoPath);
      files = result.files;
      extCounts = result.extCounts;
      totalFiles = result.totalFiles;
      if (result.gitTracked && result.gitTracked.available) {
        gitTrackedTotalFiles = result.gitTracked.totalFiles;
        gitTrackedExtCounts = result.gitTracked.extCounts;
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      return {
        dimension: "structure",
        signal: "low",
        findings: {
          tree: `_(enumeration unavailable: ${msg})_`,
          fileCounts: {},
          totalFiles: 0,
          topDirs: [],
          depth: 0,
        },
      };
    }
  }

  const children = buildChildren(files);
  const rootName =
    String(repoPath).replace(/\/+$/, "").split("/").filter(Boolean).pop() || "repository";
  const tree = renderTree(children, rootName);
  const depth = computeDepth(files);
  const topDirs = topDirectories(children);
  const signal = totalFiles > 100 ? "high" : totalFiles > 20 ? "medium" : "low";

  const findings = {
    tree,
    fileCounts: extCounts,
    totalFiles,
    topDirs,
    depth,
  };
  if (gitTrackedTotalFiles != null) {
    findings.gitTrackedTotalFiles = gitTrackedTotalFiles;
    findings.gitTrackedFileCounts = gitTrackedExtCounts || {};
  }

  return {
    dimension: "structure",
    signal,
    findings,
  };
}
