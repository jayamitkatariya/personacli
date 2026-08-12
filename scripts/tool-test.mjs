import { executeTool } from "../dist/server/tools.js";
import { listTasks, getTask } from "../dist/server/tasks.js";
import { readFileContent, readTree, workspaceRoot } from "../dist/server/fs.js";
import { unlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

async function expectThrow(name, fn, pattern) {
  try {
    await fn();
    check(name, false, "(did not throw)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pattern) check(name, pattern.test(msg), `got: ${msg}`);
    else check(name, true);
  }
}

const exists = async (path) =>
  readFileContent(path).then(() => true).catch(() => false);

const tomorrow = () => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Clean the workspace first (keep .persona).
for (const entry of await readTree("")) {
  if (entry.name === ".persona") continue;
  if (entry.type === "folder") await rm(join(workspaceRoot(), entry.path), { recursive: true, force: true });
  else await unlink(join(workspaceRoot(), entry.path)).catch(() => {});
}

console.log("== list_folder ==");
const root = await executeTool("list_folder", { path: "" });
check("root tree returned", typeof root === "string" && root.length > 0);

console.log("== create_folder (existing check) ==");
await executeTool("create_folder", { path: "Notes/Deep/AiTest" });
await expectThrow("create_folder refuses existing", () => executeTool("create_folder", { path: "Notes/Deep/AiTest" }), /already exists/);

console.log("== create_note ==");
await executeTool("create_note", { path: "Notes/ai-test-1.md", content: "# Ai Test 1\n\nHello world.\n" });
check("note created", (await readFileContent("Notes/ai-test-1.md")).includes("Hello world"));
await expectThrow("create_note refuses existing", () =>
  executeTool("create_note", { path: "Notes/ai-test-1.md", content: "x" }),
  /already exists/);

console.log("== write_note ==");
await executeTool("write_note", { path: "Notes/ai-test-1.md", content: "# Rewritten\n" });
check("note overwritten", (await readFileContent("Notes/ai-test-1.md")).includes("Rewritten"));
await executeTool("write_note", { path: "Notes/ai-test-2.md", content: "# Created via write\n" });
check("write creates missing file", (await readFileContent("Notes/ai-test-2.md")).includes("Created via write"));
await executeTool("write_note", { path: "Notes/ai-test-1.md", content: "" });
check("write clears file", (await readFileContent("Notes/ai-test-1.md")) === "");

console.log("== append_note ==");
await executeTool("append_note", { path: "Notes/ai-test-2.md", content: "## Extra\nmore content\n" });
const appended = await readFileContent("Notes/ai-test-2.md");
check("append works", appended.includes("Extra") && appended.includes("more content"));

console.log("== read_note (binary guards) ==");
await writeFile(join(workspaceRoot(), "Notes/bin.dat"), Buffer.from([1, 2, 3, 0, 4, 5]), "binary");
const binRead = await executeTool("read_note", { path: "Notes/bin.dat" });
check("binary file notice", binRead.includes("binary file"));
const pdfRead = await executeTool("read_note", { path: "Notes/ai-test-1.md" });
check("empty file reads as empty", pdfRead === "");
const read = await executeTool("read_note", { path: "Notes/ai-test-2.md" });
check("read_note returns content", read.includes("Created via write"));
await expectThrow("read_note missing file", () => executeTool("read_note", { path: "Notes/nope.md" }), /not found/i);

console.log("== create_task (natural language due) ==");
const created = await executeTool("create_task", { title: "AI test task", due: "tomorrow", priority: "high", project: "test" });
check("task created", created.includes("AI test task") && created.includes("[high]"));
const tasks = await listTasks();
const task = tasks.find((t) => t.title === "AI test task");
check("task has id and due tomorrow", Boolean(task && task.id && task.due === tomorrow()));
check("task priority high", task && task.priority === "high");
check("task project test", task && task.project === "test");

await executeTool("create_task", { title: "Recurring sweep", recur: "2w" });
const recurring = (await listTasks()).find((t) => t.title === "Recurring sweep");
check("recur parsed", recurring && recurring.recur === "2w");

console.log("== list_tasks ==");
const listed = await executeTool("list_tasks", {});
check("list_tasks shows ids", listed.includes("(id: "));

console.log("== update_task ==");
const updated = await executeTool("update_task", { id: task.id, status: "done" });
check("task completed", updated.includes("[x]"));
const doneOnDisk = await getTask(task.id);
check("task done on disk", doneOnDisk && doneOnDisk.status === "done");
const reopened = await executeTool("update_task", { id: task.id, status: "todo", priority: "low" });
check("task reopened+priority", reopened.includes("[low]"));
const reopenedOnDisk = await getTask(task.id);
check("priority low on disk", reopenedOnDisk && reopenedOnDisk.priority === "low");
await expectThrow("update_task unknown id", () => executeTool("update_task", { id: "nope-nope" }), /not found/);

console.log("== delete_task ==");
const gone = await executeTool("delete_task", { id: task.id });
check("task deleted", gone.includes("AI test task"));
check("task gone on disk", (await getTask(task.id)) === null);
await expectThrow("delete_task unknown id", () => executeTool("delete_task", { id: "nope-nope" }), /not found/);

console.log("== rename_file ==");
const renamed = await executeTool("rename_file", { path: "Notes/ai-test-1.md", name: "ai-test-renamed.md" });
check("renamed", renamed.includes("ai-test-renamed.md"));
check("old path gone", !(await exists("Notes/ai-test-1.md")));
check("new path exists", (await exists("Notes/ai-test-renamed.md")));

console.log("== move_file ==");
const moved = await executeTool("move_file", { path: "Notes/ai-test-2.md", target: "Notes/Deep/AiTest" });
check("moved", moved.includes("Notes/Deep/AiTest/ai-test-2.md"));
check("file in new place", (await readFileContent("Notes/Deep/AiTest/ai-test-2.md")).includes("Extra"));
const toSelf = await executeTool("move_file", { path: "Notes/Deep/AiTest/ai-test-2.md", target: "Notes/Deep/AiTest" });
check("move to same folder is a no-op", toSelf.includes("Notes/Deep/AiTest/ai-test-2.md"));
await executeTool("create_note", { path: "Notes/Deep/AiTest/inner.md", content: "x\n" });
await expectThrow("move folder into itself", () => executeTool("move_file", { path: "Notes/Deep/AiTest", target: "Notes/Deep/AiTest" }));
await expectThrow("move to missing folder", () => executeTool("move_file", { path: "Notes/Deep/AiTest", target: "Notes/Nope" }), /not found/i);

console.log("== delete_file ==");
const del = await executeTool("delete_file", { path: "Notes/ai-test-renamed.md" });
check("file deleted", del.includes("ai-test-renamed.md"));
check("deleted on disk", !(await exists("Notes/ai-test-renamed.md")));
await expectThrow("delete missing file", () => executeTool("delete_file", { path: "Notes/ai-test-renamed.md" }), /nothing exists/);
const delFolder = await executeTool("delete_file", { path: "Notes/Deep/AiTest" });
const deep = await readTree("Notes/Deep");
check("folder deleted recursively", delFolder.includes("AiTest") && !deep.some((n) => n.name === "AiTest"));

console.log("== safety guards ==");
await expectThrow("refuse delete workspace root", () => executeTool("delete_file", { path: "" }), /required|workspace root/);
await expectThrow("refuse delete .persona", () => executeTool("delete_file", { path: ".persona" }), /refusing/);
await expectThrow("refuse delete task file in .persona", () => executeTool("delete_file", { path: ".persona/tasks/x.md" }), /refusing/);
await expectThrow("refuse move root", () => executeTool("move_file", { path: "", target: "Notes" }), /required|workspace root/);
await expectThrow("refuse rename .persona", () => executeTool("rename_file", { path: ".persona", name: "meta" }), /refusing|workspace root or .persona/);
await expectThrow("path escape via ../", () => executeTool("read_note", { path: "../etc/passwd" }), /escapes|not found/i);
await expectThrow("path escape in create", () => executeTool("create_note", { path: "../evil.md", content: "x" }), /escapes/i);
check("workspace root still intact", (await readTree("")).length > 0);

console.log("== delete_task (cleanup recurring) ==");
if (recurring && recurring.id) await executeTool("delete_task", { id: recurring.id });

console.log("== workspace survives ==");
const treeNow = await readTree("");
check("no ai-test files left", !treeNow.some((n) => n.name.includes("ai-test")));
const remaining = (await listTasks()).filter((t) => t.title.startsWith("AI test") || t.title.startsWith("Recurring"));
check("no test tasks left", remaining.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("Failures:", failures.join(", "));
  process.exit(1);
}
