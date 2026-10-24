"""P-358 — the `stitch_select_files` tool tests (the mandated ids).

The CI is bun-only, so the python ids drive the real tool through the bun
harness (packages/mcp/src/tools/__fixtures__/select-files-harness.ts) and
assert on the report it prints. The harness builds real temporary git
repositories, so the local case runs the real core ports (listFiles,
languageForFile, detectEcosystems) and the remote case swaps only the
materializer, which keeps the client-side branch honest without a network.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/mcp/src/tools/__fixtures__/select-files-harness.ts"
REMOTE_URL = "https://example.invalid/select-files.git"

# Code-unit ordering: "README.md" (0x52) precedes "package.json" (0x70).
LOCAL_PATHS = ["README.md", "package.json", "src/alpha.ts", "src/beta.ts"]
PAGED_PATHS = [f"src/file-{index:02d}.ts" for index in range(25)]

_REPORT: dict | None = None


def run_harness() -> dict:
    """Drive the harness and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"the harness failed ({proc.returncode}): {proc.stdout}\n{proc.stderr}"
        )
    for line in proc.stdout.splitlines():
        if line.startswith("SELECT_FILES "):
            _REPORT = json.loads(line[len("SELECT_FILES ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no SELECT_FILES line: {proc.stdout}\n{proc.stderr}"
    )


def test_local_repo() -> None:
    """A local repository lists its files with size, language and last commit."""
    local = run_harness()["local"]
    meta = local["repo_meta"]
    assert meta["source"] == "local", meta
    assert meta["fileCount"] == 4, meta
    assert meta["ecosystems"] == ["node"], meta
    assert isinstance(meta.get("commit"), str) and meta["commit"], meta
    assert "url" not in meta, meta
    assert local["page"] == 1, local
    assert local["page_size"] == 50, local
    assert local["total"] == 4, local
    assert local["has_more"] is False, local

    paths = [node["path"] for node in local["tree"]]
    assert paths == LOCAL_PATHS, paths

    by_path = {node["path"]: node for node in local["tree"]}
    for node in local["tree"]:
        assert node["type"] == "file", node
        assert isinstance(node["size"], int) and node["size"] > 0, node
        assert isinstance(node.get("lastCommit"), str), node
    assert by_path["src/alpha.ts"]["language"] == "typescript", by_path
    assert by_path["src/beta.ts"]["language"] == "typescript", by_path
    # No extension mapping exists for either file, so the field is omitted
    # rather than guessed.
    assert "language" not in by_path["README.md"], by_path
    assert "language" not in by_path["package.json"], by_path


def test_remote_repo() -> None:
    """A repository url is materialized through the port and cleaned up after."""
    remote = run_harness()["remote"]
    meta = remote["repo_meta"]
    assert meta["source"] == "remote", meta
    assert meta["url"] == REMOTE_URL, meta
    assert meta["fileCount"] == 4, meta
    assert [node["path"] for node in remote["tree"]] == LOCAL_PATHS, remote
    assert remote["cleaned"] == 1, remote


def test_pagination() -> None:
    """A large repository is paged deterministically."""
    pager = run_harness()["pagination"]
    assert pager["page_size"] == 10, pager
    assert pager["total"] == len(PAGED_PATHS), pager
    assert pager["first_count"] == 10, pager
    assert pager["first_has_more"] is True, pager
    assert pager["last_count"] == 5, pager
    assert pager["last_has_more"] is False, pager
    assert pager["last_paths"] == PAGED_PATHS[20:], pager


def main() -> int:
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
            print(f"ok {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
