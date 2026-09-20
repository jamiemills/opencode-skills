"use strict";
// Tiny, dependency-free UTC helpers shared by durable trace/journal writers.
// utcNow() is the single source of "now" for trace records; isUtc() is the
// fail-closed guard used to reject a caller-supplied non-UTC timestamp.

export function utcNow() {
  return new Date().toISOString();
}

// ISO-8601 datetime shape, UTC only: YYYY-MM-DDTHH:MM:SS(.sss)Z. A bare
// suffix check let non-datetime junk through, so require the full shape AND a
// parseable date.
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function isUtc(ts) {
  return typeof ts === "string" && ISO_UTC_RE.test(ts) && !Number.isNaN(Date.parse(ts));
}
