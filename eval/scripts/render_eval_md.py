#!/usr/bin/env python3
"""Render the public EVAL.md from the committed eval artifacts.

The document is NOT hand-written: every number in it comes from an artifact
that the harness produced, so the published methodology can never drift from
the measurements it describes. The renderer is stdlib-only (a fresh clone can
regenerate the document without installing anything).

Usage:
    python eval/scripts/render_eval_md.py [--out EVAL.md]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]

PAIRS_PATH = REPO_ROOT / "eval" / "corpus" / "pairs.json"
BASELINE_PATH = REPO_ROOT / "eval" / "results" / "baseline-dryrun-20261021.json"
BREAKDOWN_PATH = REPO_ROOT / "eval" / "report" / "ecosystem_breakdown.json"
TAXONOMY_PATH = REPO_ROOT / "eval" / "taxonomy" / "failure_categories.json"

# The rubric dimensions (P-325) - kept in one place so the document and the
# schema cannot describe different dimensions.
RUBRIC_DIMENSIONS = (
    "wiring_correctness",
    "unnecessary_changes",
    "respects_patterns",
)

# The failure taxonomy (P-331).
TAXONOMY_CATEGORIES = (
    "import-resolution",
    "semver-conflict",
    "license-block",
    "loop-cap-exceeded",
    "sandbox-timeout",
    "semantic-wrong-but-builds",
)


def read_json(path: Path) -> Any:
    """Read one JSON document, or report the problem and exit."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        print(f"eval-md: cannot read {path}: {error}", file=sys.stderr)
        raise SystemExit(2)
    except ValueError as error:
        print(f"eval-md: {path} is not valid JSON: {error}", file=sys.stderr)
        raise SystemExit(2)


