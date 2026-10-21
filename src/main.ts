import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  EvenHubEvent,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { Gestures } from "./gestures.ts";
import { renderScreen, Screen } from "./layout.ts";
import { ClientMessage, DeckState, ServerMessage } from "./protocol.ts";

const HELPER_KEY = "helperUrl";
const RECONNECT_MAX_MS = 5000;

// -------- glasses page: three stacked text panes -------------------------------
const PANES = [
  { id: 1, name: "header", y: 0, height: 36, brightness: 3 },
  { id: 2, name: "body", y: 36, height: 196, brightness: 4 },
  { id: 3, name: "footer", y: 232, height: 56, brightness: 2 },
] as const;
type PaneName = (typeof PANES)[number]["name"];

let state: DeckState | null = null;
let connected = false;
let page = 0;
let pageCount = 1;
let slideKey = "";
let elapsedBase: { ms: number; at: number } | null = null;
let socket: WebSocket | null = null;

const statusEl = document.getElementById("status")!;
const previewEl = document.getElementById("preview")!;
const helperInput = document.getElementById("helper") as HTMLInputElement;

// -------- helper connection ------------------------------------------------------
function connect(helper: URL | null, attempt = 0) {
  if (!helper) {
    setStatus(false, "No helper URL — scan the QR the helper prints, or paste its URL below.");
    return;
  }
  const ws = new WebSocket(`${helper.protocol === "https:" ? "wss" : "ws"}://${helper.host}/ws?token=${helper.searchParams.get("token") ?? ""}`);
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    connected = true;
    setStatus(true, `Connected to ${helper.host}`);
    render();
  };
  ws.onmessage = (ev) => {
    const msg: ServerMessage = JSON.parse(String(ev.data));
    if (msg.type !== "state") return;
    onState(msg.state);
  };
  ws.onclose = () => {
    connected = false;
    setStatus(false, `Disconnected from ${helper.host} — retrying…`);
    render();
    // a saved URL may have changed while we were connected
    setTimeout(() => connect(resolveHelperUrl() ?? helper, attempt + 1), Math.min(RECONNECT_MAX_MS, 500 * 2 ** attempt));
  };
}

// a live socket reconnects from its close handler (and a closed one already has a retry
// scheduled), both re-resolving the URL
function reconnect() {
  if (!socket) connect(resolveHelperUrl());
  else if (socket.readyState !== WebSocket.CLOSED) socket.close();
}

function onState(next: DeckState) {
  state = next;
  elapsedBase = next.elapsedMs === null ? null : { ms: next.elapsedMs, at: Date.now() };
  // new slide → back to the first page of its notes
  const key = `${next.deck}:${next.current?.number}`;
  if (key !== slideKey) page = 0;
  slideKey = key;
  render();
}

function sendCommand(type: ClientMessage["type"]) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = { type };
  socket.send(JSON.stringify(msg));
}

// -------- rendering ---------------------------------------------------------------
function render() {
  const elapsedMs = elapsedBase && elapsedBase.ms + (Date.now() - elapsedBase.at);
  const screen = renderScreen({ state, connected, page, elapsedMs });
  pageCount = screen.pageCount;
  previewEl.textContent = [screen.header, "", screen.body, "", screen.footer].join("\n");
  glasses.show(screen);
}

function setStatus(ok: boolean, text: string) {
  statusEl.textContent = text;
  statusEl.className = ok ? "ok" : "bad";
}

// tap = next slide, double tap = previous, scroll = page through long notes
function onGesture(gesture: "tap" | "double" | "up" | "down") {
  if (gesture === "tap") sendCommand("next");
  if (gesture === "double") sendCommand("prev");
  if (gesture === "up") page = Math.max(0, page - 1);
  if (gesture === "down") page = Math.min(pageCount - 1, page + 1);
  render();
}

// -------- glasses bridge -----------------------------------------------------------
class GlassesView {
  private bridge: EvenAppBridge | null = null;
  private sent: Partial<Record<PaneName, string>> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private latest: Screen | null = null;
  private readonly gestures = new Gestures(onGesture);

  async init() {
    const bridge = await waitForEvenAppBridge();
    const saved = await bridge.getLocalStorage(HELPER_KEY);
    if (saved && !resolveHelperUrl()) {
      helperInput.value = saved;
      safeStorage(() => localStorage.setItem(HELPER_KEY, saved));
      reconnect();
    }
    const initial = this.latest ?? renderScreen({ state: null, connected: false, page: 0, elapsedMs: null });
    await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: PANES.length,
        textObject: PANES.map(
          (p) =>
            new TextContainerProperty({
              containerID: p.id,
              containerName: p.name,
              xPosition: 0,
              yPosition: p.y,
              width: 576,
              height: p.height,
              paddingLength: 6,
              textColor: p.brightness,
              // the body pane receives ring / temple input
              isEventCapture: p.name === "body" ? 1 : 0,
              content: initial[p.name],
            }),
        ),
      }),
    );
    for (const p of PANES) this.sent[p.name] = initial[p.name];
    bridge.onEvenHubEvent((event: EvenHubEvent) => this.gestures.handle(event));
    this.bridge = bridge;
    if (this.latest) this.show(this.latest);
  }

  saveHelper(url: string) {
    return this.bridge?.setLocalStorage(HELPER_KEY, url);
  }

  // updates are serialized; the bridge must not receive concurrent writes
  show(screen: Screen) {
    this.latest = screen;
    if (!this.bridge) return;
    const bridge = this.bridge;
    for (const p of PANES) {
      const content = screen[p.name];
      if (this.sent[p.name] === content) continue;
      this.sent[p.name] = content;
      this.gestures.noteTextUpdate();
      this.queue = this.queue.then(() =>
        bridge.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: p.id, containerName: p.name, contentOffset: 0, contentLength: 2000, content }),
        ),
      );
    }
  }
}

// helper URL comes from the page itself when served by the helper (QR flow), else from settings
function resolveHelperUrl(): URL | null {
  const here = new URL(location.href);
  if (here.protocol.startsWith("http") && here.searchParams.get("token")) return here;
  const saved = safeStorage(() => localStorage.getItem(HELPER_KEY)) || helperInput.value.trim();
  if (!saved) return null;
  try {
    return new URL(saved);
  } catch {
    return null;
  }
}

// WebView storage can throw (private mode, disabled storage)
function safeStorage<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// -------- startup -------------------------------------------------------------------
const glasses = new GlassesView();
void glasses.init();
connect(resolveHelperUrl());
setInterval(render, 1000); // timer tick; unchanged panes are not resent

document.getElementById("save")!.addEventListener("click", () => {
  safeStorage(() => localStorage.setItem(HELPER_KEY, helperInput.value.trim()));
  void glasses.saveHelper(helperInput.value.trim());
  reconnect();
});
