"use strict";

import {
  assertAnswerDoesNotOverwriteStatic,
  buildAnswer,
  buildClaim,
  buildEvidence,
  buildQuestion,
  ContractError,
} from "./contracts.mjs";
import { PRIVACY_LIMITS, serializePrivacy } from "./redact.mjs";

const MAX_QUESTIONS = 200;
const MAX_ANSWERS = 100;
const MAX_ANSWER_BYTES = 4096;
const MAX_ANSWER_TOTAL_BYTES = 64 * 1024;
export const MAX_QUESTION_FILE_BYTES = 256 * 1024;
export const MAX_QUESTION_FILE_DEPTH = 8;

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Scan the raw file before JSON.parse so hostile nesting and size cannot reach the parser.
export function preflightQuestionFileText(text) {
  if (typeof text !== "string") throw new ContractError("question file must be UTF-8 text");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_QUESTION_FILE_BYTES)
    throw new ContractError(`question file exceeds ${MAX_QUESTION_FILE_BYTES} bytes`);

  let depth = 0;
  let objects = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_QUESTION_FILE_DEPTH)
        throw new ContractError(`question file nesting exceeds ${MAX_QUESTION_FILE_DEPTH}`);
      if (character === "{") {
        objects += 1;
        if (objects > MAX_ANSWERS + 1)
          throw new ContractError("question file object count exceeds limit");
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new ContractError("question file has invalid nesting");
    }
  }
  if (inString || depth !== 0) throw new ContractError("question file has invalid nesting");
  return text;
}

function requiredText(value, label, maxBytes = MAX_ANSWER_BYTES) {
  if (typeof value !== "string" || value.length === 0)
    throw new ContractError(`${label} must be a non-empty string`);
  if (Buffer.byteLength(value, "utf8") > maxBytes)
    throw new ContractError(`${label} exceeds ${maxBytes} bytes`);
  return value;
}

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
  if (questions.length > MAX_QUESTIONS)
    throw new ContractError("clarification question count exceeds limit");
  return serializePrivacy(questions, { maxCollectionItems: MAX_QUESTIONS });
}

export function applyQuestionFile(questions, fileData, existingClaims, evidencePathHint) {
  if (!isRecord(fileData)) throw new ContractError("question file must be an object");
  const fileKeys = Object.keys(fileData);
  if (fileKeys.length !== 1 || fileKeys[0] !== "answers")
    throw new ContractError("question file may only contain the answers property");
  if (!Array.isArray(fileData.answers))
    throw new ContractError("question file must carry an answers array");
  if (fileData.answers.length > MAX_ANSWERS)
    throw new ContractError(`answer count exceeds ${MAX_ANSWERS}`);
  const knownIds = new Set(questions.map((q) => q.id));
  const applied = [];
  const rejected = [];
  let answerBytes = 0;
  for (const entry of fileData.answers) {
    if (!isRecord(entry)) throw new ContractError("answer entries must be objects");
    const entryKeys = Object.keys(entry);
    if (
      entryKeys.some((key) => !["questionId", "subject", "value"].includes(key)) ||
      !entryKeys.includes("questionId") ||
      !entryKeys.includes("value")
    )
      throw new ContractError("answer entries contain unsupported properties");
    const questionId = requiredText(entry.questionId, "answer.questionId", 256);
    const subject = requiredText(entry.subject ?? questionId, "answer.subject");
    const value = requiredText(entry.value, "answer.value");
    answerBytes +=
      Buffer.byteLength(questionId, "utf8") +
      Buffer.byteLength(subject, "utf8") +
      Buffer.byteLength(value, "utf8");
    if (answerBytes > MAX_ANSWER_TOTAL_BYTES)
      throw new ContractError(`answers exceed ${MAX_ANSWER_TOTAL_BYTES} bytes`);
    const answer = buildAnswer({
      questionId,
      subject,
      value,
    });
    if (!knownIds.has(answer.questionId)) {
      rejected.push({ questionId: answer.questionId, reason: "unknown question ID" });
      continue;
    }
    try {
      assertAnswerDoesNotOverwriteStatic(existingClaims, answer);
      applied.push(serializePrivacy({ ...answer, status: "accepted" }, PRIVACY_LIMITS));
    } catch (error) {
      applied.push({
        ...serializePrivacy(answer, PRIVACY_LIMITS),
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
  return serializePrivacy({ applied, rejected, claims, evidence });
}

export function nonInteractiveGaps(questions, answers) {
  const answered = new Set(
    (answers ?? []).filter((a) => a && typeof a.questionId === "string").map((a) => a.questionId),
  );
  return serializePrivacy(
    questions
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
      ),
    { maxCollectionItems: MAX_QUESTIONS },
  );
}
