# G2 Presenter

Keynote speaker notes, the next slide, and a talk timer on Even Realities G2 glasses, kept in
sync with whatever advances the deck — your clicker, the keyboard, or the R1 ring.

```
clicker → Keynote (Mac) ← helper polls every 250ms via JXA
                              │  WebSocket (Tailscale or LAN), token-protected
                              ▼
                      glasses app in the Even app WebView ─BLE→ G2
```

On the lens:

```
12:34 · 2/4 · p1/2 · The problem          ← timer · position · notes page · title
Presenter view pulls your eyes down to the
laptop.                                    ← current slide's presenter notes
…
Next: Demo time                            ← next non-skipped slide
Point out the Next line at the bottom.     ← first line of its notes
```

## Run it on the Mac you present from

Needs macOS with Keynote, Node 22+, and (recommended) Tailscale on the Mac and phone, signed in
to the same account.

```bash
npm install
npm start
```

The helper prints a URL per network interface, including the token, e.g.
`http://100.x.y.z:4545/?token=…`. Prefer the `tailscale` one; LAN works when the phone is on
the same Wi-Fi.

The first time it talks to Keynote, macOS asks whether your terminal may control Keynote —
allow it (System Settings → Privacy & Security → Automation if you missed the prompt).

## Load it on the glasses

1. In the Even app, enable developer mode for Even Hub.
2. Make a QR code for the URL the helper printed and scan it from the Even app:

   ```bash
   npx evenhub qr --url "http://100.x.y.z:4545/?token=…"
   ```

The glasses app is served by the helper itself, so it always matches the helper version and needs
no settings. The phone screen mirrors what the lens shows, which is handy for checking the
connection.

## Presenting

- Open the deck in Keynote and press Play. Advance with your clicker as usual.
- R1 ring / temple: **tap** = next, **double tap** = previous, **scroll** = page through long notes.
- Before playing, the lens shows "Editing" with the selected slide's notes, for rehearsing.
- Skipped slides are left out of "Next" and the slide count.
- "Next" uses the slide's title; untitled slides fall back to the first line of their notes.

## Develop without a Mac

```bash
npm run mock   # fake 5-slide deck that responds to next/prev
npm test
npm run typecheck
```

## Optional: install as an Even Hub package

`npm run pack:ehpk` builds `g2-presenter.ehpk` (needs `npx evenhub login` first for uploads).
A packaged app is not served by the helper, so paste the helper URL into the field on the
phone screen once; it is saved on the device.

## Layout

- `helper/` — Node helper: `keynote.ts` (JXA queries), `state.ts` (deck → screen state),
  `mock.ts`, `server.ts` (static app + WebSocket).
- `src/` — glasses app: `main.ts` (bridge + connection), `layout.ts` (wrapping, paging),
  `gestures.ts` (debounced ring/temple input), `protocol.ts` (wire types).
