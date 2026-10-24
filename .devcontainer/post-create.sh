#!/bin/sh
set -e
cd /home/bun/workspace
bun install

# Claude Code add-ons, written into the claude-home volume. All steps are idempotent, and
# run here (not the Dockerfile) because npm/Node 22 come from the devcontainer node feature.
# Caveman: CLI + signed linux binaries, then native Claude integration (routes API calls
# through its local proxy, which its SessionStart hook launches). Undo: caveman disable claude
npm install -g @caveman-ai/cli@2.1.0
caveman setup --install </dev/null
caveman setup --agent-native claude </dev/null
# Ponytail plugin (user scope)
claude plugin marketplace add DietrichGebert/ponytail </dev/null
claude plugin install ponytail@ponytail </dev/null
