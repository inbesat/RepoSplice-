"""P-325 — the human rubric contract tests.

Two mandated cases:

* ``test_schema_valid`` — the emitted rubric JSON Schema accepts a scored
  rubric (and declares the 1-5 range), and the trial worksheet validates
  against the REAL zod schema through the bun harness.
* ``test_trial_kappa`` — the trial scoring of three corpus pairs by two
  raters reaches the inter-rater reliability threshold (Cohen's kappa
  >= 0.6).

The CI is bun-only, so the zod validation runs in the bun harness
(``packages/core/src/__tests__/fixtures/rubric-harness.ts``) and this file
drives it; the JSON-Schema level checks use the standard-library validator
that ships with the corpus tooling (``eval/scripts/validate_corpus.py``).

Runnable with pytest AND standalone::

    python packages/core/test_rubric.py
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "eval" / "scripts"))

import validate_corpus  # noqa: E402  (path bootstrap above)

HARNESS = REPO_ROOT / "packages" / "core" / "src" / "__tests__" / "fixtures" / "rubric-harness.ts"
SCHEMA_PATH = REPO_ROOT / "eval" / "rubric" / "schema.json"
WORKSHEET_PATH = REPO_ROOT / "eval" / "rubric" / "trial-worksheet.json"

SCORE_FIELDS = ("wiring_correctness", "unnecessary_changes", "respects_patterns")

#: The inter-rater reliability the trial must reach before the rubric is
#: frozen (the plan's threshold).
KAPPA_THRESHOLD = 0.6


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_harness() -> dict:
    """Run the bun harness and return its parsed report."""
    completed = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(
            "rubric harness failed with exit code "
            f"{completed.returncode}: {completed.stderr.strip()}"
        )
    for line in completed.stdout.splitlines():
        if line.startswith("RUBRIC "):
            return json.loads(line[len("RUBRIC ") :])
    raise AssertionError(f"rubric harness printed no RUBRIC report: {completed.stdout!r}")


def test_schema_valid():
    schema = load_json(SCHEMA_PATH)
    worksheet = load_json(WORKSHEET_PATH)
    properties = schema.get("properties", {})

    # The three scored dimensions are declared, integer, and bounded 1-5.
    for field in SCORE_FIELDS:
        declared = properties.get(field)
        assert declared is not None, f"{field} is missing from the rubric schema"
        assert declared.get("type") == "integer", f"{field} must be an integer score"
        assert declared.get("minimum") == 1, f"{field} must not go below 1"
        assert declared.get("maximum") == 5, f"{field} must not go above 5"
    assert properties.get("notes", {}).get("type") == "string", "notes must be a string"
    assert properties.get("pair_id", {}).get("type") == "string", "pair_id must be a string"
    assert properties.get("rater", {}).get("type") == "string", "rater must be a string"

    # Every scored rubric in the worksheet is shape-valid against the
    # emitted schema (the standard-library validator reads the document).
    for index, trial in enumerate(worksheet["trials"]):
        for side in ("a", "b"):
            errors = validate_corpus.validate_instance(schema, trial[side], schema)
            assert errors == [], f"trials[{index}].{side} is invalid: {errors}"

    # The real zod schema accepts the worksheet (the bun harness runs it).
    report = run_harness()
    assert report["valid"] is True, f"the worksheet did not validate: {report['rejections']}"
    assert report["rejections"] == []
    assert report["trials"] == len(worksheet["trials"])


def test_trial_kappa():
    worksheet = load_json(WORKSHEET_PATH)
    report = run_harness()
    assert report["valid"] is True, f"the worksheet did not validate: {report['rejections']}"
    assert report["trials"] == 3, "the trial must score three pairs"
    kappa = report["kappa"]
    assert kappa >= KAPPA_THRESHOLD, (
        f"inter-rater kappa {kappa} is below the {KAPPA_THRESHOLD} threshold - "
        "the rubric wording must be adjusted before the baseline run"
    )
    scored = {trial["a"]["pair_id"] for trial in worksheet["trials"]}
    assert scored == set(report["pair_ids"]), "the harness scored different pairs"


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if name.startswith("test_") and callable(test):
            try:
                test()
                print(f"ok {name}")
            except AssertionError as error:
                failures += 1
                print(f"FAIL {name}: {error}")
    raise SystemExit(1 if failures else 0)
