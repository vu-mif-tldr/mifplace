import {
  BELT_GAP,
  BELT_SPEED,
  MAX_FRAME,
  addItem,
  emptyBelt,
  screenX,
  step,
  type Belt,
} from './belt';

const STRIP = 800;
const none = new Map<number, number>();

// Runs the belt for `seconds` in frames of 1/60 s
function run(belt: Belt, seconds: number, widths = none): Belt {
  let current = belt;
  for (let t = 0; t < seconds; t += 1 / 60) current = step(current, 1 / 60, widths);
  return current;
}

const x = (belt: Belt, id: number) =>
  screenX(
    belt,
    belt.items.find((i) => i.id === id)!
  );

describe('addItem', () => {
  it('shows an important message on an empty belt at once, its end at the right edge', () => {
    const belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, true);
    expect(x(belt, 1)).toBe(STRIP - 100);
    expect(belt.target).toBe(0);
  });

  it('keeps any other message behind the right edge', () => {
    const belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, false);
    expect(x(belt, 1)).toBe(STRIP);
  });

  it('puts a message behind the last one, with a gap', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, false);
    belt = addItem(belt, { id: 2, width: 50 }, STRIP, false);
    expect(x(belt, 2)).toBe(STRIP + 100 + BELT_GAP);
  });

  it('asks for a push when an important message has no room at the right edge', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, false);
    belt = addItem(belt, { id: 2, width: 60 }, STRIP, true);
    // Its end must reach the right edge: the belt has to run 100 + gap + 60 px
    expect(belt.target).toBe(100 + BELT_GAP + 60);
  });
});

describe('step', () => {
  it('runs the belt left at the normal speed', () => {
    const belt = run(addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, true), 1);
    expect(x(belt, 1)).toBeCloseTo(STRIP - 100 - BELT_SPEED, 0);
  });

  it('pushes an important message fully into view in a fraction of a second', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 300 }, STRIP, false);
    belt = addItem(belt, { id: 2, width: 100 }, STRIP, true);
    belt = run(belt, 0.3);
    // The end of the new message has reached the right edge
    expect(x(belt, 2) + 100).toBeLessThanOrEqual(STRIP);
    // ...and the message before it was pushed into view as well
    expect(x(belt, 1)).toBeLessThan(STRIP - 300);
  });

  it('goes back to the normal speed after a push', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 300 }, STRIP, false);
    belt = run(addItem(belt, { id: 2, width: 100 }, STRIP, true), 1);
    const before = x(belt, 2);
    belt = run(belt, 1);
    expect(before - x(belt, 2)).toBeCloseTo(BELT_SPEED, 0);
  });

  it('drops the messages that have left on the left', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, true);
    belt = run(belt, (STRIP + 10) / BELT_SPEED);
    expect(belt.items).toEqual([]);
  });

  it('moves the messages behind a message that grew', () => {
    let belt = addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, true);
    belt = addItem(belt, { id: 2, width: 50 }, STRIP, true);
    belt = step(belt, 0, new Map([[1, 160]]));
    expect(x(belt, 2) - x(belt, 1)).toBe(160 + BELT_GAP);
  });

  it('counts a long frame as MAX_FRAME', () => {
    const belt = step(addItem(emptyBelt(), { id: 1, width: 100 }, STRIP, true), 5, none);
    expect(belt.offset).toBeCloseTo(BELT_SPEED * MAX_FRAME);
  });
});
