import assert from "node:assert/strict";
import { test } from "node:test";
import { buildState, DeckSlide } from "../helper/state.ts";
import { COLS, formatClock, renderScreen, wrap } from "../src/layout.ts";

const SLIDES: DeckSlide[] = [
  { number: 1, skipped: false, title: "Intro", notes: "Hello" },
  { number: 2, skipped: true, title: "Backup", notes: "" },
  { number: 3, skipped: false, title: "", notes: "First line of notes\nmore" },
];

test("next slide skips skipped slides and counts only shown ones", () => {
  const s = buildState({ source: "mock", status: "playing", deck: "d", slides: SLIDES, currentNumber: 1, elapsedMs: 0 });
  assert.equal(s.next?.number, 3);
  assert.equal(s.shownCount, 2);
  assert.equal(s.shownIndex, 1);
});

test("untitled slide falls back to its first notes line", () => {
  const s = buildState({ source: "mock", status: "playing", deck: "d", slides: SLIDES, currentNumber: 1, elapsedMs: 0 });
  assert.equal(s.next?.title, "First line of notes");
});

test("last slide has no next", () => {
  const s = buildState({ source: "mock", status: "playing", deck: "d", slides: SLIDES, currentNumber: 3, elapsedMs: 0 });
  assert.equal(s.next, null);
  assert.match(renderScreen({ state: s, connected: true, page: 0, elapsedMs: 0 }).footer, /end of deck/);
});

test("wrap respects width, keeps line breaks, and hard-splits long words", () => {
  const lines = wrap("aaa bbb\n" + "x".repeat(COLS + 5), 10);
  assert.ok(lines.every((l) => l.length <= 10));
  assert.equal(lines[0], "aaa bbb");
  assert.equal(lines.slice(1).join(""), "x".repeat(COLS + 5));
});

test("long notes paginate and the page clamps", () => {
  const notes = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const s = buildState({
    source: "mock",
    status: "playing",
    deck: "d",
    slides: [{ number: 1, skipped: false, title: "T", notes }],
    currentNumber: 1,
    elapsedMs: 0,
  });
  const screen = renderScreen({ state: s, connected: true, page: 99, elapsedMs: 65_000 });
  assert.equal(screen.pageCount, 3);
  assert.match(screen.header, /^01:05 · 1\/1 · p3\/3/);
  assert.ok(screen.body.startsWith("line 14"));
});

test("clock formats minutes and seconds", () => {
  assert.equal(formatClock(3_725_000), "62:05");
});

test("footer does not repeat a title that came from the next slide's notes", () => {
  const s = buildState({ source: "mock", status: "playing", deck: "d", slides: SLIDES, currentNumber: 1, elapsedMs: 0 });
  const footer = renderScreen({ state: s, connected: true, page: 0, elapsedMs: 0 }).footer;
  assert.equal(footer, "Next: First line of notes\nmore");
});
