# Expected outcome - rs-tokio-hyper

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** The async runtime and the HTTP stack built on it.

**Success criteria.**

- The merge completes on the pinned commits `14c17fc09656a30230177b600bacceb9db33e942` (A) and `4fda6b3ef7da763623797af40aa51d764be3fd2c` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.