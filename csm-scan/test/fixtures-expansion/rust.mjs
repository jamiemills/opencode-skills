// T226 topic fixture — Rust (API, data, deployment, governance, architecture).
//
// Carries the "API + data + deployment + governance + architecture + privacy"
// theme:
//   - Axum literal routes plus a clap CLI tree and pub exports (positive API).
//   - A Diesel `table!` schema plus a SQL migration (positive data entities,
//     fields, keys, migration).
//   - A Dockerfile (positive deployment image).
//   - An ADR (positive governance decision).
//   - Cargo.toml + Cargo.lock (positive assurance manifest and lock).
//   - `mod routes` + `use crate::routes` gives the architecture import graph a
//     real internal edge.
//   - Privacy canaries: an email and a secret token that must never reach
//     findings or NORMS.md.

export const files = {
  'Cargo.toml': `[package]
name = "t226-rs"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
serde = { version = "1", features = ["derive"] }
clap = { version = "4", features = ["derive"] }

[[bin]]
name = "t226-rs"
path = "src/main.rs"
`,
  'Cargo.lock': 'version = 3\n',
  'src/main.rs': [
    'mod routes;',
    '',
    'use crate::routes::{list, health};',
    '',
    'fn main() {',
    '    let app = Router::new()',
    '        .route("/api/users", get(list))',
    '        .route("/api/health", get(health));',
    '    println!("{}", app);',
    '}',
    '',
  ].join('\n'),
  'src/routes.rs': [
    '#[derive(Parser)]',
    '#[command(name = "t226")]',
    'struct Cli {',
    '  #[command(subcommand)]',
    '  command: Commands,',
    '}',
    '',
    '#[derive(Subcommand)]',
    'enum Commands {',
    '  Build,',
    '}',
    '',
    'pub fn list() {}',
    'pub fn health() {}',
    '',
  ].join('\n'),
  'src/schema.rs': [
    'table! {',
    '  users (id) {',
    '    id -> Integer,',
    '    name -> Text,',
    '  }',
    '}',
    '',
  ].join('\n'),
  'migrations/0001_init/up.sql': [
    'CREATE TABLE teams (',
    '  id INTEGER PRIMARY KEY,',
    '  name TEXT NOT NULL,',
    ');',
    '',
  ].join('\n'),
  'Dockerfile': 'FROM rust:1.75\nWORKDIR /app\nCOPY . .\nCMD ["cargo", "run"]\n',
  'docs/adr/0001-rust.md': [
    '# ADR 0001',
    '',
    '## Status',
    '',
    'Proposed',
    '',
  ].join('\n'),
  'README.md': 'email reviewer@example.test on issues\n',
  'src/secret.rs': 'pub const TOKEN: &str = "rs-fixture-super-secret";\n',
};
