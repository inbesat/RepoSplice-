# Expected outcome - js-react-preact

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** A large UI runtime and its lightweight alternative: same problem, different trade-offs.

**Success criteria.**

- The merge completes on the pinned commits `f1338f8080abd1386454a10bbf93d67bfe37ce85` (A) and `494f08460fbfa5bd653552912c923c7eab7b1c5e` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.