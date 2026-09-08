# System Dependency: Docker

**Requirement:** a reachable Docker daemon for the sandbox backend
(P-168). There is no minimum-engine-version constant (nothing in the plan
names one — inventing a floor would reject valid setups); presence plus
the reported engine version is the contract
(`checkDockerDaemon` in `packages/core/src/sandbox/dockerProbe.ts`).
`stitch doctor` (P-068) checks it automatically.

## Why Docker

The sandbox builds and runs ephemeral per-ecosystem images to compile and
test merged repos in isolation (P-168/P-180). Without a daemon those runs
cannot start locally — stitch falls back to GH Actions (P-178), which is
slower and needs a configured runner.

## Install

- **Windows / macOS:** Docker Desktop (<https://www.docker.com/products/docker-desktop>).
  Start it after installing — the daemon is a separate step from the
  binaries, and a stopped Desktop is the most common "Docker missing"
  report.
- **Linux:** the Engine from your distro (`sudo apt install docker.io`
  / `sudo dnf install docker`) or Docker's official repos; then
  `sudo systemctl enable --now docker`. Add your user to the `docker`
  group if you hit permission errors (log out and back in afterwards).

After installing, reopen the terminal and verify below. On a machine
without Docker at all, even the binary is absent:

```console
$ docker --version
docker: command not found
```

## Verify

```console
$ docker --version
Docker version 26.1.4, build 5650f9b

$ docker info --format '{{.ServerVersion}}|{{.OSType}}'
26.1.4|linux
```

(Example output shapes — the field names follow upstream Docker
conventions; your versions will differ.)

Two separate facts matter: the **binary** exists (`--version`) and the
**daemon** answers (`docker info`). A present binary with a stopped daemon
fails the second — that is the normal "start Docker Desktop" case, and it
is data (fallback path), not an error.

## Daemon down / CI fallback

- Daemon unreachable (refused socket, missing npipe, stopped Desktop):
  start the daemon and retry. `checkDockerDaemon` maps common failure
  text to hints (not-installed vs permission vs start-the-daemon).
- Permission denied on the socket: Linux group membership (above).
- No Docker at all (minimal CI runners): stitch uses the GH Actions
  fallback (P-178). Dev/prod parity comes from the base image (P-008)
  built on Docker CI (P-264) matching what the sandbox pulls (P-169).

## See also

- `git-version.md`, `git-filter-repo.md` (same directory): the other
  system binaries and their floors.
- `TECH_STACK.md` (plan docs): Docker row (Engine >= 24, sandbox).
- `SECURITY.md` (plan docs), section 4: sandbox hardening and limits.
- `stitch doctor` (P-068): automated daemon + version probes.
