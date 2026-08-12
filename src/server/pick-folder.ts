import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** macOS native folder picker via osascript. Returns POSIX path or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileP(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Choose Persona workspace")'],
      { timeout: 30000 },
    );
    const path = stdout.trim().replace(/\/$/, "");
    return path || null;
  } catch {
    return null;
  }
}
