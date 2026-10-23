// Wire format between the Mac helper and the glasses app (JSON over WebSocket).

export type SlideInfo = {
  number: number; // 1-based Keynote slide number
  title: string;
  notes: string;
};

export type DeckState = {
  source: "keynote" | "mock";
  status: "no-app" | "no-deck" | "editing" | "playing" | "error";
  error?: string; // shown on the lens when status is "error"
  deck: string | null;
  current: SlideInfo | null;
  next: SlideInfo | null; // next non-skipped slide; null on the last slide
  shownCount: number; // slides that will be shown (excludes skipped)
  shownIndex: number; // 1-based position of the current slide among shown slides
  elapsedMs: number | null; // time since the slideshow started; null when not playing
};

export type ServerMessage = { type: "state"; state: DeckState };

export type ClientMessage = { type: "next" } | { type: "prev" } | { type: "debug"; event: unknown };
