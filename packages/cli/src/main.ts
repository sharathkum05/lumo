#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { createClient, loadConfig } from "@lumo/client";
import { parse, run, UsageError } from "./cli.ts";

const io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) };

try {
  const parsed = parse(process.argv.slice(2));
  await run(parsed, () => createClient(loadConfig({ profile: parsed.values.profile })), io);
} catch (err) {
  io.err(`lumo: ${(err as Error).message}`);
  const usage = err instanceof UsageError || String((err as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS");
  process.exitCode = usage ? 2 : 1;
}
