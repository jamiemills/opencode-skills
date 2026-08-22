// Shared privacy fixtures (F-018): single source of truth for the canary
// values and the SARIF/SBOM sink documents used by the T227 gate and the
// T228 acceptance matrix. Importing one symbol makes cross-suite drift
// structurally impossible.
export const CANARIES = Object.freeze([
  "Alice Smith", // personal name
  "alice.smith@example.test", // email
  "/etc/privacy/path.conf", // POSIX absolute path
  "C:\\Users\\priv\\secret.conf", // Windows absolute path
  "\\\\server\\share\\secret.conf", // UNC path
  "privacy-super-secret-token-77", // secret token value
  "PrivacyPassw0rd-99", // credential value
  "ghp_\x70rivacy_fixture_token_88", // GitHub PAT shape
  "@alice-dev", // CODEOWNERS identity
  "privacy-canary-commit-subject", // raw commit subject
  "privacy-sarif-message", // SARIF message text
  "privacy-snippet", // SARIF snippet text
  "urn:uuid:privacy-serial-1111", // SBOM serial
  "privacy-sbom-hash-2222", // SBOM content hash
  "privacy-sbom-contact", // SBOM contact identity
  "https://downloads.example.test/privacy-lib-1.0.0.tgz", // SBOM download URL
  "https://github.com/acme/privacy-lib.git", // SBOM VCS URL
  "https://user:pass@db.example.test/primary", // URL with embedded credentials
  "alice:secret@github.com", // raw git remote with credentials
]);
export const SARIF = Object.freeze({
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "privacy-scan",
          rules: [{ id: "R1", shortDescription: { text: "privacy-sarif-message" } }],
        },
      },
      results: [
        {
          ruleId: "R1",
          message: { text: "privacy-sarif-message leak" },
          codeFlows: [
            {
              threadFlows: [
                {
                  locations: [
                    {
                      location: {
                        physicalLocation: {
                          artifactLocation: { uri: "src/a.js" },
                          region: { snippet: { text: "privacy-snippet" } },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
export const SBOM = Object.freeze({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:privacy-serial-1111",
  components: [
    {
      type: "library",
      name: "privacy-lib",
      version: "1.0.0",
      purl: "pkg:npm/privacy-lib@1.0.0",
      hashes: [{ alg: "SHA-256", content: "privacy-sbom-hash-2222" }],
      licenses: [{ license: { id: "MIT" } }],
      externalReferences: [
        { type: "distribution", url: "https://downloads.example.test/privacy-lib-1.0.0.tgz" },
        { type: "vcs", url: "https://github.com/acme/privacy-lib.git" },
      ],
      supplier: {
        name: "privacy-sbom-contact",
        contact: [{ name: "Alice Smith", email: "alice.smith@example.test" }],
      },
    },
  ],
});
