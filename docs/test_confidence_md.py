#!/usr/bin/env python3
"""CONFIDENCE.md must exist, carry every required section and state its limits.

The document is hand-written, so these checks guard the two ways it can drift
from the product: a section that went missing, and a disclaimer that softened
into a promise the score cannot keep.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIDENCE_MD = REPO_ROOT / "CONFIDENCE.md"
README_MD = REPO_ROOT / "README.md"
EVAL_MD = REPO_ROOT / "EVAL.md"

REQUIRED_SECTIONS = (
    "## Overview",
    "## Score Interpretation",
    "## Factor Descriptions",
    "## Threshold Policy",
    "## Calibration Methodology",
    "## Limitations",
    "## How to Improve Scores",
    "## Version History",
)

REQUIRED_DISCLAIMER = (
    "is a heuristic, not a correctness guarantee",
    "A high score is never proof that a merge is correct",
)


def read_text(path: Path) -> str:
    """Read a file, or fail the test with a clear message."""
    assert path.exists(), f"{path} is missing"
    return path.read_text(encoding="utf-8")


def test_sections_present() -> None:
    """Every required section is in the document and both docs link to it."""
    document = read_text(CONFIDENCE_MD)
    for section in REQUIRED_SECTIONS:
        assert section in document, f"CONFIDENCE.md is missing the section {section}"
    readme = read_text(README_MD)
    assert "CONFIDENCE.md" in readme, "the README does not link CONFIDENCE.md"
    eval_md = read_text(EVAL_MD)
    assert "CONFIDENCE.md" in eval_md, "EVAL.md does not link CONFIDENCE.md"


def test_disclaimer_present() -> None:
    """The document says what the score is not, in those words."""
    document = read_text(CONFIDENCE_MD)
    for phrase in REQUIRED_DISCLAIMER:
        assert phrase in document, f"CONFIDENCE.md is missing the disclaimer: {phrase}"
    assert "not yet calibrated on a live corpus" in document, (
        "CONFIDENCE.md does not disclose the live-corpus limitation"
    )


def main() -> int:
    """Run every test in this file, printing one line per test."""
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
