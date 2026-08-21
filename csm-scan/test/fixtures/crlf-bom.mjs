// Adversarial fixture (T010 gap FIX 2): source files with CRLF line endings
// and a UTF-8 BOM — the classic Windows-editor encoding. The pipeline must
// complete without crashing and stay honest: language/ecosystem detection,
// test-file counting, and import-style detection still report what is there,
// and rendered NORMS output keeps LF-only line endings.
//
// Not pinned by test-integrity.json (only the five ecosystem fixture modules
// are digest-locked there); registered in inventory.json `fixtureModules`.

export const files = {
  "package.json": JSON.stringify({ name: "adv-crlf", type: "module" }),
  "src/app.js": "\uFEFFexport function main() {\r\n  return 'adv-crlf';\r\n}\r\n",
  "test/app.test.js": "\uFEFFimport { main } from '../src/app.js';\r\nconsole.log(main());\r\n",
};
