"use strict";

import { dirname, join, normalize } from "node:path";
import { buildClaim, buildEvidence, makeEvidenceId } from "./contracts.mjs";

function parentDir(path) {
  return path.includes("/") ? path.split("/").slice(0, -1).join("/") : ".";
}

function topDirs(files) {
  const counts = new Map();
  for (const file of files) {
    if (!/\.(mjs|js|ts|py|go)$/.test(file)) continue;
    const dir = file.includes("/") ? file.split("/").slice(0, -1).join("/") : ".";
    if (dir === "." || dir.startsWith(".github")) continue;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.keys()].toSorted();
}

function representativeFile(files, dir) {
  return files.find((f) => f.startsWith(`${dir}/`) && /\.(mjs|js|ts|py|go)$/.test(f)) ?? null;
}

export function synthesize(extraction) {
  const { files, inventory, git } = extraction;
  const out = {
    capabilities: [],
    terms: [],
    ambiguities: [],
    workflows: [],
    contextHypotheses: [],
    seams: [],
    slices: [],
    ordering: [],
    claims: [],
    evidence: [],
    nodes: [],
    edges: [],
  };
  let seq = 0;
  const id = (slug) => `${slug}-${String((seq += 1)).padStart(4, "0")}`;
  const addClaim = (slug, spec, evidenceSpecs = []) => {
    const claimId = id(`cl-${slug}`);
    const evidenceIds = [];
    for (const evSpec of evidenceSpecs) {
      const record = buildEvidence({ claimId, ...evSpec });
      out.evidence.push(record);
      evidenceIds.push(record.id);
    }
    const claim = buildClaim({ id: claimId, ...spec, evidenceIds });
    out.claims.push(claim);
    return claim;
  };
  const dirs = topDirs(files);
  const importsByDir = new Map();
  for (const consumer of inventory.consumers) {
    const fromDir = parentDir(consumer.path);
    if (fromDir === ".") continue;
    const raw = consumer.key;
    let targetFile = null;
    if (raw.startsWith(".")) {
      const resolved = normalize(join(dirname(consumer.path), raw));
      targetFile =
        files.find(
          (f) =>
            f === resolved ||
            f === `${resolved}.mjs` ||
            f === `${resolved}.js` ||
            f === `${resolved}.ts`,
        ) ?? null;
    } else {
      const stem = raw.split("/").pop();
      targetFile = files.find((f) => fileStem(f) === stem) ?? null;
    }
    if (!targetFile) continue;
    const targetDir = parentDir(targetFile);
    if (!targetDir || targetDir === "." || targetDir === fromDir) continue;
    const key = `${fromDir}->${targetDir}`;
    importsByDir.set(key, (importsByDir.get(key) ?? 0) + 1);
  }

  for (const dir of dirs) {
    const repFile = representativeFile(files, dir);
    const inbound = [...importsByDir.entries()]
      .filter(([k]) => k.endsWith(`->${dir}`))
      .reduce((sum, [, n]) => sum + n, 0);
    const outbound = [...importsByDir.entries()]
      .filter(([k]) => k.startsWith(`${dir}->`))
      .reduce((sum, [, n]) => sum + n, 0);
    const classification =
      outbound > 0 && inbound === 0 ? "supporting" : inbound > 0 ? "core" : "isolated";
    const capClaim = addClaim(
      "capability",
      {
        claimKind: "capability",
        status: "observed",
        subject: dir,
        basis: "static_analysis",
        confidence: "medium",
        note: `classification ${classification}: inbound=${inbound} outbound=${outbound} cross-directory imports`,
      },
      repFile
        ? [
            {
              sourceKind: "walk",
              path: repFile,
              locator: `capability-dir:${dir}`,
              matchedKey: `${classification}`,
            },
          ]
        : [],
    );
    const hypothesis = addClaim(
      "context-hypothesis",
      {
        claimKind: "context_hypothesis",
        status: "inferred",
        subject: dir,
        basis: "static_analysis",
        confidence: "low",
        note: `directory cohesion suggests a bounded-context CANDIDATE; requires domain and ownership validation`,
      },
      repFile
        ? [
            {
              sourceKind: "walk",
              path: repFile,
              locator: `cohesion:${dir}`,
              matchedKey: "directory-cluster",
            },
          ]
        : [],
    );
    out.capabilities.push({
      dir,
      classification,
      inbound,
      outbound,
      claimId: capClaim.id,
      hypothesisId: hypothesis.id,
    });
    out.nodes.push({ id: `node-${dir.replaceAll("/", "-")}`, kind: "capability", label: dir });
    out.contextHypotheses.push(hypothesis);
  }

  for (const [key, count] of importsByDir.entries()) {
    const [from, to] = key.split("->");
    const relation = count >= 3 ? "conformist" : "upstream-downstream";
    const edgeClaim = addClaim(
      "relationship",
      {
        claimKind: "relationship",
        status: "inferred",
        subject: `${from} -> ${to}`,
        basis: "static_analysis",
        confidence: "medium",
        note: `${count} cross-directory import(s) suggest a ${relation} relationship`,
      },
      [
        {
          sourceKind: "import",
          path: files.find((f) => f.startsWith(`${from}/`)) ?? from,
          locator: `imports:${key}`,
          matchedKey: String(count),
        },
      ],
    );
    out.edges.push({
      source: `node-${from.replaceAll("/", "-")}`,
      target: `node-${to.replaceAll("/", "-")}`,
      relation,
    });
    out.workflows.push(edgeClaim);
  }

  const termLocations = new Map();
  for (const decl of inventory.declarations) {
    const list = termLocations.get(decl.name) ?? [];
    list.push(decl.path);
    termLocations.set(decl.name, list);
  }
  for (const [term, locations] of termLocations.entries()) {
    const uniqueDirs = [...new Set(locations.map((l) => l.split("/").slice(0, -1).join("/")))];
    if (uniqueDirs.length > 1) {
      const ambiguity = addClaim(
        "term-conflict",
        {
          claimKind: "term",
          status: "unverified",
          subject: term,
          basis: "static_analysis",
          confidence: "low",
          note: `same name declared in ${uniqueDirs.length} directories (${uniqueDirs.join(", ")}); recorded as explicit AMBIGUITY — may be one concept or competing meanings`,
        },
        [
          {
            sourceKind: "declaration",
            path: locations[0],
            locator: `term:${term}`,
            matchedKey: String(locations.length),
          },
        ],
      );
      out.ambiguities.push(ambiguity);
      out.terms.push({ term, locations, ambiguous: true });
    } else {
      out.terms.push({ term, locations, ambiguous: false });
    }
  }

  for (const decl of inventory.declarations) {
    const consumers = inventory.consumers.filter(
      (c) =>
        c.key.endsWith(decl.name) ||
        c.key
          .split("/")
          .pop()
          ?.replace(/\.\w*$/, "") === fileStem(decl.path),
    );
    if (consumers.length === 0) continue;
    const seam = {
      id: id("seam"),
      subject: `${fileStem(decl.path)}.${decl.name}`,
      path: decl.path,
      consumerCount: consumers.length,
      enablingPoint: `exported symbol ${decl.name} in ${decl.path}`,
      observableBehavior: `consumers import it from ${consumers.length} site(s)`,
      sideEffects: inventory.events.some((e) => e.path === decl.path)
        ? "event emission observed in same module"
        : "none observed statically",
      redirectableSlice: `redirect the ${consumers.length} importer(s) of ${decl.name} to an alternative implementation`,
      rollbackOption: `restore original import paths (single-module revert; no data or schema change involved)`,
      claimId: null,
    };
    const seamClaim = addClaim(
      "seam",
      {
        claimKind: "seam",
        status: "inferred",
        subject: seam.subject,
        basis: "static_analysis",
        confidence: "medium",
        note: `enabling point with ${consumers.length} observable consumer(s)`,
      },
      [
        {
          sourceKind: "declaration",
          path: decl.path,
          locator: `export:${decl.name}`,
          matchedKey: `consumers:${consumers.length}`,
        },
      ],
    );
    seam.claimId = seamClaim.id;
    out.seams.push(seam);
  }

  const orderedSeams = [...out.seams].toSorted((a, b) => b.consumerCount - a.consumerCount);
  orderedSeams.forEach((seam, index) => {
    const sliceClaim = addClaim(
      "slice-ordering",
      {
        claimKind: "ordering",
        status: "inferred",
        subject: seam.subject,
        basis: "static_analysis",
        confidence: "low",
        note: `rank ${index + 1}; UNCERTAINTY: consumer-count ranking ignores runtime traffic and team ownership — validate before any refactor`,
      },
      [
        {
          sourceKind: "declaration",
          path: seam.path,
          locator: `order:${index + 1}`,
          matchedKey: seam.subject,
        },
      ],
    );
    out.slices.push(sliceClaim);
    out.ordering.push({ rank: index + 1, subject: seam.subject, claimId: sliceClaim.id });
  });

  if (git?.available) {
    const coupling = addClaim(
      "git-coupling",
      {
        claimKind: "workflow",
        status: "inferred",
        subject: "git-co-change",
        basis: "git_history",
        confidence: "medium",
        note: `${git.coChangePairs.length} co-change pair(s); strongest: ${
          git.coChangePairs
            .slice(0, 3)
            .map((p) => `${p.a}<->${p.b}(x${p.count})`)
            .join(", ") || "none"
        }`,
      },
      [
        {
          sourceKind: "git-log",
          path: git.coChangePairs[0]?.a ?? ".",
          locator: "git:co-change",
          matchedKey: String(git.commitCount),
        },
      ],
    );
    out.workflows.push(coupling);
  }

  return out;
}

function fileStem(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

export { makeEvidenceId };
