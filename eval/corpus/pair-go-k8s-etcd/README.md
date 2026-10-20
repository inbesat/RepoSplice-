# Pair go-k8s-etcd (go)

**Merge intent.** A Kubernetes client and the cluster store it talks to.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [kubernetes/client-go](https://github.com/kubernetes/client-go) | `v0.29.3` | `5de78fff897ddd55622a1958e2d210e9891cc3db` | Apache-2.0 |
| B | [etcd-io/etcd](https://github.com/etcd-io/etcd) | `v3.5.13` | `960c88adb97dda5588180e6dd429bbd20243a9ea` | Apache-2.0 |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (Apache-2.0, Apache-2.0).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).