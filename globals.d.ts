// Minimal Node globals so `tsc --noEmit` type-checks without @types/node
// (keeps the project dependency-free). Node provides these at runtime; the
// declarations exist only for the type-checker.
declare const console: { log(...args: unknown[]): void };
declare const process: { exit(code?: number): never; argv: string[] };
declare const Date: { now(): number };
