#!/usr/bin/env python3
"""P-320 - validate the eval corpus against the emitted JSON Schema.

STDLIB ONLY on purpose: a fresh clone must be able to validate the corpus
without a pip install (jsonschema happens to be installed on the maintainer's
machine, but it is not assumed).

The subset of JSON Schema the corpus contract uses is supported: type,
required, properties, enum, pattern, minItems, minLength plus local
$ref/$defs resolution.

Usage:
    python eval/scripts/validate_corpus.py [schema.json] [manifest.json]

The manifest may hold a single pair object or a list of pairs. The exit code
is 0 when everything validates and 1 when anything does not.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCHEMA = REPO_ROOT / "eval" / "corpus" / "schema.json"
DEFAULT_MANIFEST = REPO_ROOT / "eval" / "corpus" / "pairs.json"

TYPE_MAP: dict[str, Any] = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "number": (int, float),
    "integer": int,
    "null": type(None),
}


def resolve_ref(schema: Any, root: Any) -> Any:
    """Follow a local `$ref` (e.g. `#/$defs/Name`) to its definition."""
    seen = 0
    while isinstance(schema, dict) and "$ref" in schema and seen < 10:
        ref = schema["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/"):
            return schema
        node = root
        for part in ref[2:].split("/"):
            if not isinstance(node, dict) or part not in node:
                return schema
            node = node[part]
        schema = node
        seen += 1
    return schema


def type_matches(expected: Any, instance: Any) -> bool:
    """A JSON Schema `type` may be a list (a nullable field is ["boolean","null"])."""
    if isinstance(expected, list):
        return any(type_matches(one, instance) for one in expected)
    python_type = TYPE_MAP.get(expected)
    if python_type is None:
        return True
    if expected in ("number", "integer") and isinstance(instance, bool):
        return False
    return isinstance(instance, python_type)


def validate_instance(schema: Any, instance: Any, root: Any, path: str = "$") -> list[str]:
    """Return one error string per violation; an empty list means valid."""
    errors: list[str] = []
    schema = resolve_ref(schema, root)
    if not isinstance(schema, dict):
        return errors

    expected = schema.get("type")
    if expected is not None and not type_matches(expected, instance):
        errors.append(
            f"{path}: expected type {expected}, got {type(instance).__name__}"
        )
        return errors

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} is not one of {schema['enum']}")

    if isinstance(instance, str):
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.search(pattern, instance) is None:
            errors.append(f"{path}: {instance!r} does not match {pattern}")
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(instance) < min_length:
            errors.append(f"{path}: shorter than minLength {min_length}")

    if isinstance(instance, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(instance) < min_items:
            errors.append(f"{path}: fewer than minItems {min_items}")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(instance):
                errors.extend(
                    validate_instance(item_schema, item, root, f"{path}[{index}]")
                )

    if isinstance(instance, dict):
        required = schema.get("required")
        if isinstance(required, list):
            for name in required:
                if name not in instance:
                    errors.append(f"{path}: missing required property {name!r}")
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for name, value in instance.items():
                if name in properties:
                    errors.extend(
                        validate_instance(properties[name], value, root, f"{path}.{name}")
                    )

    return errors


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_corpus(
    schema_path: Path = DEFAULT_SCHEMA, manifest_path: Path = DEFAULT_MANIFEST
) -> list[str]:
    """Validate every entry of the manifest against the schema."""
    schema = load_json(schema_path)
    data = load_json(manifest_path)
    pairs = data if isinstance(data, list) else [data]
    errors: list[str] = []
    for index, pair in enumerate(pairs):
        errors.extend(validate_instance(schema, pair, schema, f"$[{index}]"))
    return errors


def main(argv: list[str]) -> int:
    schema_path = Path(argv[0]) if len(argv) > 0 else DEFAULT_SCHEMA
    manifest_path = Path(argv[1]) if len(argv) > 1 else DEFAULT_MANIFEST
    try:
        errors = validate_corpus(schema_path, manifest_path)
    except (OSError, ValueError) as error:
        print(f"invalid: cannot read the corpus ({error})", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(f"invalid: {error}", file=sys.stderr)
        print(f"{len(errors)} validation error(s) in {manifest_path}", file=sys.stderr)
        return 1
    print(f"ok: {manifest_path} validates against {schema_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
