// The ticker as a belt of messages, without any DOM. Every message has a place on an endless
// belt (pos, in px) and a width; the belt runs to the left by moving `offset`, and a message is
// on screen at x = pos - offset. An important message shows at once: if there is no room for it
// at the right edge, the whole belt is pushed left quickly until it is fully in view.

// Normal speed of the belt, px per second
export const BELT_SPEED = 70;
// Space between two messages, px
export const BELT_GAP = 40;
// How fast a push catches up: quickly while far, slower near the end (the part still to go
// shrinks like e^(-PUSH_RATE * t)), never slower than PUSH_MIN_SPEED px per second, so it ends
// in about a quarter of a second
export const PUSH_RATE = 12;
export const PUSH_MIN_SPEED = 400;
// Longer frames (a tab in the background) count as this long, s
export const MAX_FRAME = 0.1;

export type BeltItem = { id: number; pos: number; width: number };

export type Belt = {
  offset: number;
  // Where a push wants the offset to be; never behind it
  target: number;
  items: BeltItem[];
};

export const emptyBelt = (): Belt => ({ offset: 0, target: 0, items: [] });

// Adds a message `width` px wide behind the last one. An important (or the very first) message
// starts in view with its end at the right edge, pushing the belt if needed; any other one waits
// behind the right edge and comes in at the normal speed.
export function addItem(
  belt: Belt,
  item: { id: number; width: number },
  stripWidth: number,
  important: boolean
): Belt {
  const last = belt.items[belt.items.length - 1];
  const after = last ? last.pos + last.width + BELT_GAP : -Infinity;
  const edge = belt.offset + stripWidth;
  const pos = Math.max(after, important ? edge - item.width : edge);
  const target = important ? Math.max(belt.target, pos + item.width - stripWidth) : belt.target;
  return { ...belt, target, items: [...belt.items, { ...item, pos }] };
}

// One frame of `dt` seconds. `widths` has the measured width of each message by id (a message
// can get wider, once its font has loaded, for one); a message that grew pushes the ones behind
// it back. Without motion the belt does not run and a push is done at once. Messages that have
// left on the left are dropped.
export function step(
  belt: Belt,
  dt: number,
  widths: ReadonlyMap<number, number>,
  moving: boolean
): Belt {
  let end = -Infinity;
  const laidOut = belt.items.map((item) => {
    const width = widths.get(item.id) ?? item.width;
    const pos = Math.max(item.pos, end + BELT_GAP);
    end = pos + width;
    return { ...item, pos, width };
  });

  const frame = Math.min(dt, MAX_FRAME);
  const left = Math.max(0, belt.target - belt.offset);
  const normal = belt.offset + BELT_SPEED * frame;
  const pushed = belt.offset + (PUSH_MIN_SPEED + PUSH_RATE * left) * frame;
  // A push stops at its target, then the normal speed goes on
  const offset = !moving
    ? belt.offset + left
    : left > 0
      ? Math.max(normal, Math.min(pushed, belt.target))
      : normal;
  return {
    offset,
    target: Math.max(belt.target, offset),
    items: laidOut.filter((item) => item.pos + item.width > offset),
  };
}

// Where a message is on the strip, px from its left edge
export function screenX(belt: Belt, item: BeltItem): number {
  return item.pos - belt.offset;
}
