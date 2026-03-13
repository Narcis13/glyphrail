#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAYGROUND="$ROOT/playground/mvp"
CLI=(bun run "$ROOT/src/cli/index.ts" --cwd "$PLAYGROUND")

print_section() {
  printf "\n== %s ==\n" "$1"
}

print_command() {
  printf "$"
  printf " %q" "$@"
  printf "\n"
}

run_cmd() {
  print_command "$@"
  "$@"
}

expect_exit() {
  local expected="$1"
  shift

  print_command "$@"
  set +e
  "$@"
  local actual=$?
  set -e

  if [[ "$actual" -ne "$expected" ]]; then
    printf "Expected exit %s but got %s\n" "$expected" "$actual" >&2
    exit 1
  fi

  printf "Exit code %s as expected\n" "$actual"
}

latest_paused_run_id() {
  "${CLI[@]}" runs list --json | bun -e 'const text = await new Response(Bun.stdin).text(); const payload = JSON.parse(text); const paused = [...payload.runs].reverse().find((run) => run.status === "paused"); if (!paused) { process.exit(1); } console.log(paused.runId);'
}

reset_playground() {
  rm -rf "$PLAYGROUND/.glyphrail"
  mkdir -p "$PLAYGROUND/.glyphrail/runs"
}

reset_playground

print_section "CLI surface"
run_cmd "${CLI[@]}" capabilities --json
run_cmd "${CLI[@]}" check --json
run_cmd "${CLI[@]}" tool list --json
run_cmd "${CLI[@]}" tool show makeGreeting --json
run_cmd "${CLI[@]}" tool call makeGreeting --input-json '{"name":"Ada"}' --json
run_cmd "${CLI[@]}" workflow validate workflows/linear.gr.yaml --json
run_cmd "${CLI[@]}" workflow explain workflows/conditional.gr.yaml --json
run_cmd "${CLI[@]}" workflow lint diagnostics/lint.gr.yaml --json
expect_exit 3 "${CLI[@]}" workflow validate diagnostics/invalid.gr.yaml --json

print_section "Happy path runs"
run_cmd "${CLI[@]}" run workflows/linear.gr.yaml --input inputs/linear.ada.json --json
run_cmd "${CLI[@]}" run workflows/conditional.gr.yaml --json
run_cmd "${CLI[@]}" run workflows/foreach.gr.yaml --json
run_cmd "${CLI[@]}" run workflows/while-success.gr.yaml --json
run_cmd "${CLI[@]}" run workflows/tool-retry.gr.yaml --json
run_cmd "${CLI[@]}" run workflows/agent-success.gr.yaml --json

print_section "Expected runtime failures"
expect_exit 5 "${CLI[@]}" run workflows/while-max-iterations.gr.yaml --json
expect_exit 5 "${CLI[@]}" run workflows/agent-validation-failure.gr.yaml --json

print_section "Pause and resume"
expect_exit 86 "${CLI[@]}" run workflows/resume-loop.gr.yaml --json
paused_run_id="$(latest_paused_run_id)"
printf "Paused run: %s\n" "$paused_run_id"
run_cmd "${CLI[@]}" runs show "$paused_run_id" --json
run_cmd "${CLI[@]}" resume "$paused_run_id" --json
