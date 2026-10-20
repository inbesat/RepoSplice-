# Pair rs-serde-clap (rust)

**Merge intent.** A serialization crate and a CLI argument parser.

| Side | Repository | Tag | Commit SHA | License |
| --- | --- | --- | --- | --- |
| A | [serde-rs/serde](https://github.com/serde-rs/serde) | `v1.0.203` | `8e847dbd4ff5fa9f8d1640ef5e24edaf24435106` | MIT |
| B | [clap-rs/clap](https://github.com/clap-rs/clap) | `v4.5.7` | `d46b4f07f254e67978767862d8d1a7af15fe7278` | MIT |

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