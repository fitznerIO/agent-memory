#!/usr/bin/env bash
set -euo pipefail

# Removes deleted fixture files containing personal/client data from git history.
# Run this ONCE on main before making the repo public.
#
# Prerequisites:
#   brew install git-filter-repo   (or: pip install git-filter-repo)
#
# Usage:
#   1. Merge all open branches to main
#   2. Run: bash scripts/clean-history.sh
#   3. Verify: git log --all -p -- "fixtures/" (should return nothing)
#   4. Force push: git push origin main --force
#
# WARNING: This rewrites ALL commit hashes. All existing clones/forks will
# need to re-clone. Only run this before the first public release.

if ! command -v git-filter-repo &> /dev/null; then
  echo "ERROR: git-filter-repo is not installed."
  echo "Install it with: brew install git-filter-repo"
  exit 1
fi

echo "Removing fixture files with personal/client data from git history..."
echo ""

git filter-repo \
  --invert-paths \
  --path fixtures/core/identity.md \
  --path fixtures/core/user.md \
  --path fixtures/semantic/entities/clients.md \
  --path fixtures/episodic/sessions/2026-02-05.md \
  --path fixtures/procedural/workflows.md \
  --force

echo ""
echo "Done. Verify with: git log --all -p -- 'fixtures/'"
echo "Then force push:   git push origin main --force"
