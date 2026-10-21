#!/usr/bin/env python3
"""The published EVAL.md must exist, carry every section and tell the truth.

The document is generated (eval/scripts/render_eval_md.py), so these checks
guard the two ways it can go wrong: a hand edit that removed a section, and a
document whose numbers no longer match the artifact they were rendered from.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
EVAL_MD = REPO_ROOT / "EVAL.md"
ALIAS_MD = REPO_ROOT / "docs" / "eval-methodology.md"
README_MD = REPO_ROOT / "README.md"
BASELINE_PATH = REPO_ROOT / "eval" / "results" / "baseline-dryrun-20261021.json"
PAIRS_PATH = REPO_ROOT / "eval" / "corpus" / "pairs.json"

REQUIRED_SECTIONS = (
    "## Overview",
    "## Corpus Composition",
    "## Evaluation Methodology",
    "## Baseline Results",
    "## Failure Taxonomy",
    "## Per-Ecosystem Breakdown",
    "## Cost Analysis",
    "## How to Run Locally",
    "## How to Contribute Pairs",
    "## Versioning & Updates",
)


def read_text(path: Path) -> str:
    """Read a file, or fail the test with a clear message."""
    assert path.exists(), f"{path} is missing"
    return path.read_text(encoding="utf-8")


def machine_readable_baseline(document: str) -> dict:
    """The machine-readable block the renderer embeds in the document."""
    marker = "<!-- eval-baseline"
    start = document.find(marker)
    assert start != -1, "EVAL.md carries no machine-readable baseline block"
    end = document.find("-->", start)
    assert end != -1, "the machine-readable baseline block is not closed"
    payload = document[start + len(marker) : end].strip()
    return json.loads(payload)


def test_sections_present() -> None:
    """Every required section is in the document, the alias points at it."""
    document = read_text(EVAL_MD)
    for section in REQUIRED_SECTIONS:
        assert section in document, f"EVAL.md is missing the section {section}"
    alias = read_text(ALIAS_MD)
    assert "EVAL.md" in alias, "the docs alias does not point at EVAL.md"
    readme = read_text(README_MD)
    assert "EVAL.md" in readme, "the README does not link EVAL.md"


def test_baseline_numbers_match() -> None:
    """The published numbers are the numbers in the baseline artifact."""
    document = read_text(EVAL_MD)
    published = machine_readable_baseline(document)
    baseline = json.loads(read_text(BASELINE_PATH))
    pairs = json.loads(read_text(PAIRS_PATH))
    assert published["build_pass_rate"] == baseline["build_pass_rate"]
    assert published["pairs"] == baseline["pairs"]
    assert published["rated"] == baseline["rated"]
    assert published["rubric_avg"] == baseline["rubric_avg"]
    assert published["resolve_rate"] == baseline["resolve_rate"]
    assert published["decision"] == baseline["decision"]
    assert published["generated_at"] == baseline["generated_at"]
    assert published["corpus_pairs"] == len(pairs)
    assert published["commit"] != ""


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
