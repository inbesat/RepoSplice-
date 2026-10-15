# P-169 — per-ecosystem sandbox image (Go).
#
# Extends the P-008 base idea for the `go` ecosystem. `buildLocal` builds this
# instead of pulling `golang:1.23-alpine`. The pinned P-155 commands are
# `go build ./...` / `go test ./...`.
FROM golang:1.23-alpine

RUN apk add --no-cache git ca-certificates

WORKDIR /workspace
