#!/usr/bin/env bash
# Builds the three contracts to wasm with cargo-near (needed by the sandbox tests).
set -e
rustup target add wasm32-unknown-unknown
command -v cargo-near >/dev/null || cargo install cargo-near
for c in escrow payroll split; do
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
done
echo "wasm files built under ./target"
