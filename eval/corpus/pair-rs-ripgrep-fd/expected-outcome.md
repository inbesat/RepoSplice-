# Expected outcome - rs-ripgrep-fd

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** Two fast command-line search tools with similar goals.

**Success criteria.**

- The merge completes on the pinned commits `744a802f6be16bde8ce05b237a32a518e1e4c31b` (A) and `d9c4e6239fc1807bce1bb6aca4426f3880230a84` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.