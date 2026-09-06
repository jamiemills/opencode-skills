"use strict";

// Section-aware .agents artifact index (parallelism T009, S5-index). The
// artifact-index gate and the section-anchored index writers share one source
// of truth for the directory-class -> README-section mapping and for parsing
// bullet subjects, so a new artifact class needs exactly one edit. This module
// must stay side-effect free and dependency-free: check-suite imports it for
// the gate and the *-host.mjs writers import it for insertion.
//
// .agents/README.md keeps one section per artifact class. Each tracked
// artifact gets exactly one bullet line ("- `name` — ...") under the section
// that maps to its physical directory class; inline backtick mentions in other
// sections (cross-references such as "superseded-by", prose) never satisfy the
// membership rule. New index lines are inserted at the END of the artifact's
// own class section, never the physical EOF.

// Directory class (first path segment under .agents/) -> section heading text
// (the part after "## " in .agents/README.md). csm-build-state shares the
// builds/ section with .agents/builds/.
export const AGENTS_DIR_SECTION = Object.freeze({
  plans: "plans/",
  research: "research/",
  reviews: "reviews/",
  approaches: "approaches/",
  docs: "docs/",
  ddd: "ddd/",
  evidence: "evidence/",
  progress: "progress/",
  builds: "builds/",
  "csm-build-state": "builds/",
});

const HEADING_RE = /^##\s+(\S.*?)\s*$/;
const BULLET_TOKEN_RE = /`([^`]+)`/g;

// The README section that indexes a repo-relative posix artifact path
// (".agents/<class>/<name>"), or null when the class has no section mapping.
export function agentsIndexSectionFor(relPosixPath) {
  const cls = relPosixPath.split("/")[1];
  if (cls === undefined) return null;
  return AGENTS_DIR_SECTION[cls] ?? null;
}

// Subject basename of an index bullet line: the first backtick token that
// looks like a bare artifact filename (no "/" and no leading "."). Returns
// null for non-bullet lines and for bullets whose first token is not a bare
// filename (path-qualified or dotted tokens are cross-references, not the
// indexed artifact's subject).
export function indexBulletSubject(line) {
  if (!line.startsWith("- ")) return null;
  for (const match of line.matchAll(BULLET_TOKEN_RE)) {
    const token = match[1];
    if (token.includes("/") || token.startsWith(".")) continue;
    return token;
  }
  return null;
}

// Parses .agents/README.md content into a Map<section heading, subject[]>
// preserving file order of the subject bullets. Prose lines, inline
// cross-references inside bullets, and non-bullet text are ignored: only the
// SUBJECT token of each bullet line counts for section membership.
export function agentsIndexSubjectsBySection(content) {
  const subjectsBySection = new Map();
  let section = null;
  for (const line of content.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      section = heading[1];
      if (!subjectsBySection.has(section)) subjectsBySection.set(section, []);
      continue;
    }
    if (section === null) continue;
    const subject = indexBulletSubject(line);
    if (subject !== null) subjectsBySection.get(section).push(subject);
  }
  return subjectsBySection;
}

// Returns the line index (in `lines`) at which a bullet should be inserted so
// it lands at the END of the bullet run of the section whose heading is at
// `sectionStart` (whose next heading, or EOF, is `sectionEnd`). Preserves any
// blank line that separates the section from the next heading.
function sectionBulletInsertAt(lines, sectionStart, sectionEnd) {
  let lastBullet = sectionStart;
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (indexBulletSubject(lines[i]) !== null) lastBullet = i;
  }
  return lastBullet === sectionStart ? sectionStart + 1 : lastBullet + 1;
}

// Inserts an artifact bullet line under the section that maps to
// relArtifactPath (".agents/<class>/<name>"). Idempotent: when the artifact's
// basename already has a subject bullet under its mapped section the content is
// returned unchanged. Throws when the artifact class has no section mapping or
// the mapped section heading is absent, so a writer never silently appends a
// mis-homed line to the physical EOF.
export function insertAgentsIndexBullet(content, relArtifactPath, bulletLine) {
  const want = agentsIndexSectionFor(relArtifactPath);
  if (want === null)
    throw new Error(`agents-index: no mapped README section for ${relArtifactPath}`);
  const subject = indexBulletSubject(bulletLine);
  if (subject === null) throw new Error(`agents-index: not an artifact bullet line: ${bulletLine}`);
  const lines = content === "" ? [] : content.split("\n");
  const heading = `## ${want}`;
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === heading) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1)
    throw new Error(`agents-index: no "${heading}" section in .agents/README.md`);
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (HEADING_RE.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (indexBulletSubject(lines[i]) === subject) return content;
  }
  const insertAt = sectionBulletInsertAt(lines, sectionStart, sectionEnd);
  lines.splice(insertAt, 0, bulletLine);
  return lines.join("\n");
}
