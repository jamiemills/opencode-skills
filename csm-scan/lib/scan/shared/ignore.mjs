const IGNORE_DIRS = [
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".import_linter_cache",
  ".hypothesis",
  ".tox",
  ".nox",
  ".eggs",
  "htmlcov",
  "dist",
  "build",
  ".next",
  "target",
  "coverage",
  ".cache",
  ".nyc_output",
  ".dart_tool",
  ".gradle",
];

const IGNORE_NAME_GLOBS = ["*.pyc", "*.pyo", "*.egg-info", "*.class", "*.lockb"];

const IGNORE_DIR_SET = new Set(IGNORE_DIRS);

function globToRegex(glob) {
  let s = "";
  for (const ch of glob) {
    if (ch === "*") s += ".*";
    else if (/[.+^${}()|[\]\\?]/.test(ch)) s += "\\" + ch;
    else s += ch;
  }
  return new RegExp(`^${s}$`);
}

const NAME_GLOB_REGEXES = IGNORE_NAME_GLOBS.map(globToRegex);

export function rgIgnoreArgs() {
  const args = [];
  for (const d of IGNORE_DIRS) args.push(`--glob !${d}`);
  for (const g of IGNORE_NAME_GLOBS) args.push(`--glob !${g}`);
  return args;
}

export function isIgnoredPath(relPath) {
  if (!relPath) return false;
  const posix = String(relPath).replace(/\\/g, "/");
  const segs = posix.split("/").filter((s) => s.length > 0);
  for (const seg of segs) {
    if (IGNORE_DIR_SET.has(seg)) return true;
  }
  const base = segs.length ? segs[segs.length - 1] : "";
  if (base) {
    for (const re of NAME_GLOB_REGEXES) {
      if (re.test(base)) return true;
    }
  }
  return false;
}

export { IGNORE_DIRS, IGNORE_NAME_GLOBS };
