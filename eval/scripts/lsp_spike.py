"""P-334 - the LSP viability spike harness.

The spike is a CONDITIONAL phase: it only runs when the P-331 failure taxonomy
says the import-resolution failures are a top-2 category (the P-331 decision
rule).  This harness therefore starts by reading that decision:

  gate open   -> every server is probed and, when the binary exists, measured
  gate closed -> every language is reported as 'skipped-gate' and NO latency,
                 stability or accuracy number is claimed

A server that is not installed is 'unavailable' (not a failure of the project).
A server that misbehaves becomes an error string inside the report - the
harness never raises out of the process.  The report is plain JSON data so the
tests (and the P-335 client) can read it without parsing prose.

Stdlib only: the JSON-RPC framing (Content-Length headers) is implemented here
so the spike has no dependency on a language server.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TAXONOMY = REPO_ROOT / "eval" / "taxonomy" / "failure_categories.json"
DEFAULT_OUT = REPO_ROOT / "eval" / "lsp_spike" / "results.json"

# The gate the P-331 decision produced.  'epic17-warranted' means the
# cross-language work is justified; anything else defers it.
GATE_OPEN_DECISION = "epic17-warranted"

# The four servers the spike evaluates, with the facts that do not depend on a
# measurement: the binary, how it is launched and its license.
SERVERS: tuple[dict[str, str], ...] = (
    {
        "language": "ts",
        "server": "tsserver",
        "binary": "tsserver",
        "args": "--stdio",
        "license": "MIT",
    },
    {
        "language": "python",
        "server": "pyright",
        "binary": "pyright",
        "args": "--stdio",
        "license": "MIT",
    },
    {
        "language": "go",
        "server": "gopls",
        "binary": "gopls",
        "args": "",
        "license": "MIT",
    },
    {
        "language": "rust",
        "server": "rust-analyzer",
        "binary": "rust-analyzer",
        "args": "",
        "license": "MIT OR Apache-2.0",
    },
)

DEFAULT_REQUESTS = 100
INITIALIZE_TIMEOUT_S = 30.0
REQUEST_TIMEOUT_S = 10.0


def read_json(path: Path) -> dict:
    """Read a JSON object; a broken file is a reported error, not a crash."""
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} does not hold a JSON object")
    return value


def gate_state(taxonomy_path: Path) -> tuple[bool, str]:
    """Read the P-331 decision.  Returns (open, reason)."""
    if not taxonomy_path.exists():
        return False, f"the P-331 taxonomy artifact is missing ({taxonomy_path})"
    try:
        taxonomy = read_json(taxonomy_path)
    except (OSError, ValueError) as error:
        return False, f"the P-331 taxonomy artifact is unreadable: {error}"
    decision = taxonomy.get("decision")
    if decision == GATE_OPEN_DECISION:
        return True, "the P-331 decision is 'epic17-warranted'"
    reasons = taxonomy.get("reasons")
    detail = "; ".join(str(reason) for reason in reasons) if isinstance(reasons, list) else ""
    return False, f"the P-331 decision is '{decision}'" + (f" ({detail})" if detail else "")


def frame(payload: dict) -> bytes:
    """One JSON-RPC message in the LSP stdio framing."""
    body = json.dumps(payload).encode("utf-8")
    return b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body


def read_message(stream, timeout_s: float) -> dict | None:
    """Read one framed message; None on a timeout or a closed stream."""
    headers: dict[str, str] = {}
    deadline = time.monotonic() + timeout_s
    while True:
        if time.monotonic() > deadline:
            return None
        line = stream.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        if b":" in line:
            key, _, value = line.decode("utf-8", "replace").partition(":")
            headers[key.strip().lower()] = value.strip()
    length = headers.get("content-length")
    if length is None:
        return None
    body = stream.read(int(length))
    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def measure_server(server: dict[str, str], repo_path: Path, requests: int) -> dict:
    """Launch one server over stdio and measure it.  Never raises."""
    binary = server["binary"]
    args = [binary] + ([server["args"]] if server["args"] else [])
    started = time.monotonic()
    try:
        process = subprocess.Popen(  # noqa: S603 - the binary comes from the table
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=str(repo_path),
        )
    except OSError as error:
        return {
            "status": "error",
            "error": f"could not launch {binary}: {error}",
        }

    def finish(result: dict) -> dict:
        try:
            process.terminate()
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
        return result

    try:
        initialize = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": os.getpid(),
                "rootUri": repo_path.as_uri(),
                "capabilities": {},
            },
        }
        process.stdin.write(frame(initialize))
        process.stdin.flush()
        response = read_message(process.stdout, INITIALIZE_TIMEOUT_S)
        if response is None:
            return finish({"status": "error", "error": "no initialize response"})
        cold_start_ms = round((time.monotonic() - started) * 1000, 2)

        request_started = time.monotonic()
        process.stdin.write(
            frame(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "textDocument/definition",
                    "params": {
                        "textDocument": {"uri": (repo_path / "README.md").as_uri()},
                        "position": {"line": 0, "character": 0},
                    },
                }
            )
        )
        process.stdin.flush()
        definition = read_message(process.stdout, REQUEST_TIMEOUT_S)
        request_ms = round((time.monotonic() - request_started) * 1000, 2)
        if definition is None:
            return finish(
                {
                    "status": "error",
                    "error": "no definition response",
                    "cold_start_ms": cold_start_ms,
                }
            )

        errors = 0
        answered = 0
        for index in range(requests):
            process.stdin.write(
                frame(
                    {
                        "jsonrpc": "2.0",
                        "id": 100 + index,
                        "method": "textDocument/definition",
                        "params": {
                            "textDocument": {"uri": (repo_path / "README.md").as_uri()},
                            "position": {"line": 0, "character": 0},
                        },
                    }
                )
            )
            process.stdin.flush()
            reply = read_message(process.stdout, REQUEST_TIMEOUT_S)
            if reply is None:
                errors += 1
                continue
            answered += 1
            if "error" in reply:
                errors += 1
        # the recovery probe: does the server still answer after the burst?
        process.stdin.write(
            frame(
                {
                    "jsonrpc": "2.0",
                    "id": 9999,
                    "method": "textDocument/definition",
                    "params": {
                        "textDocument": {"uri": (repo_path / "README.md").as_uri()},
                        "position": {"line": 0, "character": 0},
                    },
                }
            )
        )
        process.stdin.flush()
        recovered = read_message(process.stdout, REQUEST_TIMEOUT_S) is not None
        return finish(
            {
                "status": "measured",
                "cold_start_ms": cold_start_ms,
                "request_ms": request_ms,
                "requests": requests,
                "answered": answered,
                "errors": errors,
                "error_rate": round(errors / requests, 4) if requests else 0.0,
                "recovered": recovered,
            }
        )
    except (OSError, ValueError) as error:
        return finish({"status": "error", "error": str(error)})


def run(
    taxonomy_path: Path = DEFAULT_TAXONOMY,
    repo_path: Path = REPO_ROOT,
    requests: int = DEFAULT_REQUESTS,
) -> dict:
    """Build the spike report.  Never raises."""
    gate_open, gate_reason = gate_state(taxonomy_path)
    languages: list[dict] = []
    for server in SERVERS:
        entry: dict = {
            "language": server["language"],
            "server": server["server"],
            "license": server["license"],
        }
        if not gate_open:
            entry.update(
                {
                    "status": "skipped-gate",
                    "note": gate_reason,
                    "cold_start_ms": None,
                    "request_ms": None,
                    "error_rate": None,
                    "recovered": None,
                }
            )
            languages.append(entry)
            continue
        binary = shutil.which(server["binary"])
        if binary is None:
            entry.update(
                {
                    "status": "unavailable",
                    "note": f"'{server['binary']}' is not on PATH",
                    "cold_start_ms": None,
                    "request_ms": None,
                    "error_rate": None,
                    "recovered": None,
                }
            )
            languages.append(entry)
            continue
        entry.update(measure_server(server, repo_path, requests))
        languages.append(entry)
    return {
        "version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gate": {"open": gate_open, "reason": gate_reason},
        "requests": requests,
        "languages": languages,
    }


def main(argv: list[str]) -> int:
    out = DEFAULT_OUT
    taxonomy = DEFAULT_TAXONOMY
    requests = DEFAULT_REQUESTS
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--out" and index + 1 < len(argv):
            out = Path(argv[index + 1])
            index += 2
            continue
        if argument == "--taxonomy" and index + 1 < len(argv):
            taxonomy = Path(argv[index + 1])
            index += 2
            continue
        if argument == "--requests" and index + 1 < len(argv):
            requests = int(argv[index + 1])
            index += 2
            continue
        index += 1
    try:
        report = run(taxonomy_path=taxonomy, requests=requests)
    except (OSError, ValueError) as error:
        print(f"lsp-spike: cannot build the report: {error}")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"lsp-spike: wrote {out}")
    for language in report["languages"]:
        print(f"  {language['language']}: {language['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
