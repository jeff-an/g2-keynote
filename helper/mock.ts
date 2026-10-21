import { DeckState } from "../src/protocol.ts";
import { buildState, DeckSlide, Source } from "./state.ts";

const SLIDES: DeckSlide[] = [
  { number: 1, skipped: false, title: "G2 Presenter", notes: "Welcome everyone. Quick intro: who I am and why smart glasses for speaker notes." },
  {
    number: 2,
    skipped: false,
    title: "The problem",
    notes:
      "Presenter view pulls your eyes down to the laptop.\nYou lose the room every time you glance.\nConfidence monitors are expensive and rarely there.\nThis slide has deliberately long notes so the glasses have to page through them: tell the story about the conference where the confidence monitor died ten minutes before the keynote, and how the whole talk was delivered from memory.",
  },
  { number: 3, skipped: true, title: "Hidden backup slide", notes: "Only if someone asks about pricing." },
  { number: 4, skipped: false, title: "", notes: "Demo time. Click through the live deck.\nPoint out the Next line at the bottom." },
  { number: 5, skipped: false, title: "Questions?", notes: "Thank the organisers. Mention the repo." },
];

/** Fake always-playing deck for testing the glasses app without a Mac. */
export class MockSource implements Source {
  private current = 1;
  private readonly startedAt = Date.now();

  async poll(): Promise<DeckState> {
    return buildState({
      source: "mock",
      status: "playing",
      deck: "Mock deck",
      slides: SLIDES,
      currentNumber: this.current,
      elapsedMs: Date.now() - this.startedAt,
    });
  }

  async next(): Promise<void> {
    this.current = SLIDES.find((s) => !s.skipped && s.number > this.current)?.number ?? this.current;
  }

  async prev(): Promise<void> {
    this.current = SLIDES.findLast((s) => !s.skipped && s.number < this.current)?.number ?? this.current;
  }
}
