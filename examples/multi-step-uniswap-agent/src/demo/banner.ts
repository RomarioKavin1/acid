// Lightweight ANSI helpers so demo scripts stay dependency-free.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_RED = "\x1b[31m";
const FG_CYAN = "\x1b[36m";
const FG_MAGENTA = "\x1b[35m";
const FG_GRAY = "\x1b[90m";

export function banner(letter: "A" | "C" | "I" | "D", title: string): void {
  const colorMap = {
    A: FG_CYAN,
    C: FG_YELLOW,
    I: FG_MAGENTA,
    D: FG_GREEN,
  } as const;
  const color = colorMap[letter];
  const bar = "═".repeat(72);
  print("");
  print(`${color}${BOLD}${bar}${RESET}`);
  print(`${color}${BOLD}  [${letter}]   ${title}${RESET}`);
  print(`${color}${BOLD}${bar}${RESET}`);
  print("");
}

export function step(idx: number, msg: string): void {
  print(`  ${DIM}${idx}.${RESET} ${msg}`);
}

export function ok(msg: string): void {
  print(`  ${FG_GREEN}✓${RESET} ${msg}`);
}

export function warn(msg: string): void {
  print(`  ${FG_YELLOW}⚠${RESET} ${msg}`);
}

export function fail(msg: string): void {
  print(`  ${FG_RED}✗${RESET} ${msg}`);
}

export function info(msg: string): void {
  print(`  ${FG_GRAY}ℹ${RESET} ${msg}`);
}

export function comp(msg: string): void {
  print(`  ${FG_MAGENTA}↩${RESET} ${msg}`);
}

export function divider(): void {
  print(`  ${DIM}${"─".repeat(68)}${RESET}`);
}

export function summary(label: string, value: string): void {
  print(`  ${BOLD}${label}:${RESET} ${value}`);
}

export function pause(seconds: number): Promise<void> {
  if (seconds <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, seconds * 1000));
}

function print(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s);
}
