import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ClientMessage, DeckState, ServerMessage } from "../src/protocol.ts";
import { KeynoteSource } from "./keynote.ts";
import { MockSource } from "./mock.ts";
import { Source } from "./state.ts";

const PORT = Number(process.env.PORT ?? 4545);
const HOST = process.env.HOST ?? "0.0.0.0";
const POLL_MS = 250;
const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const mock = process.argv.includes("--mock");
const source: Source = mock ? new MockSource() : new KeynoteSource();
const token = loadToken();

// -------- http: serves the built glasses app ---------------------------------
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const file = normalize(join(DIST_DIR, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found — did you run `npm run build`?");
  }
});

// -------- websocket: pushes deck state, receives next/prev --------------------
const wss = new WebSocketServer({ noServer: true });
let state: DeckState | null = null;
let lastSent = "";

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws" || url.searchParams.get("token") !== token) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  console.log(`glasses connected (${wss.clients.size} client(s))`);
  if (state) send(ws, state);
  ws.on("message", async (raw) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
      if (msg.type === "next") await source.next();
      if (msg.type === "prev") await source.prev();
    } catch (err) {
      console.error("command failed:", err);
    }
    await tick();
  });
  ws.on("close", () => console.log(`glasses disconnected (${wss.clients.size} client(s))`));
});

function send(ws: WebSocket, s: DeckState) {
  const msg: ServerMessage = { type: "state", state: s };
  ws.send(JSON.stringify(msg));
}

// only broadcast real changes; the glasses run the timer locally from elapsedMs
async function tick() {
  try {
    state = await source.poll();
  } catch (err) {
    console.error("keynote poll failed:", err);
    return;
  }
  const key = JSON.stringify({ ...state, elapsedMs: state.elapsedMs === null });
  if (key === lastSent) return;
  lastSent = key;
  for (const ws of wss.clients) send(ws, state);
}

let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  await tick();
  polling = false;
}, POLL_MS);

server.listen(PORT, HOST, () => {
  console.log(`G2 Presenter helper (${mock ? "mock deck" : "Keynote"}) on ${HOST}:${PORT}\n`);
  console.log("Open one of these in the Even app (dev mode → scan QR):");
  for (const { name, address } of lanAddresses()) {
    const url = `http://${address}:${PORT}/?token=${token}`;
    console.log(`  ${address.startsWith("100.") ? "tailscale" : name.padEnd(9)}  ${url}`);
  }
  console.log(`\nQR code:  npx evenhub qr --url "http://<address>:${PORT}/?token=${token}"`);
});

function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => ({ name, address: a.address })),
  );
}

function loadToken(): string {
  if (process.env.G2P_TOKEN) return process.env.G2P_TOKEN;
  const dir = join(homedir(), ".g2-presenter");
  const file = join(dir, "token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fresh = randomBytes(12).toString("hex");
  writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}
