"""P-351 - the CREDITS.md confidence section tests (the mandated ids).

The CI is bun-only, so the python ids drive the REAL renderer through the bun
harness (packages/core/src/__tests__/fixtures/credits-confidence-harness.ts):
it renders CREDITS.md with the P-346/P-349 confidence documents and prints one
`CREDITS {json}` line.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/credits-confidence-harness.ts"

COLUMNS = ["File in C", "Source Commit", "Author", "Confidence", "Flags"]
NO_CONFIDENCE_CELL = "N/A"
NO_FLAGS_CELL = "\u2014"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the bun harness and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        # The rendered table uses an em dash, so decode explicitly as UTF-8:
        # the default Windows locale encoding would mangle it.
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout.splitlines():
        if line.startswith("CREDITS "):
            _REPORT = json.loads(line[len("CREDITS ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no CREDITS line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def row(report: dict, name: str) -> dict:
    """The rendered row for one file."""
    for entry in report["rows"]:
        if entry["file"] == name:
            return entry
    raise AssertionError(f"the render has no row for {name}: {report['rows']}")


def test_columns_present() -> None:
    report = run_harness()
    assert report["ok"] is True, report
    assert report["columns"] == COLUMNS, report["columns"]
    header = report["header"]
    for column in COLUMNS:
        assert column in header, header
    assert "---" in report["separator"], report["separator"]
    assert report["rows"], report
    for entry in report["rows"]:
        assert len(entry["cells"]) == len(COLUMNS), entry


def test_scores_match() -> None:
    report = run_harness()
    # The rendered number IS the confidence document's own composite score.
    scored = report["scoredComposite"]
    assert isinstance(scored, int), report
    strong = row(report, "b.ts")
    assert strong["score"] == str(scored), strong
    assert strong["score"] == "77", strong
    weak = row(report, "a.ts")
    assert weak["score"] == str(report["weakComposite"]), weak


def test_flags_rendered() -> None:
    report = run_harness()
    weak = row(report, "a.ts")
    expected = ", ".join(report["weakFlags"])
    assert expected != "", report
    assert weak["flags"] == expected, weak
    strong = row(report, "b.ts")
    assert report["strongFlags"] == [], report
    assert strong["flags"] == NO_FLAGS_CELL, strong
    legacy = row(report, "legacy.ts")
    assert legacy["score"] == NO_CONFIDENCE_CELL, legacy
    assert legacy["flags"] == NO_FLAGS_CELL, legacy
    assert report["hasNote"] is True, report
    assert report["noteWhenAllScored"] is False, report


def main() -> int:
    """Run every test in this file and report the result."""
    failures = 0
    for name, test in sorted(globals().items()):
        if not name.startswith("test_") or not callable(test):
            continue
        try:
            test()
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
        else:
            print(f"ok {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
