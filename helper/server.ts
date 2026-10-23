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
const HEARTBEAT_MS = 3000;
const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const mock = process.argv.includes("--mock");
const debug = process.argv.includes("--debug");
// `npm run dev`: the app is served by Vite (hot reload) on this port, proxying /ws to us
const DEV_APP_PORT = process.argv.includes("--dev") ? 5173 : null;
const source: Source = mock ? new MockSource() : new KeynoteSource();
const token = loadToken();

// -------- http: serves the built glasses app ---------------------------------
const server = createServer(async (req, res) => {
  const url = parseRequestUrl(req.url);
  if (!url) {
    res.writeHead(400).end();
    return;
  }
  const file = normalize(join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname));
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
let lastError = "";
const alive = new WeakSet<WebSocket>();

server.on("upgrade", (req, socket, head) => {
  const url = parseRequestUrl(req.url);
  if (url?.pathname !== "/ws" || url.searchParams.get("token") !== token) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  console.log(`glasses connected (${wss.clients.size} client(s))`);
  alive.add(ws);
  if (state) send(ws, state);
  ws.on("pong", () => alive.add(ws));
  // malformed frames emit "error"; without a listener they crash the process
  ws.on("error", (err) => console.error("socket error:", err.message));
  ws.on("message", async (raw) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
      if (msg.type === "debug") {
        if (debug) console.log("glasses event:", JSON.stringify(msg.event));
        return;
      }
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

// single-flight: a tick requested mid-poll (e.g. right after a command) reruns once the current
// poll finishes, so an older osascript result can never land after a newer one
let polling = false;
let rerun = false;
async function tick() {
  if (polling) {
    rerun = true;
    return;
  }
  polling = true;
  try {
    do {
      rerun = false;
      await pollOnce();
    } while (rerun);
  } finally {
    polling = false;
  }
}

// only broadcast real changes; the glasses run the timer locally from elapsedMs
async function pollOnce() {
  try {
    state = await source.poll();
    lastError = "";
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    if (message !== lastError) console.error("keynote poll failed:", message);
    lastError = message;
    state = errorState(message);
  }
  const key = JSON.stringify({ ...state, elapsedMs: state.elapsedMs === null });
  if (key === lastSent) return;
  lastSent = key;
  for (const ws of wss.clients) send(ws, state);
}

setInterval(tick, POLL_MS);

// heartbeat: drop peers that stopped answering pings, and resend state so the glasses can tell
// a quiet connection from a dead one
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
    if (state) send(ws, state);
  }
}, HEARTBEAT_MS);

// the usual first-run failure is macOS blocking Automation access to Keynote
function errorState(message: string): DeckState {
  const automation = /not allowed|not authori[sz]ed|-1743/i.test(message);
  return {
    source: mock ? "mock" : "keynote",
    status: "error",
    error: automation ? "Allow Automation access to Keynote in System Settings → Privacy & Security." : "Can't read Keynote. See the helper's terminal.",
    deck: null,
    current: null,
    next: null,
    shownCount: 0,
    shownIndex: 0,
    elapsedMs: null,
  };
}

server.listen(PORT, HOST, () => {
  console.log(`G2 Presenter helper (${mock ? "mock deck" : "Keynote"}) on ${HOST}:${PORT}\n`);
  console.log("Open one of these in the Even app (dev mode → scan QR):");
  const appPort = DEV_APP_PORT ?? PORT;
  const addresses = lanAddresses();
  for (const { name, address } of addresses) {
    console.log(`  ${address.startsWith("100.") ? "tailscale" : name.padEnd(9)}  http://${address}:${appPort}/?token=${token}`);
  }
  // single quotes so shells don't escape the "?" or "=" (zsh pastes them as "\?" and "\=")
  const preferred = addresses.find((a) => a.address.startsWith("100.")) ?? addresses[0];
  if (preferred) console.log(`\nQR code:\n  npx evenhub qr --url 'http://${preferred.address}:${appPort}/?token=${token}'`);
});

// paths like "//?token=…" are protocol-relative to `new URL(path, base)` and throw, so prefix
// the origin instead and collapse repeated slashes
function parseRequestUrl(raw = "/"): URL | null {
  try {
    const url = new URL(`http://x/${raw.replace(/^\/+/, "")}`);
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    return url;
  } catch {
    return null;
  }
}

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
