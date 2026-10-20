// Starts the API and the web app on free ports, so several worktrees can run `npm run dev` at once.
// The first free ports from 3001 (API) and 5173 (web) are used; the URL is printed when the web app is up.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Vite and the API listen on "localhost" only, so a bare listen() would not see them; check each address.
function canListen(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

async function isFree(port) {
  for (const host of ["localhost", "127.0.0.1", "::"]) {
    if (!(await canListen(port, host))) return false;
  }
  return true;
}

async function freePort(from) {
  for (let port = from; port < from + 100; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port from ${from}`);
}

const apiPort = await freePort(Number(process.env.PORT ?? 3001));
const webPort = await freePort(5173);

const children = [
  spawn("npm", ["run", "dev", "-w", "@travel-planner/api"], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(apiPort) },
  }),
  spawn("npm", ["run", "dev", "-w", "@travel-planner/web", "--", "--port", String(webPort), "--strictPort"], {
    stdio: "inherit",
    env: { ...process.env, API_PORT: String(apiPort) },
  }),
];

console.log(`\nTravel Planner: http://localhost:${webPort}  (API on ${apiPort})\n`);

const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
}
