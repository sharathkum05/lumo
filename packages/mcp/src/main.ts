#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, loadConfig } from "@lumo/client";
import { createMcpServer } from "./server.ts";

// stdout carries the MCP protocol, so diagnostics go to stderr.
try {
  const profile = process.argv.find((a) => a.startsWith("--profile="))?.slice("--profile=".length);
  const server = createMcpServer(createClient(loadConfig({ profile })));
  await server.connect(new StdioServerTransport());
} catch (err) {
  console.error(`lumo-mcp: ${(err as Error).message}`);
  process.exit(1);
}
