import { DeckState } from "./protocol.ts";

// G2 canvas is 576x288. The LVGL font averages ~12-13px per char, so ~42 columns fit with
// padding, and lines are ~28px tall. Header 1 line, notes 7 lines, footer 2 lines.
export const COLS = 42;
export const BODY_LINES = 7;

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

  const { current, next } = state;
  const pages = paginate(wrap(current?.notes || "(no notes)"), BODY_LINES);
  const clampedPage = Math.min(page, pages.length - 1);
  const position = `${state.shownIndex}/${state.shownCount}`;
  const lead = state.status === "playing" ? formatClock(elapsedMs ?? 0) : "Editing";
  const pager = pages.length > 1 ? ` · p${clampedPage + 1}/${pages.length}` : "";
  const nextLines = next
    ? [truncate(`Next: ${next.title}`, COLS), truncate(notesPreview(next.title, next.notes), COLS)]
    : ["Next: — end of deck —"];

  return {
    header: truncate(`${lead} · ${position}${pager} · ${current?.title ?? ""}`, COLS),
    body: (pages[clampedPage] ?? []).join("\n"),
    footer: nextLines.filter(Boolean).join("\n"),
    pageCount: pages.length,
  };
}

/** Word-wraps text to `width` columns, keeping the author's line breaks. */
export function wrap(text: string, width = COLS): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      // hard-split words longer than a full line (URLs etc.)
      for (let w = word; w.length > 0; w = w.slice(width)) {
        const piece = w.slice(0, width);
        if (!line) line = piece;
        else if (line.length + 1 + piece.length <= width) line += " " + piece;
        else {
          out.push(line);
          line = piece;
        }
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
  return { header, body, footer: "", pageCount: 1 };
}

// first notes line, skipping it when the untitled slide's title was already taken from it
function notesPreview(title: string, notes: string): string {
  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean);
  const titleFromNotes = lines[0]?.startsWith(title.replace(/…$/, ""));
  return (titleFromNotes ? lines[1] : lines[0]) ?? "";
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, width - 1) + "…";
}