def current_commit() -> str:
    """The short commit hash of the checkout, or 'unknown'."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    commit = result.stdout.strip()
    return commit if commit else "unknown"


def pct(value: float | None) -> str:
    """A ratio as a percentage with one decimal, or n/a."""
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def num(value: Any) -> str:
    """A number rendered for the document, or n/a."""
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def corpus_table(pairs: list[dict[str, Any]]) -> list[str]:
    """The corpus composition table (one row per pair)."""
    lines = [
        "| pair_id | ecosystem | repo A | repo B | licenses | expected outcome |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for pair in pairs:
        lines.append(
            "| {pair_id} | {ecosystem} | {repo_a} | {repo_b} | {licenses} | {outcome} |".format(
                pair_id=pair.get("pair_id", "?"),
                ecosystem=pair.get("ecosystem", "?"),
                repo_a=pair.get("repo_a_url", "?"),
                repo_b=pair.get("repo_b_url", "?"),
                licenses="{a} / {b}".format(
                    a=pair.get("license_a", "?"), b=pair.get("license_b", "?")
                ),
                outcome=pair.get("expected_outcome", "?"),
            )
        )
    return lines


def ecosystem_table(breakdown: dict[str, Any]) -> list[str]:
    """The per-ecosystem breakdown table (P-329)."""
    lines = [
        "| ecosystem | pairs | build-pass | rubric | resolve | tokens | cost | duration |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for stats in breakdown.get("ecosystems", []):
        lines.append(
            "| {ecosystem} | {pairs} | {build} | {rubric} | {resolve} | {tokens} | {cost} | {duration} |".format(
                ecosystem=stats.get("ecosystem", "?"),
                pairs=stats.get("pairs", 0),
                build=pct(stats.get("build_pass_rate")),
                rubric=num(stats.get("rubric_avg")),
                resolve=pct(stats.get("resolve_rate")),
                tokens=stats.get("tokens_total", 0),
                cost=num(stats.get("cost_total", 0)),
                duration=stats.get("duration_total", 0),
            )
        )
    totals = breakdown.get("totals", {})
    lines.append(
        "| all | {pairs} | {build} | {rubric} | {resolve} | {tokens} | {cost} | {duration} |".format(
            pairs=totals.get("pairs", 0),
            build=pct(totals.get("build_pass_rate")),
            rubric=num(totals.get("rubric_avg")),
            resolve=pct(totals.get("resolve_rate")),
            tokens=totals.get("tokens_total", 0),
            cost=num(totals.get("cost_total", 0)),
            duration=totals.get("duration_total", 0),
        )
    )
    return lines


def taxonomy_table(taxonomy: dict[str, Any]) -> list[str]:
    """The failure taxonomy frequencies (P-331)."""
    frequencies = taxonomy.get("frequencies", {})
    lines = [
        "| category | count |",
        "| --- | --- |",
    ]
    for category in TAXONOMY_CATEGORIES:
        lines.append(f"| {category} | {frequencies.get(category, 0)} |")
    for extra in ("unknown", "none"):
        if extra in frequencies:
            lines.append(f"| {extra} | {frequencies.get(extra, 0)} |")
    return lines


def render() -> str:
    """The whole EVAL.md document."""
    pairs = read_json(PAIRS_PATH)
    baseline = read_json(BASELINE_PATH)
    breakdown = read_json(BREAKDOWN_PATH)
    taxonomy = read_json(TAXONOMY_PATH)

    if not isinstance(pairs, list):
        print("eval-md: the corpus manifest must be a list", file=sys.stderr)
        raise SystemExit(2)

    commit = current_commit()
    machine_readable = {
        "generated_at": baseline.get("generated_at"),
        "pairs": baseline.get("pairs"),
        "rated": baseline.get("rated"),
        "build_pass_count": baseline.get("build_pass_count"),
        "build_pass_rate": baseline.get("build_pass_rate"),
        "rubric_avg": baseline.get("rubric_avg"),
        "resolved_count": baseline.get("resolved_count"),
        "resolve_rate": baseline.get("resolve_rate"),
        "decision": baseline.get("decision"),
        "commit": commit,
        "corpus_pairs": len(pairs),
    }

    lines: list[str] = []
    lines.append("# EVAL.md - the stitch evaluation methodology")
    lines.append("")
    lines.append(
        "This document explains what the evaluation corpus measures, how a run is "
        "produced, and how to read the numbers. It is generated from the "
        "committed artifacts by `python eval/scripts/render_eval_md.py`, so the "
        "published numbers cannot drift from the measurements they describe."
    )
    lines.append("")
    lines.append("## Overview")
    lines.append("")
    lines.append(
        "The corpus is a set of real repository pairs. For each pair the harness "
        "clones both sides at their pinned commits, extracts the selected paths, "
        "runs the agent loop, builds and tests the merged child in a sandbox, and "
        "then a human rates the merge with the semantic rubric. Three numbers "
        "summarise a run: the **build-pass rate** (the pairs whose merged child "
        "builds and tests clean), the **rubric average** (the mean of the three "
        "rubric dimensions over both raters) and the **resolve rate** (the pairs "
        "that build AND average at least 4)."
    )
    lines.append("")
    lines.append(
        f"The corpus holds {len(pairs)} pairs. The baseline below was produced by "
        "a dry run over the fixture corpus (the full provider-backed run needs "
        "Docker and an AI key - see ADR-135); it exercises the whole pipeline "
        "and the metric maths, and it is NOT a corpus measurement."
    )
    lines.append("")
    lines.append("## Corpus Composition")
    lines.append("")
    lines.append(
        "Every pair pins both repositories to an immutable commit and uses a "
        "permissive license on both sides."
    )
    lines.append("")
    lines.extend(corpus_table(pairs))
    lines.append("")
    lines.append("## Evaluation Methodology")
    lines.append("")
    lines.append("The harness (`stitch eval run <corpus>`) runs five steps per pair:")
    lines.append("")
    lines.append("1. **Clone** both repositories at the pinned commits.")
    lines.append("2. **Extract** the selected paths with `git filter-repo`.")
    lines.append("3. **Agent loop** - the merge is produced by the pipeline stages.")
    lines.append("4. **Sandbox** - the merged child is built and tested in a container.")
    lines.append("5. **Rate** - a human fills the rubric for the pair.")
    lines.append("")
    lines.append(
        "The rubric has three dimensions, each scored 1-5 (a 0 or a 6 is "
        "rejected by the schema):"
    )
    lines.append("")
    for dimension in RUBRIC_DIMENSIONS:
        lines.append(f"- `{dimension}`")
    lines.append("")
    lines.append(
        "The mean of the three dimensions is the pair's rubric score; a pair "
        "resolves when it builds AND averages at least 4. Both owners rate the "
        "same pairs independently, and the inter-rater reliability (Cohen's "
        "kappa) must stay at or above 0.6 for the rubric to be trusted."
    )
    lines.append("")
    lines.append("## Baseline Results")
    lines.append("")
    lines.append(
        f"Measured at {baseline.get('generated_at')} on commit `{commit}`."
    )
    lines.append("")
    lines.append("| metric | value |")
    lines.append("| --- | --- |")
    lines.append(f"| pairs | {baseline.get('pairs', 0)} |")
    lines.append(f"| rated pairs | {baseline.get('rated', 0)} |")
    lines.append(f"| build-pass count | {baseline.get('build_pass_count', 0)} |")
    lines.append(f"| build-pass rate | {baseline.get('build_pass_rate')} |")
    lines.append(f"| rubric average | {num(baseline.get('rubric_avg'))} |")
    lines.append(f"| resolve count | {baseline.get('resolved_count', 0)} |")
    lines.append(f"| resolve rate | {baseline.get('resolve_rate')} |")
    lines.append(f"| decision | {baseline.get('decision')} |")
    lines.append("")
    for reason in baseline.get("reasons", []):
        lines.append(f"- {reason}")
    lines.append("")
    lines.append("<!-- eval-baseline")
    lines.append(json.dumps(machine_readable, indent=2, sort_keys=True))
    lines.append("-->")
    lines.append("")
    lines.append("## Failure Taxonomy")
    lines.append("")
    lines.append(
        "Every failed pair is classified into one category so the roadmap can be "
        "decided on data instead of anecdotes."
    )
    lines.append("")
    lines.extend(taxonomy_table(taxonomy))
    lines.append("")
    lines.append(
        f"Current decision: **{taxonomy.get('decision')}** "
        f"(import-resolution share {pct(taxonomy.get('import_resolution_share'))})."
    )
    lines.append("")
    for reason in taxonomy.get("reasons", []):
        lines.append(f"- {reason}")
    lines.append("")
    lines.append("## Per-Ecosystem Breakdown")
    lines.append("")
    lines.append(
        "Which language drags the average down. The mean and the median of every "
        "metric are reported, and a metric nobody measured stays `n/a`."
    )
    lines.append("")
    lines.extend(ecosystem_table(breakdown))
    lines.append("")
    lines.append("## Cost Analysis")
    lines.append("")
    lines.append(
        "The cost numbers come from the provider audit log (P-145): the module "
        "never re-prices a call it did not make. Prices are the core model "
        "registry (USD per 1M tokens); a model that is not in the registry costs "
        "0 while its tokens are still counted. The report shows the "
        "cost-per-successful-merge per ecosystem (that is the number that "
        "matters for a budget), and the CLI takes `--budget <usd>` (0 = off) to "
        "raise an alert when a run exceeds it."
    )
    lines.append("")
    lines.append("## How to Run Locally")
    lines.append("")
    lines.append("```sh")
    lines.append("# 1. the harness (needs Docker for the sandbox and an AI key)")
    lines.append("bun run --cwd packages/cli eval run eval/corpus --parallel 4 \\")
    lines.append("  --output-dir eval/results/baseline-$(date +%s)")
    lines.append("")
    lines.append("# 2. rate the pairs (both owners, independently)")
    lines.append("bun run --cwd packages/cli eval rate <pair-id> \\")
    lines.append("  --result-dir eval/results/baseline-$(date +%s) --rater <you>")
    lines.append("")
    lines.append("# 3. the metrics + the go/no-go decision")
    lines.append("bun run --cwd packages/cli eval baseline \\")
    lines.append("  --result-dir eval/results/baseline-$(date +%s) --corpus eval/corpus")
    lines.append("")
    lines.append("# 4. the per-ecosystem table + the taxonomy")
    lines.append("bun run --cwd packages/cli eval report --result-dir <dir>")
    lines.append("bun run --cwd packages/cli eval taxonomy --result-dir <dir>")
    lines.append("")
    lines.append("# 5. regenerate this document")
    lines.append("python eval/scripts/render_eval_md.py")
    lines.append("```")
    lines.append("")
    lines.append("## How to Contribute Pairs")
    lines.append("")
    lines.append(
        "New pairs come from outside. [eval/corpus/CONTRIBUTING.md]"
        "(eval/corpus/CONTRIBUTING.md) has the selection criteria, the schema, "
        "the license rules, the diversity rule and the pull request template; "
        "`eval/scripts/validate_contribution.py` checks a contribution against "
        "the schema, the permissive license list, the pinned commits and the "
        "diversity rule, and the `eval-corpus-pr` workflow runs it on every "
        "pull request that touches the corpus."
    )
    lines.append("")
    lines.append("## Versioning & Updates")
    lines.append("")
    lines.append(
        "This document is regenerated on every `v*` tag by the release workflow "
        "and committed back to `main`, so the published numbers always describe "
        "the tagged tree. The schema of the corpus, the rubric and the taxonomy "
        "are frozen contracts: changing one needs an ADR and a refreshed "
        "`eval/corpus/schema.json` (or `eval/rubric/schema.json`) in the same "
        "commit."
    )
    lines.append("")
    lines.append(
        "The confidence score that sits alongside these numbers is documented "
        "separately in [CONFIDENCE.md](CONFIDENCE.md): it is a heuristic signal "
        "about a proposed merge, not a correctness guarantee."
    )
    lines.append("")
    lines.append(
        "Driving the same engine from an MCP host instead of the CLI is covered "
        "by [MCP_QUICKSTART.md](MCP_QUICKSTART.md): installation, the shared "
        "`~/.stitch/config.json`, an example session, the progress stream and "
        "the per-host notes."
    )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    """Render the document to the output path."""
    parser = argparse.ArgumentParser(description="render EVAL.md from the artifacts")
    parser.add_argument(
        "--out",
        default=str(REPO_ROOT / "EVAL.md"),
        help="where the document is written (default: EVAL.md at the repo root)",
    )
    args = parser.parse_args(argv)
    document = render()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(document, encoding="utf-8", newline="\n")
    print(f"eval-md: wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
