# Base stage with all toolchains
FROM oven/bun:1.1 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip docker.io curl \
    && pip3 install --no-cache-dir git-filter-repo \
    && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup default stable && rustup component add rustfmt clippy

# Go
RUN curl -fsSL https://go.dev/dl/go1.22.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

# Python deps
RUN pip3 install --no-cache-dir uv poetry

WORKDIR /workspace
