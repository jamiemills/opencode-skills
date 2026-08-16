// Adversarial fixture (T010 gap FIX 2): a binaries-only repository — a few
// bytes of .png/.woff and no text files at all. The pipeline must complete
// without crashing and report honest facts: no detected languages, an Unknown
// stack, zero secret matches, and a maintainability measurement universe that
// discloses the unsupported-language exclusions instead of inventing metrics.
//
// Not pinned by test-integrity.json (only the five ecosystem fixture modules
// are digest-locked there); registered in inventory.json `fixtureModules`.

export const files = {
  // PNG signature + IHDR length bytes only — enough to be unmistakably binary.
  'assets/logo.png': Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]),
  // WOFF signature + flavor bytes.
  'assets/font.woff': Buffer.from([
    0x77, 0x4f, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x10, 0x00,
  ]),
};
