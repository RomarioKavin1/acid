#!/usr/bin/env bash
# OpenACID demo orchestrator. Runs the four ACID scenes back-to-back with
# pauses suitable for screen recording. Pass --fast to remove the pauses.
set -euo pipefail

cd "$(dirname "$0")/.."

# Quiet the pnpm warning about ${NPM_TOKEN} not being set during demo runs.
export NPM_TOKEN="${NPM_TOKEN:-}"

PAUSE=${PAUSE:-2}
if [[ "${1:-}" == "--fast" ]]; then
  PAUSE=0
fi

pause() {
  if [[ "$PAUSE" -gt 0 ]]; then
    echo
    sleep "$PAUSE"
  fi
}

run() {
  local file=$1
  pnpm --silent --filter @openacid/example-uniswap-agent exec tsx "src/demo/${file}.ts"
  pause
}

clear
echo
echo "  ╔══════════════════════════════════════════════════════════════════════╗"
echo "  ║                                                                      ║"
echo "  ║    OpenACID — durable execution primitives for AI agents             ║"
echo "  ║                                                                      ║"
echo "  ║    Postgres taught your backend ACID semantics.                      ║"
echo "  ║    OpenACID teaches your agents.                                     ║"
echo "  ║                                                                      ║"
echo "  ║    Four scenes follow: A · C · I · D                                 ║"
echo "  ║                                                                      ║"
echo "  ╚══════════════════════════════════════════════════════════════════════╝"
pause

run atomicity
run consistency
run isolation
run durability

echo
echo "  ╔══════════════════════════════════════════════════════════════════════╗"
echo "  ║   A.C.I.D. — for AI agents.                                          ║"
echo "  ║                                                                      ║"
echo "  ║   npm i @openacid/acid                                               ║"
echo "  ║   ReceiptRegistry on 0G:  0xd3E6277960025B4D0c161e20304a3a44231d0D1C ║"
echo "  ║   openacid.eth on Sepolia ENS                                        ║"
echo "  ╚══════════════════════════════════════════════════════════════════════╝"
echo
