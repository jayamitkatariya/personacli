import { createServer } from "node:http";

const BASE = "http://127.0.0.1:4998";
let failures = 0;

function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function chat(messages) {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, contexts: [] }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let err = null;
  const tools = [];
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
      else if (ev.type === "tool" && ev.status === "done") tools.push(ev.detail ?? ev.name);
      else if (ev.type === "error") err = ev.message;
      else if (ev.type === "done") done = true;
    }
    if (done) break;
  }
  return { fullText, tools, err };
}

// Turn 1: write a note about camping
const user1 = {
  role: "user",
  content:
    "Create a note at Notes/camping.md titled 'Camping' with this content: 'I went camping at Lake Tahoe last weekend. The tent leaked and it rained all night, but the sunrise over the water was incredible. I want to go back in autumn.' Then confirm.",
};
const t1 = await chat([user1]);
check("turn1 no error", !t1.err, t1.err ?? "");
check("turn1 wrote note", t1.tools.some((x) => x.includes("Notes/camping.md")), t1.tools.join(" | "));

// Turn 2: same conversation, ask about the note WITHOUT attaching context.
// This exercises conversation continuity + semantic search auto-context.
const user2 = {
  role: "user",
  content: "What did I write about camping? Tell me the file it's in and quote one line.",
};
const t2 = await chat([user1, user2]);
check("turn2 no error", !t2.err, t2.err ?? "");
check("turn2 mentions camping file", /camping/i.test(t2.fullText), t2.fullText.slice(0, 200));
check("turn2 quotes a line", /sunrise|Lake Tahoe|tent/i.test(t2.fullText), t2.fullText.slice(0, 300));

// Turn 3: brand-new conversation, no history, no context — semantic search should find it
const t3 = await chat([{ role: "user", content: "Where did I go camping and what happened there?" }]);
check("turn3 no error", !t3.err, t3.err ?? "");
check("turn3 finds the note", /camping|Lake Tahoe/i.test(t3.fullText), t3.fullText.slice(0, 300));

// Cleanup: delete the note
const del = await (await fetch(`${BASE}/api/fs/delete`, {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "Notes/camping.md" }),
})).json();
check("cleanup deleted note", del.ok === true);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
