"""P-337 — the python resolver's mandated tests.

The CI is bun-only, so the python tests drive the REAL resolver through a bun
harness (packages/core/src/__tests__/fixtures/python-resolver-harness.ts) and
assert on its report: the jedi fallback must resolve every import kind of the
ground-truth fixture.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/python-resolver-harness.ts"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the harness once and return its report."""
    global _REPORT
    if _REPORT is None:
        proc = subprocess.run(
            ["bun", str(HARNESS)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        line = next(
            (item for item in proc.stdout.splitlines() if item.startswith("RESOLVE ")),
            None,
        )
        if line is None:
            raise AssertionError(
                f"the harness produced no report (exit {proc.returncode}): "
                f"{proc.stdout}\n{proc.stderr}"
            )
        _REPORT = json.loads(line[len("RESOLVE ") :])
    return _REPORT


def case_of(report: dict, name: str) -> dict:
    """The report entry of one ground-truth case."""
    for case in report["cases"]:
        if case["name"] == name:
            return case
    raise AssertionError(f"the report has no case {name}: {report}")


def test_relative_imports() -> None:
    """A relative import resolves to the module next to the importer."""
    report = run_harness()
    case = case_of(report, "relative")
    assert case["ok"], case
    assert case["target"] == "pkg/module.py", case
    assert case["confidence"] == "heuristic-medium", case


def test_absolute_imports() -> None:
    """An absolute package import resolves through the workspace root."""
    report = run_harness()
    case = case_of(report, "absolute")
    assert case["ok"], case
    assert case["target"] == "pkg/module.py", case


def test_conditional_imports() -> None:
    """An import under TYPE_CHECKING resolves like any other."""
    report = run_harness()
    case = case_of(report, "conditional")
    assert case["ok"], case
    assert case["target"] == "pkg/typing_only.py", case


def test_fallback_accuracy() -> None:
    """The fallback resolves every import kind of the fixture."""
    report = run_harness()
    assert report["mode"] == "jedi", report
    assert report["allOk"], report
    assert report["accuracy"] == "4/4", report
    # The language server is not installed here, so its path reports
    # 'unavailable' - a missing measurement is never a zero.
    assert report["lsp"]["ok"] is False, report


def main() -> int:
    """Run every test in this file and report the result."""
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except AssertionError as error:
            print(f"FAIL {name}: {error}")
            failures += 1
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
