// T226 topic fixture — unknown language (generic artifact-only evidence).
//
// A Go-based repository used as the "unknown language" case. Survey detects
// `Go` (a real language that is NOT one of the five first-class built-ins) and
// no known ecosystem, so the production pipeline must route it through the
// generic artifact-only fallback:
//   - `PRV-generic-artifacts-v1` file_metric + measurement_universe
//     observations must reach the output under the Maintainability section.
//   - api/data/deployment/governance must be `not_detected` (the generic
//     fallback never claims first-class source semantics).
//   - assurance stays `observed` purely from artifact presence (go.mod/go.sum/
//     LICENSE), never from a first-class detector.
//   - No built-in ecosystem token (Python/JavaScript/TypeScript/Shell/Rust) may
//     appear as a detected ecosystem.

export const files = {
  "go.mod": "module example.com/t226\n\ngo 1.21\n",
  "go.sum": "example.com/dep v1.0.0 h1:abc=\n",
  "src/main.go": [
    "package main",
    "",
    'import "fmt"',
    "",
    "func main() {",
    '    fmt.Println("hello")',
    "}",
    "",
  ].join("\n"),
  "src/lib.go": ["package main", "", "func value() int {", "    return 1", "}", ""].join("\n"),
  "README.md": "# t226 unknown (Go)\n",
  LICENSE: "MIT License\n",
};
