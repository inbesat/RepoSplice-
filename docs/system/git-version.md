# System Dependency: git >= 2.40.0

**Requirement:** `git` version **2.40.0 or newer** must be on `PATH`.
The canonical floor lives in code, not in this doc:
`MIN_GIT_VERSION` in `packages/core/src/git/version.ts`.
`stitch doctor` (P-068) checks it automatically.

## Why this floor

Stitch's merge strategy (P-072) shells out to `git merge` with the `ort`
backend and `--allow-unrelated-histories` to join repos that share no
history. The Git Core epic (P-069–P-087) is developed and tested against
git >= 2.40, so that combination is the only one stitch supports.
Verified on git 2.45.1 (Windows):

```console
$ git init -b main a && git init -b main b
$ # ... one commit in each, no shared history ...
$ git -C a remote add b ../b && git -C a fetch b
$ git -C a merge --allow-unrelated-histories -s ort b/main -m merge
Merge made by the 'ort' strategy.
```

Older gits may merge differently (or lack flags stitch passes), which
corrupts the assumptions provenance (P-181) and snapshots (P-260) rely on.
Below-minimum gits get a doctor warning with these instructions; critical
ops return a `Result` error instead of running.

## Verify

```console
$ git --version
git version 2.45.1.windows.1
```

The reported version must be >= 2.40.0. Distro suffixes
(`.windows.1`, `-apple`) are fine — doctor parses the leading
`major.minor.patch` (`parseGitVersion`).

## Install / upgrade per OS

After installing, re-run `git --version` and confirm the floor.

- **Windows:** installer from <https://git-scm.com> or
  `winget install Git.Git`. Close and reopen the terminal afterwards.
- **macOS:** `brew install git`. (Apple's Xcode CLT git can lag behind;
  check the reported version and prefer Homebrew's if it is older.)
- **Debian / Ubuntu:** `sudo apt update && sudo apt install git`. LTS
  archives can ship older gits — if the reported version is below the
  floor, use a newer official build or backports.
- **Fedora:** `sudo dnf install git`.
- **Arch:** `sudo pacman -S git`.

## See also

- `TECH_STACK.md` (plan docs): system-dependency table, git row.
- `SECURITY.md` (plan docs), section 5: git operations safety.
- `AGENTS.md` (plan docs), pitfalls: keep the system git current.
- `stitch doctor` (P-068): automated version + presence checks.
- `git-filter-repo` doc (`docs/system/git-filter-repo.md`, P-066):
  the companion system binary.
