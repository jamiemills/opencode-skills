export function planWork(items) {
  const bus = { emit: (_name) => {} };
  bus.emit("work.planned");
  return items;
}

// Deliberate re-declaration of the `scan` term in a second directory so the
// fixture yields one genuinely ambiguous term (F6-03: ambiguity-dependent test
// bodies must execute, not silently pass behind born-false guards).
export function scan(plan) {
  return plan ? [plan] : [];
}
