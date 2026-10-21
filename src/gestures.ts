import { EvenHubEvent, OsEventTypeList } from "@evenrealities/even_hub_sdk";

export type Gesture = "tap" | "double" | "up" | "down";

// G2 hardware often reports one physical gesture several times, and re-layout after a text
// update fires spurious scrolls. Timings follow even-toolkit's tuned values.
const TAP_COOLDOWN_MS = 220;
const SAME_SCROLL_DEBOUNCE_MS = 350;
const SCROLL_AFTER_TAP_MS = 110;
const SCROLL_AFTER_TEXT_MS = 80;

/** Turns raw Even Hub input events into debounced gestures. */
export class Gestures {
  private lastTapAt = 0;
  private lastScroll = { at: 0, dir: "" };
  private lastTextAt = 0;

  constructor(private readonly onGesture: (g: Gesture) => void) {}

  noteTextUpdate() {
    this.lastTextAt = Date.now();
  }

  handle(event: EvenHubEvent) {
    const gesture = classify(event);
    if (gesture && this.accept(gesture)) this.onGesture(gesture);
  }

  private accept(gesture: Gesture): boolean {
    const now = Date.now();
    if (gesture === "tap" || gesture === "double") {
      if (now - this.lastTapAt < TAP_COOLDOWN_MS) return false;
      this.lastTapAt = now;
      return true;
    }
    if (now - this.lastTapAt < SCROLL_AFTER_TAP_MS || now - this.lastTextAt < SCROLL_AFTER_TEXT_MS) return false;
    if (gesture === this.lastScroll.dir && now - this.lastScroll.at < SAME_SCROLL_DEBOUNCE_MS) return false;
    this.lastScroll = { at: now, dir: gesture };
    return true;
  }
}

export function classify(event: EvenHubEvent): Gesture | null {
  const ev = event.textEvent ?? event.listEvent ?? event.sysEvent;
  if (!ev) return null;
  switch (ev.eventType) {
    case OsEventTypeList.CLICK_EVENT:
      return "tap";
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "double";
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "up";
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "down";
    // CLICK_EVENT is protobuf value 0, which is often omitted on the wire; a bare system event
    // with no input source is not a tap
    case undefined:
      return ev === event.sysEvent && !event.sysEvent.eventSource ? null : "tap";
    default:
      return null;
  }
}
