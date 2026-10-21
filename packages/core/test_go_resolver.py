"""P-338 — the Go resolver's mandated tests.

The CI is bun-only, so the python ids drive the real resolver through the bun
harness (packages/core/src/__tests__/fixtures/go-resolver-harness.ts) and assert
on its report. The harness resolves the ground-truth fixture in place: the Go
module graph (go.mod + go.work + vendor + the build tags) is the fallback path,
because gopls is not installed in every environment.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "go-resolver-harness.ts"

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
        if line.startswith("RESOLVE "):
            _REPORT = json.loads(line[len("RESOLVE ") :])
            return _REPORT
    raise AssertionError(f"the harness printed no RESOLVE line: {proc.stdout}\n{proc.stderr}")


def case(report: dict, name: str) -> dict:
    for item in report.get("cases", []):
        if item.get("name") == name:
            return item
    raise AssertionError(f"the report has no case {name}: {report}")


def test_module_imports() -> None:
    report = run_harness()
    item = case(report, "module")
    assert item["ok"] is True, item
    assert item["target"] == "pkg/pkg.go", item
    assert item["confidence"] == "heuristic-medium", item


def test_vendor() -> None:
    report = run_harness()
    item = case(report, "vendor")
    assert item["ok"] is True, item
    assert item["target"] == "vendor/example.com/dep/thing/thing.go", item


def test_workspace() -> None:
    report = run_harness()
    item = case(report, "workspace")
    assert item["ok"] is True, item
    assert item["target"] == "other/pkg/pkg.go", item
    assert report["allOk"] is True, report
    assert report["accuracy"] == f"{len(report['cases'])}/{len(report['cases'])}", report


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
