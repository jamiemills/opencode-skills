export const manifest = 'Cargo.toml';

export const files = {
  'Cargo.toml': `[package]
name = "demo"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[workspace]
members = ["crates/alpha", "crates/beta"]
resolver = "2"

[dependencies]
serde = { version = "1", features = ["derive"] }

[[bin]]
name = "demo"
path = "src/main.rs"
`,
  'src/main.rs': `mod a;
mod lib;

use crate::lib::f;

fn main() {
    println!("{}", f());
}
`,
  'src/a.rs': `pub mod b;
pub mod sibling;
`,
  'src/a/b.rs': `mod foo;
mod local;

use self::local::local_value;
use super::sibling::sibling_value;
use serde::Serialize;

pub fn combined() -> u32 {
    local_value() + sibling_value() + foo::foo_value()
}
`,
  'src/a/b/foo.rs': `pub fn foo_value() -> u32 { 1 }
`,
  'src/a/b/local.rs': `pub fn local_value() -> u32 { 2 }
`,
  'src/a/sibling.rs': `pub fn sibling_value() -> u32 { 3 }
`,
  'src/lib.rs': `pub fn f() -> &'static str {
    "hello"
}

pub unsafe fn raw_value(ptr: *const u8) -> u8 {
    unsafe { *ptr }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_is_stable() {
        assert_eq!(f(), "hello");
    }
}
`,
  'crates/alpha/Cargo.toml': `[package]
name = "fixture-alpha"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
`,
  'crates/alpha/src/lib.rs': `pub fn alpha() -> u8 { 1 }
`,
  'crates/beta/Cargo.toml': `[package]
name = "fixture-beta"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = "1"
`,
  'crates/beta/src/lib.rs': `pub fn beta() -> u8 { 2 }
`,
  'tests/integration.rs': `#[test]
fn integration_smoke() {
    assert_eq!(1 + 1, 2);
}
`,
  'rustfmt.toml': `edition = "2021"
max_width = 100
`,
  'Cargo.lock': `version = 3
`,
  'target/debug/x': `noise
`,
};
