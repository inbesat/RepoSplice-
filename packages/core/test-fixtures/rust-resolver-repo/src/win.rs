#![cfg(feature = "never")]

//! Gated behind a feature this build never enables.

pub fn win_only() -> u32 {
    3
}