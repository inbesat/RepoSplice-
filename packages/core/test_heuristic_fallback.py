"""P-340 — the heuristic fallback's mandated tests.

The CI is bun-only, so the python ids drive the real resolver through the bun
harness (packages/core/src/__tests__/fixtures/heuristic-fallback-harness.ts)
and assert on its report. The harness reuses the four EXISTING ground-truth
fixtures (ts/python/go/rust) — no fifth fixture is invented — and proves the
LSP-failure integration really falls back to the heuristic path.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = (
    REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "heuristic-fallback-harness.ts"
)

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
    for line in proc.stdout.splitlines():
        if line.startswith("RESOLVE "):
            _REPORT = json.loads(line[len("RESOLVE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no RESOLVE line (exit {proc.returncode}):\n{proc.stdout}\n{proc.stderr}"
    )


def language(name: str) -> dict:
    """The per-language report entry."""
    report = run_harness()
    entry = report.get("languages", {}).get(name)
    if entry is None:
        raise AssertionError(f"the report has no language {name}: {report}")
    return entry


def assert_fallback_only(entry: dict) -> None:
    """Every edge of the fallback is tagged heuristic-medium."""
    for case in entry["cases"]:
        assert case["confidence"] in (None, "heuristic-medium"), case


def test_js_resolution() -> None:
    entry = language("typescript")
    assert entry["allOk"] is True, entry
    assert entry["accuracy"] == "4/4", entry
    assert_fallback_only(entry)


def test_python_resolution() -> None:
    entry = language("python")
    assert entry["allOk"] is True, entry
    assert_fallback_only(entry)


def test_go_resolution() -> None:
    entry = language("go")
    assert entry["allOk"] is True, entry
    assert_fallback_only(entry)


def test_rust_resolution() -> None:
    entry = language("rust")
    assert entry["allOk"] is True, entry
    assert_fallback_only(entry)


def test_lsp_failure_triggers_fallback() -> None:
    report = run_harness()
    failure = report["lspFailure"]
    assert failure["ok"] is True, failure
    assert failure["confidence"] == "heuristic-medium", failure
    for name, entry in report["extraction"].items():
        assert entry["ok"] is True, (name, entry)
        assert entry["count"] >= 1, (name, entry)


def main() -> int:
    """Run every test in this file and report the result."""
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
