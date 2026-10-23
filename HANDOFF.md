# Handoff: G2 Presenter

State of the project as of 2026-10-23. It was written on a Linux devbox, which has no Keynote,
simulator or glasses, so most of the hardware behaviour is still unverified. This doc is for the
next session, on the Mac, where all three are available.

## Goal

Present from Keynote on macOS with a clicker. The Even Realities G2 glasses show the current
slide's speaker notes, the next slide, and a timer, and they stay in sync whichever input
advances the deck (clicker, keyboard, or R1 ring).

## Architecture

```
clicker/keyboard → Keynote ← helper polls every 250ms (osascript -l JavaScript)
                                │ HTTP: serves the glasses app (dist/, or Vite in dev)
                                │ WS /ws?token=…: pushes DeckState, receives next/prev
                                ▼
                 Even app WebView on the phone (src/) ──BLE──▶ G2 lens (3 text panes)
```

- **helper/keynote.ts**: JXA. It runs a cheap status query every tick (front doc id/name,
  playing, current slide number, slide count). The full deck (notes, titles, skipped flags) is
  re-read only when the doc or slide count changes, or every 4s while editing.
- **helper/state.ts**: `buildState()`, a pure function that picks the next non-skipped slide,
  counts only shown slides, and falls back from a missing title to the first line of the notes.
- **helper/server.ts**:
  - static files plus the WebSocket, with a token check on the upgrade
  - single-flight polling: a rerun flag means an older read can never land after a newer one
  - a heartbeat every 3s that pings and resends state, and terminates dead peers
  - errors become `status: "error"` with a message shown on the lens
- **src/main.ts**:
  - **Bridge**: `createStartUpPageContainer` runs once, then `textContainerUpgrade` per pane.
    Writes are serialized, only the latest text per pane is kept, each write has a 3s timeout,
    and a failed write is retried on the next render.
  - **Connection**: reconnects with backoff, and a watchdog treats 8s of silence as a dead link.
- **src/layout.ts**: pixel-accurate wrapping with `@evenrealities/pretext`, plus pane geometry,
  pagination and the clock.
- **src/gestures.ts**: debounced gestures. Tap = next, double tap = prev, scroll = notes page.

## Hard-won facts about the G2 / Even Hub SDK

Sources: the `everything-evenhub` plugin skills, the SDK `.d.ts`, and even-toolkit.

- **Font**: there is no font-size, bold or alignment control. Lines are a fixed 27px. The
  usable width is the container width minus 2×(padding + border). Measure text with
  `@evenrealities/pretext`; never estimate by character count (that underestimated by ~40%).
- **Pane height**: if the text is taller than a pane's inner height, the firmware adds a
  scrollbar and handles scroll gestures itself, so our paging never sees them. This caused the
  "scroll doesn't work after N chars" bug. Size panes to exactly lines×27 + 2×pad.
- **Events**:
  - Scroll arrives as `textEvent`: 1 = top/up, 2 = bottom/down.
  - Taps arrive as `sysEvent`. `CLICK_EVENT` is 0, which protobuf often omits, so an
    undefined `eventType` means a tap.
  - One physical gesture can arrive several times, so debounce.
- **Bridge calls**:
  - `createStartUpPageContainer` exactly once per page load.
  - Exactly one container has `isEventCapture: 1`.
  - Text limits: 1000 chars at create or rebuild, 2000 via `textContainerUpgrade`.
  - Serialize every bridge call, since concurrent calls can crash the link. A flaky BLE call can
    hang for about 30s.
  - Brightness is `textColor` 0–4.
- **Glyphs**: `· … — → ▶` all exist in the firmware font (checked with pretext `getAdvW`).
- **Dev mode**:
  - The Even app loads any URL from a QR code made with `evenhub qr --url '<url>'`. Use single
    quotes: zsh escapes `?` and `=`, and a `token\=` link once reached the server and crashed it
    (fixed).
  - Paths like `//?token…` must be parsed with an origin prefix, not `new URL(path, base)`.

