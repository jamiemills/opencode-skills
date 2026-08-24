"use strict";

import {
  assertAnswerDoesNotOverwriteStatic,
  buildAnswer,
  buildClaim,
  buildEvidence,
  buildQuestion,
  ContractError,
} from "./contracts.mjs";

function nextId(seq, prefix) {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export function deriveQuestions(synthesis) {
  const questions = [];
  let n = 0;
  const ambiguousDirs = new Set();
  const termQuestionIds = [];
  for (const term of synthesis.terms.filter((t) => t.ambiguous)) {
    const dirs = [...new Set(term.locations.map((l) => l.split("/").slice(0, -1).join("/")))];
    dirs.forEach((d) => ambiguousDirs.add(d));
    const question = buildQuestion({
      id: nextId((n += 1), "q-term"),
      subject: term.term,
      text: `The name "${term.term}" appears in ${dirs.join(" and ")} with potentially different meanings. Which meaning is authoritative, or are these genuinely different concepts?`,
      dependsOn: [],
    });
    questions.push(question);
    termQuestionIds.push(question.id);
  }
  for (const cap of synthesis.capabilities) {
    if (!ambiguousDirs.has(cap.dir)) continue;
    questions.push(
      buildQuestion({
        id: nextId((n += 1), "q-boundary"),
        subject: cap.dir,
        text: `Given the terminology above, is ${cap.dir} a distinct bounded context or part of another context?`,
        dependsOn: [...termQuestionIds],
      }),
    );
  }
  for (const cap of synthesis.capabilities) {
    questions.push(
      buildQuestion({
        id: nextId((n += 1), "q-owner"),
        subject: cap.dir,
        text: `Which team owns ${cap.dir}, and is its business outcome core, supporting, or generic to the product?`,
        dependsOn: [],
      }),
    );
  }
  return questions;
}

export function applyQuestionFile(questions, fileData, existingClaims, evidencePathHint) {
  if (!fileData || !Array.isArray(fileData.answers)) {
    throw new ContractError("question file must carry an answers array");
  }
  const knownIds = new Set(questions.map((q) => q.id));
  const applied = [];
  const rejected = [];
  for (const entry of fileData.answers) {
    const answer = buildAnswer({
      questionId: entry.questionId ?? "",
      subject: entry.subject,
      value: String(entry.value ?? ""),
    });
    if (!knownIds.has(answer.questionId)) {
      rejected.push({ questionId: answer.questionId, reason: "unknown question ID" });
      continue;
    }
    try {
      assertAnswerDoesNotOverwriteStatic(existingClaims, answer);
      applied.push({ ...answer, status: "accepted" });
    } catch (error) {
      applied.push({
        ...answer,
        status: "recorded-as-alternative",
        note: error instanceof ContractError ? error.message : "conflict",
      });
    }
  }
  const claims = [];
  const evidence = [];
  let seq = 0;
  for (const record of applied) {
    seq += 1;
    const claimId = `cl-answer-${String(seq).padStart(4, "0")}`;
    claims.push(
      buildClaim({
        id: claimId,
        claimKind: "ownership",
        status: "observed",
        subject: record.subject,
        basis: "user_provided",
        confidence: "medium",
        evidenceIds: [],
        note: `user answer (${record.status})${record.note ? `: ${record.note}` : ""}`,
      }),
    );
    evidence.push(
      buildEvidence({
        claimId,
        sourceKind: "user-answer",
        path: evidencePathHint ?? ".",
        locator: `question:${record.questionId}`,
        matchedKey: record.status,
      }),
    );
  }
  return { applied, rejected, claims, evidence };
}

export function nonInteractiveGaps(questions, answers) {
  const answered = new Set((answers ?? []).map((a) => a.questionId));
  return questions
    .filter((q) => !answered.has(q.id))
    .map((q, index) =>
      buildClaim({
        id: `cl-gap-${String(index + 1).padStart(4, "0")}`,
        claimKind: "invariant",
        status: "unverified",
        subject: q.subject ?? q.text,
        basis: "static_analysis",
        confidence: "low",
        evidenceIds: [],
        note: `OPEN QUESTION (unresolved in non-interactive mode): ${q.text}`,
      }),
    );
}
