"""P-345 — the resolver accuracy tests (the mandated ids).

The CI is bun-only, so the python ids drive the REAL resolver stack through the
bun harness (packages/core/src/__tests__/fixtures/resolver-accuracy-harness.ts)
and assert on its report: per-ecosystem accuracy against the ground-truth
fixtures, the confidence tags, the fallback when the language server is dead,
and the measured cold/warm latency.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/resolver-accuracy-harness.ts"

ACCURACY_BAR = 95
CONFIDENCE_TAGS = {"lsp-high", "heuristic-medium", "unresolved"}

_REPORT: dict | None = None


def run_harness() -> dict:
    """Drive the harness once and return its report."""
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
        if line.startswith("ACCURACY "):
            _REPORT = json.loads(line[len("ACCURACY ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no ACCURACY line: {proc.stdout}\n{proc.stderr}"
    )


def ecosystem(name: str) -> dict:
    """One ecosystem's report entry."""
    report = run_harness()["ecosystems"]
    if name not in report:
        raise AssertionError(f"the report has no {name} ecosystem: {report}")
    return report[name]


def assert_accuracy(name: str) -> None:
    """The shared bar: at or above 95% of the ground-truth cases."""
    entry = ecosystem(name)
    assert entry["cases"], entry
    assert entry["total"] > 0, entry
    assert entry["accuracyPercent"] >= ACCURACY_BAR, entry
    assert entry["met"] is True, entry


def test_js_accuracy() -> None:
    """The TypeScript/JavaScript fixture resolves at or above the bar."""
    assert_accuracy("typescript")


def test_python_accuracy() -> None:
    """The Python fixture resolves at or above the bar."""
    assert_accuracy("python")


def test_go_accuracy() -> None:
    """The Go fixture resolves at or above the bar."""
    assert_accuracy("go")


def test_rust_accuracy() -> None:
    """The Rust fixture resolves at or above the bar."""
    assert_accuracy("rust")


def test_fallback_behavior() -> None:
    """A dead language server must not stop the resolver."""
    fallback = run_harness()["fallback"]
    assert fallback["crashed"] is False, fallback
    assert fallback["ok"] is True, fallback
    assert fallback["confidence"] == "heuristic-medium", fallback


def test_performance() -> None:
    """A warm request stays well under the cold start."""
    performance = run_harness()["performance"]
    assert performance["coldUnder3000Ms"] is True, performance
    assert performance["warmUnder200Ms"] is True, performance
    assert performance["warmMs"] <= performance["coldMs"], performance


def test_confidence_tags() -> None:
    """Every reported answer carries a known confidence tag."""
    for name, entry in run_harness()["ecosystems"].items():
        tags = entry["tags"]
        assert tags["allValid"] is True, (name, tags)
        for tag in tags["tags"]:
            assert tag in CONFIDENCE_TAGS, (name, tag)


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
