import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DeckState } from "../src/protocol.ts";
import { buildState, DeckSlide, Source } from "./state.ts";

const exec = promisify(execFile);

// cheap per-tick query; the full deck (notes, titles) is fetched only when it may have changed
const STATUS_SCRIPT = `
function run() {
  const k = Application("Keynote");
  if (!k.running()) return JSON.stringify({ app: false });
  if (k.documents.length === 0) return JSON.stringify({ app: true });
  const d = k.documents[0];
  let slide = 0;
  try { slide = d.currentSlide().slideNumber(); } catch (e) {}
  return JSON.stringify({ app: true, id: d.id(), name: d.name(), playing: k.playing(), slide, count: d.slides.length });
}`;

// bulk property reads are one Apple event each; titles fall back to per-slide reads because a
// slide without a title placeholder makes the bulk read throw
const DECK_SCRIPT = `
function run() {
  const d = Application("Keynote").documents[0];
  const numbers = d.slides.slideNumber();
  const skipped = d.slides.skipped();
  const notes = d.slides.presenterNotes();
  let titles;
  try {
    const showing = d.slides.titleShowing();
    const text = d.slides.defaultTitleItem.objectText();
    titles = text.map((t, i) => (showing[i] ? t : ""));
  } catch (e) {
    titles = d.slides().map((s) => {
      try { return s.titleShowing() ? s.defaultTitleItem().objectText() : ""; } catch (e2) { return ""; }
    });
  }
  return JSON.stringify(numbers.map((n, i) => ({ number: n, skipped: skipped[i], notes: notes[i] || "", title: titles[i] || "" })));
}`;

const EDITING_DECK_REFRESH_MS = 4000;

type KeynoteStatus =
  | { app: false }
  | { app: true; id?: undefined }
  | { app: true; id: string; name: string; playing: boolean; slide: number; count: number };

/** Reads Keynote's front document over JXA (`osascript -l JavaScript`). macOS only. */
export class KeynoteSource implements Source {
  private slides: DeckSlide[] = [];
  private deckKey = "";
  private deckFetchedAt = 0;
  private playStartedAt: number | null = null;

  async poll(): Promise<DeckState> {
    const status: KeynoteStatus = JSON.parse(await runJxa(STATUS_SCRIPT));
    if (!status.app) return this.idle("no-app");
    if (status.id === undefined) return this.idle("no-deck");

    if (status.playing && this.playStartedAt === null) this.playStartedAt = Date.now();
    if (!status.playing) this.playStartedAt = null;

    const key = `${status.id}:${status.count}`;
    const stale = key !== this.deckKey || (!status.playing && Date.now() - this.deckFetchedAt > EDITING_DECK_REFRESH_MS);
    if (stale) {
      this.slides = JSON.parse(await runJxa(DECK_SCRIPT));
      this.deckKey = key;
      this.deckFetchedAt = Date.now();
    }

    return buildState({
      source: "keynote",
      status: status.playing ? "playing" : "editing",
      deck: status.name,
      slides: this.slides,
      currentNumber: status.slide,
      elapsedMs: this.playStartedAt === null ? null : Date.now() - this.playStartedAt,
    });
  }

  // same as a clicker press: advances builds as well as slides
  async next(): Promise<void> {
    await runJxa(`function run() { const k = Application("Keynote"); if (k.playing()) k.showNext(); }`);
  }

  async prev(): Promise<void> {
    await runJxa(`function run() { const k = Application("Keynote"); if (k.playing()) k.showPrevious(); }`);
  }

  private idle(status: "no-app" | "no-deck"): DeckState {
    this.playStartedAt = null;
    this.deckKey = "";
    return { source: "keynote", status, deck: null, current: null, next: null, shownCount: 0, shownIndex: 0, elapsedMs: null };
  }
}

async function runJxa(script: string): Promise<string> {
  const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", script], { timeout: 10_000 });
  return stdout.trim();
}

