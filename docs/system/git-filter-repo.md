# System Dependency: git-filter-repo

**Requirement:** the `git-filter-repo` binary on `PATH` (any recent
release). Unlike git itself there is **no minimum-version constant**:
upstream `--version` reports its own revision hash, not semver (verified:
2.47.0 prints `a40bce548d2c`), so there is nothing sound to compare.
Presence is the gate; `stitch doctor` (P-068) checks it via
`checkFilterRepoStatus` in `packages/core/src/git/filterRepo.ts`.

## Why filter-repo (and not filter-branch)

Stitch's path extraction / history rewrite (P-070) and the subtree/filter
provenance paths run through filter-repo. It must NOT be aliased over
`git filter-branch`: filter-branch is orders of magnitude slower on large
histories and its shell-callback model makes byte-identical reruns fragile,
which would break the determinism guarantees (P-282) snapshots (P-260)
depend on. (Upstream's own `filter-branch` manual points at filter-repo
for the same reasons.)

## Install

```console
$ pip install git-filter-repo
```

or, when no `pip` shim exists (common on Windows Python installs):

```console
$ python -m pip install git-filter-repo
```

Both forms verified (installed 2.47.0 this way).

### PATH note (read this — it bites on Windows)

The installer puts `git-filter-repo.exe` in the Python `Scripts`
directory and warns when that directory is not on `PATH`:

```console
WARNING: The script git-filter-repo.exe is installed in
'...\Python...\Scripts' which is not on PATH.
```

Until that directory is on `PATH`, **both** invocation forms fail —
including git's subcommand dispatch:

```console
$ git filter-repo --version
git: 'filter-repo' is not a git command. See 'git --help'.
```

Add the `Scripts` directory to `PATH` (reopen the terminal), then verify.

## Verify

```console
$ git-filter-repo --version
a40bce548d2c
```

Any non-empty output means the binary runs. `git filter-repo --version`
works too once the `PATH` note above is handled.

## Offline / sandbox fallback

Filter-repo must be installed everywhere stitch runs unattended, or
extraction steps fail at filter time instead of at setup. The Docker story
— sandbox images bundling it — is P-067/P-169; until those land, treat a
missing binary as a setup error, not a runtime surprise.

## See also

- `git-version.md` (same directory): the git >= 2.40.0 floor.
- `TECH_STACK.md` (plan docs): Filter-Repo row (invoked via
  `child_process`, not a Node dep).
- `SECURITY.md` (plan docs), section 5.2: filter-repo safety
  (fresh clones, never `--force`).
- `stitch doctor` (P-068): automated presence check + fix hint.
