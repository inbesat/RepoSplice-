# Expected outcome - js-express-fastify

- **Category:** `semantic_drift`
- **What it means:** The merge applies, but the two codebases solve the same problem differently, so the result must be reviewed for behaviour changes.
- **Merge intent:** Two Node HTTP frameworks with the same surface area but different internals: a merge that compiles yet changes behaviour.

**Success criteria.**

- The merge completes on the pinned commits `f1573b8ab10391f25475667a7c3ef70beeaf4db8` (A) and `5c263b4dc2cb6d5eda2df7b3602238ae24957c55` (B).
- The result is classified as `semantic_drift` by the harness.
- The permissive-license policy passes for both sides.