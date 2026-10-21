"""P-334 - the LSP spike tests.

The spike is conditional: it only measures when the P-331 taxonomy says the
cross-language work is warranted.  These two tests therefore check the two
things that must hold in BOTH worlds:

  test_latency_measured        - a latency number exists only for a language
                                 that was actually measured; the gate-closed
                                 case claims nothing
  test_stability_100_requests  - the stability figures (the 100-request error
                                 rate + the recovery) exist only for a measured
                                 language; an unmeasured language carries null,
                                 never a fake 0% error rate

The harness is also run here (hermetically, with the recorded taxonomy) to
prove the gate path itself works.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HARNESS = REPO_ROOT / "eval" / "scripts" / "lsp_spike.py"
TAXONOMY = REPO_ROOT / "eval" / "taxonomy" / "failure_categories.json"
REPORT = REPO_ROOT / "eval" / "lsp_spike" / "results.json"

MEASURED = "measured"
STABILITY_FIELDS = ("requests", "answered", "errors", "error_rate", "recovered")


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise AssertionError(f"{path} does not hold a JSON object")
    return value


def report() -> dict:
    assert REPORT.exists(), f"the spike report is missing: {REPORT}"
    return load_json(REPORT)


def test_latency_measured() -> None:
    data = report()
    languages = data.get("languages")
    assert isinstance(languages, list) and languages, "the report carries no language"
    gate = data.get("gate")
    assert isinstance(gate, dict), "the report carries no gate state"
    assert "decision" in str(gate.get("reason")).lower() or gate.get("open") is True, (
        "the gate reason must name the P-331 decision"
    )
    for language in languages:
        status = language.get("status")
        if status == MEASURED:
            cold = language.get("cold_start_ms")
            request = language.get("request_ms")
            assert isinstance(cold, (int, float)) and cold > 0, (
                f"{language.get('language')}: a measured cold start must be a number"
            )
            assert isinstance(request, (int, float)) and request > 0, (
                f"{language.get('language')}: a measured request must be a number"
            )
        else:
            assert language.get("cold_start_ms") is None, (
                f"{language.get('language')}: only a measured language may claim a latency"
            )
            assert language.get("request_ms") is None, (
                f"{language.get('language')}: only a measured language may claim a latency"
            )
            assert language.get("note"), (
                f"{language.get('language')}: an unmeasured language must say why"
            )


def test_stability_100_requests() -> None:
    data = report()
    languages = data.get("languages")
    assert isinstance(languages, list) and languages, "the report carries no language"
    for language in languages:
        if language.get("status") == MEASURED:
            for field in STABILITY_FIELDS:
                assert field in language, f"{language.get('language')}: {field} is missing"
            assert language["requests"] == 100, (
                f"{language.get('language')}: the stability probe sends 100 requests"
            )
            rate = language["error_rate"]
            assert isinstance(rate, (int, float)) and 0.0 <= rate <= 1.0, (
                f"{language.get('language')}: the error rate must be a rate"
            )
            assert isinstance(language["recovered"], bool), (
                f"{language.get('language')}: the recovery probe must be a boolean"
            )
        else:
            for field in STABILITY_FIELDS:
                if field == "requests":
                    continue
                assert language.get(field) is None, (
                    f"{language.get('language')}: only a measured language may report {field}"
                )


def test_the_gate_closes_the_spike() -> None:
    """The harness reads the P-331 decision: with the gate closed nothing is measured."""
    with tempfile.TemporaryDirectory() as directory:
        out = Path(directory) / "results.json"
        result = subprocess.run(
            [sys.executable, str(HARNESS), "--out", str(out), "--taxonomy", str(TAXONOMY)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, f"the harness failed: {result.stdout}{result.stderr}"
        data = load_json(out)
        assert data["gate"]["open"] is False, "the recorded P-331 decision closes the gate"
        for language in data["languages"]:
            assert language["status"] == "skipped-gate", (
                f"{language['language']}: a closed gate measures nothing"
            )
            assert language["cold_start_ms"] is None, "a closed gate claims no latency"


if __name__ == "__main__":
    failures = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
            print(f"ok {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL {name}: {error}")
    raise SystemExit(1 if failures else 0)
