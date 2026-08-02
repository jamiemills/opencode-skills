---
name: csm-scan
description: comprehensively analyze repositories to identify architecture patterns, code conventions, tooling, and operational norms — output a single NORMS.md with ASCII art and Mermaid C4 diagrams
---

# csm-scan

Read-only multi-repo analysis tool. Scans one or more repositories to extract structure, technology stack, configuration, testing patterns, code conventions, git history, and architecture — producing a single `NORMS.md` output file.

## When to use
- Onboarding to a new codebase
- Preparing a CSM plan for a repository
- Documenting architecture for handoff
- Auditing codebase conventions across multiple repos

## Usage

```bash
node scripts/scan.mjs [--repos <path1> <path2>...] [--out <path>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--repos` | `[CWD]` | One or more repo paths to scan |
| `--out` | `CWD/NORMS.md` | Output file path |

## Constraints (non-negotiable)

- **Read-only**: Never modifies scanned repos — uses `rg`, `git`, `find` via `child_process` for read-only ops
- **Single output file**: Exactly one `writeFile(outPath, content)` call — no config files, lockfiles, temp files, or any other writes
- **Zero npm dependencies**: Node.js built-ins only (`node:fs`, `node:path`, `node:child_process`)
- **No installs, no builds**: Never installs dependencies or runs build commands in scanned repos

## Output

A single `NORMS.md` file containing:

1. **Repository Structure** — ASCII directory tree with file-type counts
2. **Technology Stack** — runtime, language, framework, package manager, key dependencies
3. **Configuration** — lint, format, TypeScript, build, CI config summary
4. **Testing** — test framework, file locations, naming patterns
5. **Conventions** — import style, naming rules, error handling patterns
6. **Git** — branch naming, commit conventions, templates
7. **Architecture** — ASCII module dependency diagram and Mermaid C4 diagrams (context, container, component levels)

## Typical workflow

1. Run `csm-scan` against the target repo
2. Review `NORMS.md` for architecture, conventions, and tooling
3. Feed findings into `csm-plan` for a new CSM plan
