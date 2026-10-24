"""P-353 - the mandated CLI confidence-summary colour-coding test.

The CI is bun-only, so the python id drives the real formatter through the bun
harness (packages/cli/src/__tests__/fixtures/confidence-summary-harness.ts) and
asserts on its report. The harness output is decoded as UTF-8: the summary
carries the band glyphs and the merge dry-run line carries an em dash, and the
default Windows locale would mangle both.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/cli/src/__tests__/fixtures/confidence-summary-harness.ts"

_REPORT: dict | None = None


def run_harness() -> dict:
    """Run the bun harness once and return its report."""
    global _REPORT
    if _REPORT is not None:
        return _REPORT
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout.splitlines():
        if line.startswith("CONFIDENCE "):
            _REPORT = json.loads(line[len("CONFIDENCE ") :])
            return _REPORT
    raise AssertionError(
        f"the harness printed no CONFIDENCE line (exit {proc.returncode})\n"
        f"{proc.stdout}\n{proc.stderr}"
    )


def test_color_coding() -> None:
    """The bands, the percentages and the painted-versus-plain output."""
    report = run_harness()
    assert report["mode"] == "cli-confidence", report
    # The thresholds mirror the web UI (P-352), the upper bound inclusive.
    assert report["thresholds"] == {"high": 80, "medium": 60}, report["thresholds"]
    assert report["levels"] == {
        "ok": "ok",
        "warn": "warn",
        "err": "err",
        "none": "none",
        "nan": "none",
    }, report["levels"]
    assert report["percents"] == {"scored": "87%", "missing": "N/A"}, report["percents"]
    assert report["flags"]["filtered"] == ["ok", "other"], report["flags"]
    assert report["flags"]["empty"] == [], report["flags"]
    # The painted form tags the band, the `--no-color` form does not.
    painted = report["colors"]["on"][0]
    plain = report["colors"]["off"][0]
    assert "[ok]87%[/]" in painted, painted
    assert "[ok]" not in plain, plain
    assert "87%" in plain, plain
    assert report["stable"] is True, report


def main() -> int:
    """Run every test in this file and report the result."""
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
