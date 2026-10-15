#!/usr/bin/env bash
set -euo pipefail
cd /workspace/battle
if curl --fail --silent http://127.0.0.1:5173/ | rg -qi '<title>Rivetfall'; then
  echo 'Rivetfall is already serving on port 5173.'
  exit 0
fi
nohup npm run dev -- --port 5173 --strictPort > /tmp/rivetfall-vite.log 2>&1 &
rivetfall_pid=$!
echo "$rivetfall_pid" > /tmp/rivetfall-vite.pid
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:5173/ | rg -qi '<title>Rivetfall'; then
    echo 'Rivetfall started on port 5173. Log: /tmp/rivetfall-vite.log'
    exit 0
  fi
  if ! kill -0 "$rivetfall_pid" 2>/dev/null; then
    cat /tmp/rivetfall-vite.log
    exit 1
  fi
  sleep 1
done
echo 'Rivetfall did not become ready; inspect /tmp/rivetfall-vite.log.' >&2
exit 1
