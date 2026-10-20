# Expected outcome - rs-axum-actix

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** Two Rust web frameworks with different middleware models.

**Success criteria.**

- The merge completes on the pinned commits `ef8a9e812c1b49b61d21813cb30f5982d8da56df` (A) and `e0918fb1795c899ac38fb903694ca1aa3b58d46d` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.