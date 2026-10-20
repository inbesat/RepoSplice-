# Stitch eval corpus

Twenty repository pairs - five per ecosystem (JavaScript/TypeScript, Python, Go, Rust) - form
the benchmark for the agent work. Every pair pins two real public repositories to an immutable
commit SHA and documents the outcome the merge is expected to produce.

The pair schema lives in `packages/core/src/eval/schema.ts` (P-320) and the JSON Schema
generated from it is `schema.json` in this folder. The manifest is `pairs.json`.

## The pairs

| Pair | Ecosystem | Repo A | Repo B | Licenses | Expected outcome |
| --- | --- | --- | --- | --- | --- |
| `js-axios-ky` | js | axios/axios @ `v1.7.7` | sindresorhus/ky @ `v1.7.2` | MIT / MIT | clean |
| `js-express-fastify` | js | expressjs/express @ `4.21.0` | fastify/fastify @ `v4.26.2` | MIT / MIT | semantic_drift |
| `js-react-preact` | js | facebook/react @ `v18.3.1` | preactjs/preact @ `10.22.0` | MIT / MIT | semantic_drift |
| `js-vue-svelte` | js | vuejs/core @ `v3.4.31` | sveltejs/svelte @ `svelte@4.2.19` | MIT / MIT | semantic_drift |
| `js-axios-versions` | js | axios/axios @ `v1.7.7` | axios/axios @ `v1.6.8` | MIT / MIT | conflicts |
| `py-requests-httpx` | python | psf/requests @ `v2.32.3` | encode/httpx @ `0.27.0` | Apache-2.0 / BSD-3-Clause | clean |
| `py-flask-django` | python | pallets/flask @ `3.0.3` | django/django @ `5.0.6` | BSD-3-Clause / BSD-3-Clause | semantic_drift |
| `py-fastapi-sanic` | python | fastapi/fastapi @ `0.110.1` | sanic-org/sanic @ `v23.6.0` | MIT / MIT | clean |
| `py-numpy-scipy` | python | numpy/numpy @ `v1.26.4` | scipy/scipy @ `v1.13.1` | BSD-3-Clause / BSD-3-Clause | clean |
| `py-requests-versions` | python | psf/requests @ `v2.32.3` | psf/requests @ `v2.31.0` | Apache-2.0 / Apache-2.0 | conflicts |
| `go-gin-chi` | go | gin-gonic/gin @ `v1.10.0` | go-chi/chi @ `v5.0.12` | MIT / MIT | clean |
| `go-cobra-cli` | go | spf13/cobra @ `v1.8.1` | urfave/cli @ `v3.14.0` | Apache-2.0 / MIT | semantic_drift |
| `go-testify-mock` | go | stretchr/testify @ `v1.9.0` | uber-go/mock @ `v0.4.0` | MIT / Apache-2.0 | clean |
| `go-mux-echo` | go | gorilla/mux @ `v1.8.1` | labstack/echo @ `v5.4.0` | BSD-3-Clause / MIT | semantic_drift |
| `go-k8s-etcd` | go | kubernetes/client-go @ `v0.29.3` | etcd-io/etcd @ `v3.5.13` | Apache-2.0 / Apache-2.0 | clean |
| `rs-tokio-hyper` | rust | tokio-rs/tokio @ `tokio-1.38.0` | hyperium/hyper @ `v1.4.1` | MIT / MIT | clean |
| `rs-serde-clap` | rust | serde-rs/serde @ `v1.0.203` | clap-rs/clap @ `v4.5.7` | MIT / MIT | clean |
| `rs-axum-actix` | rust | tokio-rs/axum @ `axum-v0.7.5` | actix/actix-web @ `web-v4.9.0` | MIT / MIT | semantic_drift |
| `rs-rust-cargo` | rust | rust-lang/rust @ `1.79.0` | rust-lang/cargo @ `0.81.0` | MIT / MIT | clean |
| `rs-ripgrep-fd` | rust | BurntSushi/ripgrep @ `14.1.0` | sharkdp/fd @ `v9.0.0` | MIT / MIT | clean |

## License policy

Only the permissive set from `packages/core/src/license/categories.ts` is allowed:
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0,
WTFPL, Zlib. Every pair in this corpus uses two permissive licenses, so no pair is blocked by
the license policy. The license of each side was read from that repository's license file and
the source is recorded per pair (`license_a_source` / `license_b_source`).

## Expected outcome taxonomy

- `clean` - disjoint file sets; the merge applies without conflicts.
- `conflicts` - the same paths exist on both sides; the merge is expected to conflict.
- `semantic_drift` - the merge applies, but the behaviour differs; the result needs review.
- `license_block` - a permissive-license conflict is expected; reserved for later expansions.

## Validating the corpus

```bash
# the committed JSON Schema matches the zod schema
bun run eval:schema:check

# every pair validates (stdlib only, no pip install needed)
python eval/scripts/validate_corpus.py

# the corpus invariants (20 pairs, 5 per ecosystem, pinned SHAs, permissive licenses)
python -m pytest eval/test_corpus.py -q
```

`eval/corpus/pair-example/` holds the hand-written example pair that documents every field.

## Provenance

The SHAs are the real immutable tag commits of the recorded tags, resolved with
`git ls-remote --tags --refs`. The licenses were read from each repository's license file.
P-322 adds the SHA verification script; P-321 sourced these twenty pairs.
## SHA verification and re-pinning (P-322)

Every pin in `pairs.json` is verified against its upstream before an evaluation
run, so a re-run consumes the same inputs even when the upstream moved on.

```bash
python eval/scripts/verify_shas.py
```

Exit codes: `0` every pin resolves, `1` drift (a pin no longer resolves),
`2` a check could not be run (network down, GitHub rate limit). A rate limit
is never reported as drift.

```bash
python eval/scripts/verify_shas.py --mode api
```

uses the unauthenticated GitHub commits API instead of `git ls-remote` (60
requests per hour, so it suits a spot check rather than the full corpus).

The corpus invariants are covered by the test suite:

```bash
python -m pytest eval/test_shas.py -q
```

### Re-pinning procedure (when an upstream advances)

1. `python eval/scripts/verify_shas.py` - it prints the pair, the side, the
   repo and the pinned sha for every pin that no longer resolves.
2. Resolve the new commit of the recorded tag (the tag name is kept per side
   in `repo_a_tag` / `repo_b_tag`):
   `git ls-remote --tags --refs https://github.com/<owner>/<repo>`
3. Update `repo_a_sha` / `repo_b_sha` in `eval/corpus/pairs.json` with the new
   40-hex commit, and adjust the `note` of that pair.
4. Re-read the license if the upstream changed it (the license source is
   recorded per side) and keep the license inside the permissive set.
5. Re-run `python eval/scripts/verify_shas.py` (must exit 0) and
   `python eval/scripts/validate_corpus.py` (must exit 0), then commit the
   manifest together with the note.