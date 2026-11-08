#!/usr/bin/env bash
# Copies the freshly built contracts into server/wasm so the server can deploy them.
# Run ./build-wasm.sh first. Then commit server/wasm/*.wasm and SHA256SUMS.
set -e
cd "$(dirname "$0")/.."
mkdir -p server/wasm
for c in escrow payroll split; do
  f=$(find target -name "pactsmith_$c.wasm" -not -path "*/deps/*" -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
  [ -n "$f" ] || { echo "No wasm found for $c. Run ./build-wasm.sh first."; exit 1; }
  cp "$f" "server/wasm/$c.wasm"
done
# contract sources for the "Download your build" package
for c in escrow payroll split; do
  mkdir -p "server/templates/$c/src" "server/templates/$c/tests"
  cp "contracts/$c/Cargo.toml" "server/templates/$c/Cargo.toml"
  cp "contracts/$c/src/lib.rs" "server/templates/$c/src/lib.rs"
  cp "contracts/$c/tests/sandbox.rs" "server/templates/$c/tests/sandbox.rs"
done
cp contracts/common/sandbox_common.rs server/templates/sandbox_common.rs
(cd server/wasm && sha256sum *.wasm | tee SHA256SUMS)
echo "Done. Now: git add server/wasm && git commit -m 'Add contract wasm' && git push"
