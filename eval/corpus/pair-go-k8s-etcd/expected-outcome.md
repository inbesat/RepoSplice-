# Expected outcome - go-k8s-etcd

- **Category:** `clean`
- **What it means:** Disjoint file sets: the merge applies cleanly and the result still builds.
- **Merge intent:** A Kubernetes client and the cluster store it talks to.

**Success criteria.**

- The merge completes on the pinned commits `5de78fff897ddd55622a1958e2d210e9891cc3db` (A) and `960c88adb97dda5588180e6dd429bbd20243a9ea` (B).
- The result is classified as `clean` by the harness.
- The permissive-license policy passes for both sides.