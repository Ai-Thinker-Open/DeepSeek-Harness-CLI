#!/usr/bin/env bash
# Sync the WSL workspace into a Windows-side test mirror so the Windows
# `dsh-cli` runs the latest workspace code without publishing a release.
#
# Usage (from WSL, after editing source):
#   bash scripts/sync-windows-test.sh
#
# The Windows install is a junction to $DSH_WINDOWS_TEST_DIR
# (default: D:\Users\Seahi\dsh-cli-test). Run the same script after `bun run
# build` and then launch `dsh-cli` on Windows to test the current code.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DSH_WINDOWS_TEST_DIR:-/mnt/d/Users/Seahi/dsh-cli-test}"

bun run build
mkdir -p "$DEST"
rsync -a --delete --copy-links \
  --exclude '.git' \
  --exclude '.agents' \
  --exclude '.codex' \
  --exclude '.mimocode' \
  --exclude 'test' \
  --exclude 'scripts/build.ts' \
  --exclude 'scripts/icons.mjs' \
  --exclude 'scripts/mock-dsh-server.mjs' \
  --exclude 'scripts/sync-windows-test.sh' \
  --exclude 'bun.lock' \
  "$ROOT/" "$DEST/"

echo "workspace synced -> $DEST"
