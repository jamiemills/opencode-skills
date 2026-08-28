"use strict";

export class RolloutError extends Error {
  constructor(code, message, info = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.info = info;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export function cloneData(value) {
  return value === undefined ? undefined : structuredClone(value);
}
