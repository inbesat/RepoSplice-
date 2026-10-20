# Expected outcome - js-axios-ky

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** A popular HTTP client and a smaller modern one: disjoint files, a clean overlay merge.

**Success criteria.**

- The merge completes on the pinned commits `ea27b7b4b030dc91f8fddb08edcce207736855f0` (A) and `9d624b29e3306149ea468ce878de2cd1e9fb9a19` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.