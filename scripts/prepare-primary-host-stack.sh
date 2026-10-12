#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STACK_DIR="$REPO_ROOT/deploy/primary-host"
SITE_DIR="$STACK_DIR/volumes/site"
STAGED_SITE_DIR="$STACK_DIR/volumes/site.staged"
TARGET_IDL_DIR="$STACK_DIR/target/idl"
IDL_SOURCE="$REPO_ROOT/target/idl/private_dao.json"

if [[ ! -f "$IDL_SOURCE" ]]; then
  echo "Missing $IDL_SOURCE. Run an Anchor build first so the read-node can decode accounts." >&2
  exit 1
fi

if [[ "${PRIVATE_DAO_SKIP_SOURCE_PREFLIGHT:-0}" != "1" ]]; then
  bash "$SCRIPT_DIR/verify-source-worktree.sh"
fi

mkdir -p "$STACK_DIR/volumes" "$TARGET_IDL_DIR"

if [[ ! -f "$STACK_DIR/.env" ]]; then
  cp "$STACK_DIR/.env.example" "$STACK_DIR/.env"
fi

(cd "$REPO_ROOT" && npm run web:bundle:root)

# Keep the bind-mount directory itself stable. Replacing SITE_DIR with a new
# inode while the edge container is running leaves Caddy serving the old
# directory. Stage and validate the bundle, then sync its contents in place.
rm -rf "$STAGED_SITE_DIR"
mkdir -p "$SITE_DIR" "$STAGED_SITE_DIR"
cp -R "$REPO_ROOT/dist/web-mirror-root/." "$STAGED_SITE_DIR/"
test -s "$STAGED_SITE_DIR/index.html"
find "$SITE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R "$STAGED_SITE_DIR/." "$SITE_DIR/"
rm -rf "$STAGED_SITE_DIR"
cp "$IDL_SOURCE" "$TARGET_IDL_DIR/private_dao.json"

echo "Prepared primary-host stack inputs:"
echo "  Site bundle: $SITE_DIR"
echo "  IDL:         $TARGET_IDL_DIR/private_dao.json"
echo "  Env file:    $STACK_DIR/.env"
