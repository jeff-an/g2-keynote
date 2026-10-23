# G2 Presenter

Keynote speaker notes and the next slide on Even Realities G2 glasses. **Read HANDOFF.md
first.** It has the architecture, the G2/SDK constraints, what's verified, and the next steps.

- Iterate: `npm run dev:mock` (or `npm run dev` with Keynote), then `npm run sim` for the Even
  simulator. Drive the simulator through its automation API on :9898.
- Check: `npm test && npm run typecheck`.
- Measure lens text with `@evenrealities/pretext`. Size panes to their exact line count (27px
  lines) or the firmware takes over scrolling.
- All bridge calls go through the serialized queue in `src/main.ts`.
