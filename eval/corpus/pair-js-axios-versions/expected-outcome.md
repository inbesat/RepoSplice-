# Expected outcome - js-axios-versions

- **Category:** `conflicts`
- **What it means:** The same paths exist on both sides, so the merge is expected to conflict; resolving them is the task.
- **Merge intent:** The same client at two releases: overlapping files, so the merge is expected to conflict.

**Success criteria.**

- The merge completes on the pinned commits `ea27b7b4b030dc91f8fddb08edcce207736855f0` (A) and `752b52e32453d9dc2d4449528d68d2ddf5337641` (B).
- The result is classified as `conflicts` by the harness.
- The permissive-license policy passes for both sides.