# Expected outcome - py-requests-httpx

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** A classic requests session and its async successor: disjoint files, a clean overlay merge.

**Success criteria.**

- The merge completes on the pinned commits `61e2240f283f15780ac2d0e2cfefb0fd6fdab627` (A) and `326b9431c761e1ef1e00b9f760d1f654c8db48c6` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.