import { getTextWidth } from "@evenrealities/pretext";
import { DeckState } from "./protocol.ts";

// G2 canvas is 576x288 with a fixed 27px line height and no font-size control. Each pane is
// sized to exactly its line count: text taller than a pane makes the firmware add a scrollbar
// and swallow scroll gestures, so our own paging stops working.
const SCREEN_WIDTH = 576;
const LINE_PX = 27;
const PAD = 2;
const TEXT_WIDTH = SCREEN_WIDTH - 2 * PAD;
const HEADER_LINES = 1;
export const BODY_LINES = 7;
const FOOTER_LINES = 2;

const paneHeight = (lines: number) => lines * LINE_PX + 2 * PAD;
export const PANE_GEOMETRY = {
  pad: PAD,
  width: SCREEN_WIDTH,
  header: { y: 0, height: paneHeight(HEADER_LINES) },
  body: { y: paneHeight(HEADER_LINES), height: paneHeight(BODY_LINES) },
  footer: { y: paneHeight(HEADER_LINES) + paneHeight(BODY_LINES), height: paneHeight(FOOTER_LINES) },
};

export type Screen = { header: string; body: string; footer: string; pageCount: number };

/** Renders the three glasses text panes for a deck state and the current notes page. */
export function renderScreen({
  state,
  connected,
  page,
  elapsedMs,
}: {
  state: DeckState | null;
  connected: boolean;
  page: number;
  elapsedMs: number | null;
}): Screen {
  if (!connected || !state) return message("G2 Presenter", "Helper offline.\nReconnecting…");
  if (state.status === "no-app") return message("G2 Presenter", "Keynote isn't running.");
  if (state.status === "no-deck") return message("G2 Presenter", "Open a deck in Keynote.");
  if (state.status === "error") return message("G2 Presenter", state.error ?? "Helper error.");

  const { current, next } = state;
  const pages = paginate(wrap(current?.notes || "(no notes)"), BODY_LINES);
  const clampedPage = Math.min(page, pages.length - 1);
  const position = `${state.shownIndex}/${state.shownCount}`;
  const lead = state.status === "playing" ? formatClock(elapsedMs ?? 0) : "Editing";
  const pager = pages.length > 1 ? ` · p${clampedPage + 1}/${pages.length}` : "";
  const nextLines = next ? [`Next: ${next.title}`, notesPreview(next.title, next.notes)] : ["Next: — end of deck —"];

  return {
    header: truncate(`${lead} · ${position}${pager} · ${current?.title ?? ""}`),
    body: (pages[clampedPage] ?? []).join("\n"),
    footer: nextLines.filter(Boolean).map(truncate).join("\n"),
    pageCount: pages.length,
  };
}

/**
 * Word-wraps text to the pane's pixel width using the firmware font metrics, keeping the
 * author's line breaks. Every returned line fits on one rendered line.
 */
export function wrap(text: string, maxPx = TEXT_WIDTH): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (getTextWidth(candidate) <= maxPx) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // a word wider than a full line (URLs etc.) is hard-split
      line = "";
      for (const ch of word) {
        if (line && getTextWidth(line + ch) > maxPx) {
          out.push(line);
          line = "";
        }
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

export function paginate(lines: string[], size: number): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size));
  return pages.length ? pages : [[]];
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function message(header: string, body: string): Screen {
  return { header, body: wrap(body).slice(0, BODY_LINES).join("\n"), footer: "", pageCount: 1 };
}

// first notes line, skipping it when the untitled slide's title was already taken from it
function notesPreview(title: string, notes: string): string {
  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const titleFromNotes = title === first || (title.endsWith("…") && first.startsWith(title.slice(0, -1)));
  return (titleFromNotes ? lines[1] : lines[0]) ?? "";
}

function truncate(text: string): string {
  if (getTextWidth(text) <= TEXT_WIDTH) return text;
  let cut = text;
  while (cut && getTextWidth(cut + "…") > TEXT_WIDTH) cut = cut.slice(0, -1);
  return cut + "…";
}
