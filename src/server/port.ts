import net from "node:net";

export const DEFAULT_PORT = 4321;

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreePort(preferred: number = DEFAULT_PORT): Promise<number> {
  if (await isPortFree(preferred)) return preferred;
  for (let i = 0; i < 50; i++) {
    const port = 10000 + Math.floor(Math.random() * 40000);
    if (await isPortFree(port)) return port;
  }
  throw new Error("Could not find a free port");
}

export function isPersonaServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) return resolve(false);
        return res
          .json()
          .then((body: unknown) => resolve((body as { app?: string })?.app === "persona"))
          .catch(() => resolve(false));
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}
