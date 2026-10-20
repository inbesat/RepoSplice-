# Expected outcome - go-cobra-cli

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** Two CLI frameworks whose command trees are shaped differently.

**Success criteria.**

- The merge completes on the pinned commits `e94f6d0dd9a5e5738dca6bce03c4b1207ffbc0ec` (A) and `236271c2829401155cb2044ad31ec15b91a3d226` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.