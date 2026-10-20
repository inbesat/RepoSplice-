# Expected outcome - py-requests-versions

- **Category:** `conflicts`
- **What it means:** The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.
- **Merge intent:** The same client at two releases: overlapping files, so the merge is expected to conflict.

**Success criteria.**

- The merge completes on the pinned commits `61e2240f283f15780ac2d0e2cfefb0fd6fdab627` (A) and `0106aced5faa299e6ede89d1230bd6784f2c3660` (B).
- The result is classified as `conflicts` by the harness.
- The permissive-license policy passes for both sides.