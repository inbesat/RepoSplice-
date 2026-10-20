# Pair rs-ripgrep-fd (rust)

**Merge intent.** Two fast command-line search tools with similar goals.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | `14.1.0` | `744a802f6be16bde8ce05b237a32a518e1e4c31b` | MIT |
| B | [sharkdp/fd](https://github.com/sharkdp/fd) | `v9.0.0` | `d9c4e6239fc1807bce1bb6aca4426f3880230a84` | MIT |

**Extract paths.** A: `./` - B: `./` (the whole repository).

**Expected outcome.** `clean` - Disjoint file sets: the merge applies cleanly and the result still builds.

**Expected conflicts.** Disjoint file sets: the merge applies cleanly and the result still builds.

**Success criteria.**

- Both pinned commits are cloned and the extract paths exist.
- The merge runs on the pinned SHAs and lands in the `clean` category.
- No license block: both sides are permissive (MIT, MIT).

**Provenance.** The SHAs are the real immutable tag commits of the tags above, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file
(source: `raw-file` / `raw-file`).