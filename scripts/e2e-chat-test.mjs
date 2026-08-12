import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = 4998;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
}

const files = [];
const tasks = [];

function handleEvent(ev) {
  if (ev.type === "tool" && ev.status === "done") {
    const detail = ev.detail ?? "";
    if (detail.startsWith("Created ")) files.push(detail);
    if (detail.startsWith("Wrote ")) files.push(detail);
    if (detail.startsWith("Renamed ")) files.push(detail);
    if (detail.startsWith("Moved ")) files.push(detail);
    if (detail.startsWith("Deleted ")) files.push(detail);
    if (detail.startsWith("Created task")) tasks.push(detail);
    if (detail.startsWith("Updated task")) tasks.push(detail);
    if (detail.startsWith("Deleted task")) tasks.push(detail);
  }
}

async function run() {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            "Work through my workspace and do ALL of the following in order:",
            "1. list_folder the root",
            "2. read the file 'seed.md'",
            "3. create_folder 'Magic/Sub'",
            "4. create_note 'Magic/one.md' with '# One\\n\\nFirst test note.'",
            "5. write_note 'Magic/two.md' with '# Two\\n\\nSecond test note.'",
            "6. append_note 'Magic/two.md' with '## Extra\\n\\nAppended line.'",
            "7. create_task title 'E2E alpha' due tomorrow priority high project test",
            "8. create_task title 'E2E beta'",
            "9. rename_file 'Magic/two.md' to 'two-renamed.md'",
            "10. update_task on the E2E beta task to done",
            "11. delete_task on the E2E alpha task",
            "12. create_task title 'E2E gamma', then move_file 'Magic/one.md' to the root, then rename it to 'one-moved.md'",
            "13. delete the 'Magic' folder and everything in it",
            "14. delete_file 'one-moved.md'",
            "15. delete_task on E2E gamma",
            "Finally confirm with a one-line summary of everything you did.",
          ].join("\n"),
        },
      ],
      contexts: [],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let error = null;
  let done = false;
  while (true) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "delta") fullText += ev.content;
      else if (ev.type === "tool") handleEvent(ev);
      else if (ev.type === "citations") check("citations emitted", Array.isArray(ev.sources));
      else if (ev.type === "error") {
        error = ev.message;
        done = true;
      } else if (ev.type === "done") done = true;
    }
    if (done) break;
  }
  if (error) {
    check("no stream error", false, error);
    return;
  }
  check("stream finished with answer", fullText.trim().length > 0, `len=${fullText.trim().length}`);
  console.log("\n--- model summary ---\n" + fullText.trim().slice(0, 1200));

  // Now verify the filesystem state
  const tree = await (await fetch(`${BASE}/api/fs/tree`)).json();
  const names = [];
  const walk = (n) => {
    names.push(n.path);
    if (n.children) n.children.forEach(walk);
  };
  tree.forEach(walk);
  check("Magic folder gone", !names.some((p) => p.startsWith("Magic/")), names.filter((p) => p.startsWith("Magic")).join(","));
  check("one-moved.md gone", !names.includes("one-moved.md"));
  check("two-renamed.md gone", !names.includes("two-renamed.md"));

  const apiTasks = await (await fetch(`${BASE}/api/tasks`)).json();
  const e2e = apiTasks.filter((t) => /E2E (alpha|beta|gamma)/.test(t.title));
  check("alpha+gamma deleted", !e2e.some((t) => /E2E (alpha|gamma)/.test(t.title)), e2e.map((t) => t.title).join(","));
  const beta = e2e.find((t) => t.title === "E2E beta");
  check("beta remains completed", beta && beta.status === "done", beta ? `status=${beta.status}` : "missing");

  console.log("\nTool events seen:");
  for (const f of files) console.log("  file:", f);
  for (const t of tasks) console.log("  task:", t);

  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
