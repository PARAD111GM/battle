#!/usr/bin/env bash
set -euo pipefail
cd /workspace/battle
npm ci --cache /workspace/.cache/npm --no-audit --no-fund
npm run build
npm test
node scripts/standalone.mjs
