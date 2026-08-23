#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPersonaMcpServer } from "./server.js";

async function main() {
  const server = createPersonaMcpServer();
  const transport = new StdioServerTransport();

  // MCP uses stdout for JSON-RPC; all logs must go to stderr.
  const log = (...args: unknown[]) => console.error("[persona-mcp]", ...args);

  transport.onerror = (err) => log("transport error:", err);
  // transport.onclose is set by McpServer; we just log server close.

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Optional: log workspace status on start (to stderr, not stdout)
  try {
    const { getWorkspace } = await import("../server/state.js");
    const ws = getWorkspace();
    if (ws) log(`workspace: ${ws}`);
    else log("workspace: not configured (run `persona` to pick a folder)");
  } catch {
    // ignore
  }

  await server.connect(transport);
  log("Persona MCP server running on stdio");
}

main().catch((err) => {
  console.error("[persona-mcp] fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
