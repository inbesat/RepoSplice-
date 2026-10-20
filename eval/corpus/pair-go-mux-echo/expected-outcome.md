# Expected outcome - go-mux-echo

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** A small HTTP router and a full framework: disjoint files, a clean overlay merge.

**Success criteria.**

- The merge completes on the pinned commits `b4617d0b9670ad14039b2739167fd35a60f557c5` (A) and `fc410094b2f3415cf2bf5204082137b205bfd5af` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.