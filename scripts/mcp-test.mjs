import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Throwaway HOME so we don't clobber the real workspace — always isolated, even if HOME is set
const testHome = join(process.cwd(), ".testhome-mcp");
const configDir = join(testHome, ".persona");
const workspace = join(testHome, "persona-mcp-workspace");

if (!existsSync(workspace)) {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(workspace, "Notes"), { recursive: true });
  mkdirSync(join(workspace, "Projects"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ workspace, theme: "light" }, null, 2));
  writeFileSync(join(workspace, "Notes", "Welcome.md"), "# Welcome\nTest workspace for MCP\n");
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function expectToolError(name, fn) {
  try {
    const res = await fn();
    const isError = res.isError || (res.content && res.content[0]?.text?.startsWith("Error:"));
    check(name, isError, `expected error but got: ${JSON.stringify(res).slice(0, 200)}`);
  } catch (err) {
    check(name, true);
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [join(process.cwd(), "dist/mcp/stdio.js")],
  env: { ...process.env, HOME: testHome },
});

const client = new Client({ name: "mcp-test", version: "1.0.0" }, { capabilities: {} });

await client.connect(transport);
console.log("== MCP connect ==");
check("server version persona", client.getServerVersion()?.name === "persona");

const tools = await client.listTools();
console.log("== listTools ==");
check("15 tools registered", tools.tools.length === 15, `got ${tools.tools.length}`);
check("has get_workspace_info", tools.tools.some((t) => t.name === "get_workspace_info"));
check("has search", tools.tools.some((t) => t.name === "search"));

const resources = await client.listResources();
console.log("== listResources ==");
check("has workspace resource", resources.resources.some((r) => r.uri === "persona://workspace"));

const prompts = await client.listPrompts();
console.log("== listPrompts ==");
check("has triage-tasks prompt", prompts.prompts.some((p) => p.name === "triage-tasks"));

// get_workspace_info
console.log("== get_workspace_info ==");
let res = await client.callTool({ name: "get_workspace_info", arguments: {} });
check("workspace info returns path", res.content[0].text.includes(workspace));

// list_folder
console.log("== list_folder ==");
res = await client.callTool({ name: "list_folder", arguments: { path: "" } });
check("list_folder shows Notes", res.content[0].text.includes("Notes"));

// create_note + read_note
console.log("== create_note / read_note ==");
res = await client.callTool({ name: "create_note", arguments: { path: "Notes/mcp-test.md", content: "# MCP Test\nHello from MCP" } });
check("create_note ok", res.content[0].text.includes("Created"));
res = await client.callTool({ name: "read_note", arguments: { path: "Notes/mcp-test.md" } });
check("read_note returns content", res.content[0].text.includes("Hello from MCP"));
await expectToolError("create_note refuses existing", () =>
  client.callTool({ name: "create_note", arguments: { path: "Notes/mcp-test.md", content: "x" } }),
);

// write_note
console.log("== write_note ==");
res = await client.callTool({ name: "write_note", arguments: { path: "Notes/mcp-test.md", content: "# Rewritten\n" } });
check("write_note ok", res.content[0].text.includes("Wrote"));
res = await client.callTool({ name: "read_note", arguments: { path: "Notes/mcp-test.md" } });
check("write overwrote", res.content[0].text.includes("Rewritten"));

// append_note
console.log("== append_note ==");
res = await client.callTool({ name: "append_note", arguments: { path: "Notes/mcp-test.md", content: "appended\n" } });
check("append ok", res.content[0].text.includes("Appended"));
res = await client.callTool({ name: "read_note", arguments: { path: "Notes/mcp-test.md" } });
check("append applied", res.content[0].text.includes("appended"));

// create_folder
console.log("== create_folder ==");
res = await client.callTool({ name: "create_folder", arguments: { path: "Notes/McpFolder" } });
check("create_folder ok", res.content[0].text.includes("Created folder"));
await expectToolError("create_folder refuses existing", () =>
  client.callTool({ name: "create_folder", arguments: { path: "Notes/McpFolder" } }),
);

// move_file / rename_file
console.log("== move_file / rename_file ==");
res = await client.callTool({ name: "move_file", arguments: { path: "Notes/mcp-test.md", target: "Notes/McpFolder" } });
check("move_file ok", res.content[0].text.includes("Moved"));
res = await client.callTool({ name: "rename_file", arguments: { path: "Notes/McpFolder/mcp-test.md", name: "renamed.md" } });
check("rename_file ok", res.content[0].text.includes("Renamed"));

// search
console.log("== search ==");
res = await client.callTool({ name: "search", arguments: { query: "Rewritten" } });
check("search finds file", res.content[0].text.includes("renamed.md") || res.content[0].text.includes("McpFolder"));

// resources
console.log("== readResource ==");
let r = await client.readResource({ uri: "persona://workspace" });
check("read persona://workspace", r.contents[0].text.includes("Notes"));
r = await client.readResource({ uri: "persona://file/Notes/Welcome.md" });
check("read persona://file/Notes/Welcome.md", r.contents[0].text.includes("Welcome"));

// tasks
console.log("== create_task / list_tasks / update_task / delete_task ==");
res = await client.callTool({ name: "create_task", arguments: { title: "MCP test task", due: "tomorrow", priority: "high", project: "TestMcp" } });
check("create_task ok", res.content[0].text.includes("MCP test task"));
res = await client.callTool({ name: "list_tasks", arguments: {} });
check("list_tasks shows task", res.content[0].text.includes("MCP test task"));
const match = res.content[0].text.match(/\(id: ([^)]+)\)/);
const taskId = match ? match[1] : null;
check("task id parsed", Boolean(taskId));
if (taskId) {
  res = await client.callTool({ name: "update_task", arguments: { id: taskId, status: "done" } });
  check("update_task done", res.content[0].text.includes("[x]"));
  res = await client.callTool({ name: "delete_task", arguments: { id: taskId } });
  check("delete_task ok", res.content[0].text.includes("Deleted"));
}
await expectToolError("update_task unknown id", () =>
  client.callTool({ name: "update_task", arguments: { id: "nope-nope" } }),
);

// delete_file + safety guards
console.log("== delete_file / safety ==");
res = await client.callTool({ name: "delete_file", arguments: { path: "Notes/McpFolder/renamed.md" } });
check("delete_file ok", res.content[0].text.includes("Deleted"));
await expectToolError("delete .persona refused", () =>
  client.callTool({ name: "delete_file", arguments: { path: ".persona" } }),
);
await expectToolError("path escape refused", () =>
  client.callTool({ name: "read_note", arguments: { path: "../etc/passwd" } }),
);
// cleanup folder
await client.callTool({ name: "delete_file", arguments: { path: "Notes/McpFolder" } });

await client.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("Failures:", failures.join(", "));
  process.exit(1);
}
