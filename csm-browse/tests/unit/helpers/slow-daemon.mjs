// Deliberately uncooperative daemon stub for harness-bounding tests: it never
// writes a ready marker and ignores SIGTERM/SIGINT, so only the harness's
// SIGKILL+reap path can end it. Any leak here would hang the test runner.
setInterval(() => {}, 60000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
