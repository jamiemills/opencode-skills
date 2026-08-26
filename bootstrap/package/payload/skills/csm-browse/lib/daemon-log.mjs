// Line-buffered transform for daemon.log (T004 sub-item 2). Console writes
// arrive as multi-line chunks and can also split a single line mid-way across
// separate write calls. A transform that stamps per write-CALL therefore
// produces multi-line records under one timestamp and splits a broken line
// across several timestamps. This module accumulates chunk bytes, stamps each
// COMPLETE line exactly once (ISO timestamp prefix), and holds any trailing
// partial line until the next write merges into it or an explicit flush/close
// releases it — so no bytes are lost or duplicated.
//
// Single shared instance for both stdout and stderr is safe: `append` is
// synchronous and consumes each write's whole chunk atomically, so interleaved
// writes only ever join pending bytes at line boundaries.
export function createLineWriter({ write, transform = (text) => text }) {
  let pending = Buffer.alloc(0);
  let closed = false;

  const append = (chunk) => {
    if (closed) return;
    const data = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    let nl;
    while ((nl = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, nl + 1).toString("utf-8");
      pending = pending.subarray(nl + 1);
      write(transform(line));
    }
  };

  // Release any trailing partial line as a single transformed record (returned
  // so the caller decides how to persist it — async append mid-run, sync write
  // on process exit, or a test assertion). Idempotent: null when empty.
  const flush = () => {
    if (!pending.length) return null;
    const tail = transform(pending.toString("utf-8"));
    pending = Buffer.alloc(0);
    return tail;
  };

  const close = () => {
    if (closed) return null;
    closed = true;
    return flush();
  };

  return { append, flush, close };
}
