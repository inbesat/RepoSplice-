# Expected outcome - rs-rust-cargo

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** The language and its package manager.

**Success criteria.**

- The merge completes on the pinned commits `a6af86c649426f1d6a0ec4b188f1f5ff097c5bb0` (A) and `b74813d84bb7488fbd4ed8f5d00012a6e30eaa39` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.