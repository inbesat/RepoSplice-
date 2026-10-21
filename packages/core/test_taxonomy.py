# P-331 — the failure taxonomy: every pair is classified and the Epic 17
# decision rule is applied to the frequencies.
#
# The CI is bun-only, so the python side drives the REAL taxonomy module
# through the bun harness (packages/core/src/__tests__/fixtures/taxonomy-harness.ts)
# — the P-323/P-324 pattern.

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "packages/core/src/__tests__/fixtures/taxonomy-harness.ts"


def run_taxonomy() -> dict:
    proc = subprocess.run(
        ["bun", str(HARNESS)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("TAXONOMY "):
            return json.loads(line[len("TAXONOMY ") :])
    raise AssertionError(
        "the taxonomy harness printed no TAXONOMY line "
        f"(exit {proc.returncode})\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )


def test_all_pairs_classified() -> None:
    data = run_taxonomy()
    report = data["report"]
    entries = {entry["pair_id"]: entry for entry in report["entries"]}
    for pair_id in data["pair_ids"]:
        assert pair_id in entries, f"{pair_id} was not classified"
    assert entries["fixture-pass"]["primary_category"] == "none"
    assert entries["fixture-import"]["primary_category"] == "import-resolution"
    assert entries["fixture-import-2"]["primary_category"] == "import-resolution"
    assert entries["fixture-semver"]["primary_category"] == "semver-conflict"
    assert entries["fixture-license"]["primary_category"] == "license-block"
    assert entries["fixture-timeout"]["primary_category"] == "sandbox-timeout"
    assert entries["fixture-loop"]["primary_category"] == "loop-cap-exceeded"
    assert entries["fixture-semantic"]["primary_category"] == "semantic-wrong-but-builds"
    assert entries["fixture-unknown"]["primary_category"] == "unknown"
    assert report["total_pairs"] == len(data["pair_ids"])
    assert report["total_failures"] == len(data["pair_ids"]) - 1
    assert report["frequencies"]["import-resolution"] == 2


def test_decision_rule_applied() -> None:
    data = run_taxonomy()
    report = data["report"]
    assert report["decision"] == "epic17-warranted"
    assert report["import_resolution_share"] >= 0.2
    assert report["reasons"]
    deferred = data["deferred"]
    assert deferred["decision"] == "epic17-deferred"
    assert deferred["reasons"]


if __name__ == "__main__":
    failures = 0
    for name, test in sorted(globals().items()):
        if name.startswith("test_") and callable(test):
            try:
                test()
                print(f"ok {name}")
            except Exception as error:  # noqa: BLE001 - the runner reports every failure
                print(f"FAIL {name}: {error}")
                failures += 1
    raise SystemExit(1 if failures else 0)
