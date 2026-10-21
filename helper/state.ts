import { DeckState, SlideInfo } from "../src/protocol.ts";

export type Source = {
  poll(): Promise<DeckState>;
  next(): Promise<void>;
  prev(): Promise<void>;
};

export type DeckSlide = SlideInfo & { skipped: boolean };

const FALLBACK_TITLE_CHARS = 40;

/** Derives what the glasses show from the raw deck plus Keynote's current slide number. */
export function buildState({
  source,
  status,
  deck,
  slides,
  currentNumber,
  elapsedMs,
}: {
  source: DeckState["source"];
  status: "editing" | "playing";
  deck: string;
  slides: DeckSlide[];
  currentNumber: number;
  elapsedMs: number | null;
}): DeckState {
  const shown = slides.filter((s) => !s.skipped);
  const currentSlide = slides.find((s) => s.number === currentNumber) ?? null;
  const nextSlide = shown.find((s) => s.number > currentNumber) ?? null;
  return {
    source,
    status,
    deck,
    current: currentSlide && toInfo(currentSlide),
    next: nextSlide && toInfo(nextSlide),
    shownCount: shown.length,
    // a skipped slide being edited counts as the position of the last shown slide before it
    shownIndex: shown.filter((s) => s.number <= currentNumber).length,
    elapsedMs,
  };
}

// slides without a visible title fall back to the first line of their notes
function toInfo({ number, title, notes }: DeckSlide): SlideInfo {
  const firstNoteLine = notes.trim().split("\n")[0]?.trim() ?? "";
  const fallback = firstNoteLine.length > FALLBACK_TITLE_CHARS ? firstNoteLine.slice(0, FALLBACK_TITLE_CHARS - 1) + "…" : firstNoteLine;
  // titles often contain soft line breaks; the lens shows them on one line
  const flatTitle = title.replace(/\s+/g, " ").trim();
  return { number, title: flatTitle || fallback || `Slide ${number}`, notes: notes.trim() };
}