## How to iterate on the Mac

```bash
npm install
npm run dev:mock   # fake deck; or `npm run dev` with Keynote
npm run sim        # Even simulator at :5173 with the token, automation API on :9898
```

- `npm run dev` serves the app with Vite on :5173 (hot reload) and proxies `/ws` to the helper on
  :4545. `tsx watch` restarts the helper on change, and `--debug` prints the raw glasses events.
- **Simulator** (`@evenrealities/evenhub-simulator`):
  - Arrow up/down = scroll, click = tap, double click = double tap.
  - Clicking the display saves a PNG screenshot.
  - `--automation-port 9898` exposes an HTTP API, so an agent can drive it. Check `--help` and
    the plugin's test-with-simulator skill for its endpoints.
  - Font rendering is only approximate, so check the final layout on the glasses.
- **Glasses**: run the QR command the helper prints (port 5173 in dev mode) and scan it in the
  Even app in developer mode. Saving a file in `src/` reloads the WebView on the phone, which
  re-creates the glasses page. That flow has not been confirmed on hardware yet; if the lens goes
  stale after a reload, close and reopen the app.
- **Claude Code**: install Even's skills with
  `/plugin marketplace add even-realities/everything-evenhub`, then
  `/plugin install everything-evenhub@everything-evenhub`. The useful skills are
  handle-input, glasses-ui, font-measurement and test-with-simulator.
- **Checks**: `npm test` (node:test via tsx) and `npm run typecheck`.

## Status

Verified on the devbox:
- typecheck, the unit tests, and the build
- mock-mode end-to-end over WebSocket: next/prev, skipped slides, token rejection, heartbeat,
  a burst of commands, a malformed frame
- the dev-mode Vite proxy
- the `//` path crash fix

Reported by the user on real hardware:
- loading and connecting worked
- long notes broke scrolling (fixed in 729bd1f by the pixel layout, still unconfirmed)

Unverified, so test these first:
1. JXA against real Keynote: slide number during playback, `presenterNotes`, titles,
   `showNext`/`showPrevious` from the ring, and the Automation permission prompt.
2. Scroll paging with the new pixel-sized panes. Run with `npm run dev` and watch the raw
   events.
3. Double tap: if the firmware sends `CLICK` then `DOUBLE_CLICK`, the tap cooldown fires next
   and drops prev, so the deck goes the wrong way. Fix by deferring taps or letting a double
   override.
4. Whether hot reload re-creates the glasses page cleanly.

## Known gaps / next steps

- **Auto-scroll for long notes** (the user asked about it). Options:
  - fixed reading pace (~150 wpm) per page, with manual scroll overriding it
  - spreading pages over a per-slide time budget
  - The user hasn't picked one yet.
- **Several decks open**: the helper reads `documents[0]` (the front document). Also return the
  doc id from `DECK_SCRIPT` and check it, to avoid a race when the front doc changes between the
  status and deck reads.
- **Big decks**: the per-slide title fallback costs about 3 Apple events per slide. On 100+ slide
  decks, consider caching titles by doc modification time.
- **Polling latency**: an `osascript` spawn every 250ms adds ~100–200ms. A long-lived JXA process
  reading commands on stdin would be faster.
- **Timer**: resets if the slideshow stops and resumes, or the helper restarts.
- **Starting the helper**: optionally a macOS LaunchAgent to start it at login.
- **Tailscale on the Mac**, so the phone works away from home Wi-Fi.
- **Packaging**: `npm run pack:ehpk` for a proper Even Hub install. The app then needs its helper
  URL pasted into the phone UI.

## Conventions

- TypeScript ESM, strict. No `any`.
- Destructured object params for functions with several arguments.
- Short comments only where the code is non-obvious.
- Keep panes sized from `PANE_GEOMETRY`; never hard-code pixel sizes in `main.ts`.
- Every helper file and app file must stay dependency-light. The app runs in a phone WebView,
  and the helper should start with just `npm install`.
