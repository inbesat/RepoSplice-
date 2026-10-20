# Expected outcome - js-vue-svelte

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** Two component frameworks whose reactive models differ (virtual DOM vs compiler).

**Success criteria.**

- The merge completes on the pinned commits `f2acd51340b85ae88bfd16bf5e61df967e0b92ec` (A) and `23ec635435ea4c4f51a6946cc9c1f1b351855f79` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.