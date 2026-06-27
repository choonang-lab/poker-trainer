// Minimal Node globals so `tsc --noEmit` type-checks without @types/node
// (keeps the project dependency-free). Node provides these at runtime; the
// declarations exist only for the type-checker.
declare const console: { log(...args: unknown[]): void };
declare const process: {
  exit(code?: number): never;
  argv: string[];
  stdin: unknown;
  stdout: unknown;
  env: Record<string, string | undefined>;
};
declare const Date: { now(): number };

// Minimal node:fs surface used by cli.ts (the IO boundary).
declare module "node:fs" {
  function existsSync(path: string): boolean;
  function readFileSync(path: string, encoding: "utf8"): string;
  function writeFileSync(path: string, data: string): void;
}

// Minimal node:readline surface used by cli.ts (the IO boundary).
declare module "node:readline" {
  interface Interface {
    close(): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<string>;
  }
  function createInterface(options: { input: unknown; output?: unknown }): Interface;
}
