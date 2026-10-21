//! A module tree: `b` owns the `child` submodule.

pub mod child;

pub fn value() -> u32 {
    child::deep()
}