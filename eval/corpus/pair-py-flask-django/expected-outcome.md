# Expected outcome - py-flask-django

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** A microframework and a batteries-included framework: same goal, very different structure.

**Success criteria.**

- The merge completes on the pinned commits `85039283fc3e986cced4ab39a3fe2b39314d06bb` (A) and `c990212568961233fbd11db8009f72a5cd79ff46` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.