import {
  CELL_SIZE,
  SPEED,
  Band,
  applyMove,
  buildRamp,
  mixColors,
  movePieces,
  paperMoves,
  pickMove,
  planeTransform,
  type BandRect,
  type Move,
  type Sheet,
} from './pixelBand';

const sheet = (w: number, h: number): Sheet => ({ x: 0, y: 0, w, h });
const RAMP = buildRamp('#78003f');
const OLD = '#111111';
const NEW = '#222222';

describe('applyMove', () => {
  it('leaves the sheet in place when rotating', () => {
    expect(applyMove(sheet(1, 1), { kind: 'rotate', axis: 'x', sign: 1 })).toEqual(sheet(1, 1));
  });

  it('keeps the half on the side of the fold', () => {
    const square = sheet(1, 1);
    expect(applyMove(square, { kind: 'fold', axis: 'x', sign: -1 })).toEqual(sheet(0.5, 1));
    expect(applyMove(square, { kind: 'fold', axis: 'x', sign: 1 })).toEqual({
      ...sheet(0.5, 1),
      x: 0.5,
    });
    expect(applyMove(square, { kind: 'fold', axis: 'y', sign: -1 })).toEqual(sheet(1, 0.5));
    expect(applyMove(square, { kind: 'fold', axis: 'y', sign: 1 })).toEqual({
      ...sheet(1, 0.5),
      y: 0.5,
    });
  });

  it('opens towards the side of the unfold', () => {
    const square = sheet(1, 1);
    expect(applyMove(square, { kind: 'unfold', axis: 'x', sign: 1 })).toEqual(sheet(2, 1));
    expect(applyMove(square, { kind: 'unfold', axis: 'x', sign: -1 })).toEqual({
      ...sheet(2, 1),
      x: -1,
    });
    expect(applyMove(square, { kind: 'unfold', axis: 'y', sign: 1 })).toEqual(sheet(1, 2));
    expect(applyMove(square, { kind: 'unfold', axis: 'y', sign: -1 })).toEqual({
      ...sheet(1, 2),
      y: -1,
    });
  });

  it('undoes a fold with the opposite unfold', () => {
    const fold: Move = { kind: 'fold', axis: 'x', sign: -1 };
    const unfold: Move = { kind: 'unfold', axis: 'x', sign: 1 };
    expect(applyMove(applyMove(sheet(1, 1), fold), unfold)).toEqual(sheet(1, 1));
  });
});

describe('paperMoves', () => {
  const kinds = (from: Sheet) =>
    paperMoves(from).map(({ kind, axis, sign }) => `${kind} ${axis} ${sign}`);

  it('folds and unfolds a square along any side', () => {
    expect(kinds(sheet(1, 1))).toHaveLength(8);
  });

  it('allows a rectangle only the moves that make a square', () => {
    expect(kinds(sheet(1, 0.5))).toEqual(['fold x 1', 'fold x -1', 'unfold y 1', 'unfold y -1']);
    expect(kinds(sheet(1, 2))).toEqual(['fold y 1', 'fold y -1', 'unfold x 1', 'unfold x -1']);
  });

  it('does not go beyond the smallest and the biggest size', () => {
    expect(kinds(sheet(0.5, 0.5)).every((move) => move.startsWith('unfold'))).toBe(true);
    const biggest = { x: -2, y: -2, w: 4, h: 4 };
    expect(kinds(biggest).every((move) => move.startsWith('fold'))).toBe(true);
  });

  it('does not go too far from its cell', () => {
    expect(kinds({ x: 0, y: -2, w: 1, h: 1 })).not.toContain('unfold y -1');
    expect(kinds({ x: 0, y: 2, w: 1, h: 1 })).not.toContain('unfold y 1');
    expect(kinds({ x: -2, y: 0, w: 1, h: 1 })).not.toContain('unfold x -1');
    expect(kinds({ x: 2, y: 0, w: 1, h: 1 })).not.toContain('unfold x 1');
  });
});

describe('pickMove', () => {
  it('turns a rectangle into a new square, never back into the square it came from', () => {
    const squares = [sheet(0.5, 0.5), sheet(1, 1), sheet(2, 2), { x: -1, y: -1, w: 2, h: 2 }];
    for (let col = 0; col < 40; col++) {
      for (const square of squares) {
        for (const move of paperMoves(square)) {
          const rectangle = applyMove(square, move);
          const next = applyMove(rectangle, pickMove(col, 0, 1, rectangle, square));
          expect(next.w).toBe(next.h);
          expect(next).not.toEqual(square);
        }
      }
    }
  });
});

describe('movePieces', () => {
  const pieces = (move: Move, progress: number) =>
    movePieces(sheet(1, 1), move, progress, OLD, NEW);

  it('rotates by shrinking towards the center and changes the color edge-on', () => {
    const move: Move = { kind: 'rotate', axis: 'y', sign: 1 };
    expect(pieces(move, 0)).toEqual([{ sheet: sheet(1, 1), color: OLD }]);
    const [middle] = pieces(move, 0.5);
    expect(middle.sheet.h).toBeCloseTo(0);
    expect(middle.sheet.y).toBeCloseTo(0.5);
    const [end] = pieces(move, 1);
    expect(end.sheet.h).toBeCloseTo(1);
    expect(end.color).toBe(NEW);
  });

  it('folds the far half over the half that stays', () => {
    const move: Move = { kind: 'fold', axis: 'x', sign: -1 };

    const [stayStart, flapStart] = pieces(move, 0);
    expect(stayStart).toEqual({ sheet: sheet(0.5, 1), color: OLD });
    expect(flapStart.sheet.x).toBeCloseTo(0.5);
    expect(flapStart.sheet.w).toBeCloseTo(0.5);
    expect(flapStart.color).toBe(OLD);

    expect(pieces(move, 0.5)[1].sheet.w).toBeCloseTo(0);

    const flapEnd = pieces(move, 1)[1];
    expect(flapEnd.sheet.x).toBeCloseTo(0);
    expect(flapEnd.sheet.w).toBeCloseTo(0.5);
    expect(flapEnd.color).toBe(NEW);
  });

  it('opens the top layer over the side of the unfold', () => {
    const move: Move = { kind: 'unfold', axis: 'y', sign: 1 };

    const [under, layerStart] = pieces(move, 0);
    expect(under).toEqual({ sheet: sheet(1, 1), color: NEW });
    expect(layerStart.sheet.y).toBeCloseTo(0);
    expect(layerStart.sheet.h).toBeCloseTo(1);
    expect(layerStart.color).toBe(OLD);

    const layerEnd = pieces(move, 1)[1];
    expect(layerEnd.sheet.y).toBeCloseTo(1);
    expect(layerEnd.sheet.h).toBeCloseTo(1);
    expect(layerEnd.color).toBe(NEW);
  });

  it('covers exactly the final sheet at the end of a fold and an unfold', () => {
    for (const kind of ['fold', 'unfold'] as const) {
      const move: Move = { kind, axis: 'x', sign: 1 };
      const final = applyMove(sheet(1, 1), move);
      const parts = pieces(move, 1).map((part) => part.sheet);
      expect(Math.min(...parts.map((part) => part.x))).toBeCloseTo(final.x);
      expect(Math.max(...parts.map((part) => part.x + part.w))).toBeCloseTo(final.x + final.w);
    }
  });
});

describe('mixColors', () => {
  it('goes from one color to the other', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixColors('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });
});

describe('buildRamp', () => {
  it('goes from the color itself to a pastel tint', () => {
    const ramp = buildRamp('#78003f');
    expect(ramp[0]).toBe('#78003f');
    expect(parseInt(ramp[ramp.length - 1].slice(1, 3), 16)).toBeGreaterThan(230);
  });
});

describe('planeTransform', () => {
  it('turns the rows of the plane so that they run up to the left at 60 degrees', () => {
    const [a, b] = planeTransform(1000, 200);
    // Where the moving direction of the plane (-1, 0) goes on the screen
    const [dx, dy] = [-a, -b];
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
    expect(Math.atan2(-dy, -dx)).toBeCloseTo(Math.PI / 3);
  });

  it('puts the origin of the plane in the center of the band', () => {
    expect(planeTransform(1000, 200).slice(4)).toEqual([500, 100]);
  });
});

describe('Band', () => {
  const WIDTH = 4000;
  const HEIGHT = 600;

  const centerIn = (width: number, height: number) => (rect: BandRect) => {
    const [a, b, c, d, e, f] = planeTransform(width, height);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  };
  const center = centerIn(WIDTH, HEIGHT);
  const onScreen = (rects: BandRect[]) =>
    rects.filter((rect) => {
      const { x, y } = center(rect);
      return x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT;
    });
  const isWholeCell = (rect: BandRect) => rect.width === CELL_SIZE && rect.height === CELL_SIZE;
  // A band that has been going for `seconds`, turned to `direction` if given
  const bandAfter = (seconds: number, direction?: number) => {
    const band = new Band();
    if (direction !== undefined) band.turnTo(direction);
    band.rects(WIDTH, HEIGHT, RAMP);
    for (let time = 0; time < seconds; time += 0.1) {
      band.advance(0.1);
      band.rects(WIDTH, HEIGHT, RAMP);
    }
    return band;
  };
  // A step of the first sheet on the screen
  const stepOf = (band: Band) => {
    const before = center(band.rects(WIDTH, HEIGHT, RAMP)[0]);
    band.advance(0.1);
    const after = center(band.rects(WIDTH, HEIGHT, RAMP)[0]);
    return { dx: after.x - before.x, dy: after.y - before.y };
  };
  const SQUARES = [0.5, 1, 2, 4].map((side) => `${side * CELL_SIZE}x${side * CELL_SIZE}`);

  it('is the same for the same moves', () => {
    expect(bandAfter(30).rects(WIDTH, HEIGHT, RAMP)).toEqual(
      bandAfter(30).rects(WIDTH, HEIGHT, RAMP)
    );
  });

  it('covers the whole band', () => {
    const centers = bandAfter(0).rects(WIDTH, HEIGHT, RAMP).map(center);
    const margin = 2 * CELL_SIZE;
    expect(Math.min(...centers.map(({ x }) => x))).toBeLessThan(margin);
    expect(Math.max(...centers.map(({ x }) => x))).toBeGreaterThan(WIDTH - margin);
    expect(Math.min(...centers.map(({ y }) => y))).toBeLessThan(margin);
    expect(Math.max(...centers.map(({ y }) => y))).toBeGreaterThan(HEIGHT - margin);
  });

  it('has sheets in a small part of the cells', () => {
    const count = onScreen(bandAfter(0).rects(WIDTH, HEIGHT, RAMP)).length;
    const share = count / ((WIDTH * HEIGHT) / CELL_SIZE ** 2);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
  });

  it('shows some sheets with moves made already at the start', () => {
    expect(
      bandAfter(0)
        .rects(WIDTH, HEIGHT, RAMP)
        .some((rect) => !isWholeCell(rect))
    ).toBe(true);
  });

  it('moves the sheets up and to the left at 60 degrees until it is turned', () => {
    const { dx, dy } = stepOf(bandAfter(0));
    expect(Math.atan2(-dy, -dx)).toBeCloseTo(Math.PI / 3);
    expect(Math.hypot(dx, dy)).toBeCloseTo(SPEED * 0.1);
  });

  it('turns to any direction on the screen and keeps the speed', () => {
    for (const direction of [0, Math.PI / 2, Math.PI, -Math.PI / 4, (300 * Math.PI) / 180]) {
      const { dx, dy } = stepOf(bandAfter(20, direction));
      expect(dx / Math.hypot(dx, dy)).toBeCloseTo(Math.cos(direction), 3);
      expect(dy / Math.hypot(dx, dy)).toBeCloseTo(Math.sin(direction), 3);
      expect(Math.hypot(dx, dy)).toBeCloseTo(SPEED * 0.1, 3);
    }
  });

  it('turns smoothly', () => {
    const band = bandAfter(0);
    band.turnTo(0);
    const { dx, dy } = stepOf(band);
    // Still going mostly the old way
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });

  it('does not jump after a pause', () => {
    const band = bandAfter(0);
    const before = center(band.rects(WIDTH, HEIGHT, RAMP)[0]);
    band.advance(60);
    const after = center(band.rects(WIDTH, HEIGHT, RAMP)[0]);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(SPEED);
  });

  it('brings new sheets into sight as squares', () => {
    // A small band, so that the sheets seen at the start are gone after a minute
    const [width, height] = [400, 200];
    const band = new Band();
    band.turnTo(0);
    for (let time = 0; time < 60; time += 0.1) {
      band.rects(width, height, RAMP);
      band.advance(0.1);
    }
    // Going right, the new sheets come in on the left
    const centerSmall = centerIn(width, height);
    const left = band.rects(width, height, RAMP).filter((rect) => {
      const { x, y } = centerSmall(rect);
      return x < -2 * CELL_SIZE && Math.abs(y - height / 2) < 50;
    });
    expect(left.length).toBeGreaterThan(0);
    expect(left.every(isWholeCell)).toBe(true);
  });

  it('changes the sheets on the way into squares of all sizes', () => {
    // A smaller band in bigger steps, to be quick
    const [width, height] = [1200, 400];
    const seen = new Set<string>();
    const band = new Band();
    for (let step = 0; step < 800; step++) {
      band.advance(0.5);
      const rects = band.rects(width, height, RAMP);
      if (step % 14 === 0) for (const rect of rects) seen.add(`${rect.width}x${rect.height}`);
    }
    for (const shape of SQUARES) expect(seen).toContain(shape);
  });

  it('moves only a small part of the sheets at any moment', () => {
    const rects = onScreen(bandAfter(100).rects(WIDTH, HEIGHT, RAMP));
    const moving = rects.filter((rect) => rect.width !== rect.height);
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.length / rects.length).toBeLessThan(0.15);
  });

  it('takes only the tints of the given color and light grey', () => {
    const redRamp = buildRamp('#ff0000');
    const greyRamp = buildRamp('#dcdcdc');
    const colors = new Set(
      bandAfter(0)
        .rects(WIDTH, HEIGHT, redRamp)
        .map((rect) => rect.color)
    );
    for (const color of colors) expect([...redRamp, ...greyRamp]).toContain(color);
    expect([...colors].some((color) => redRamp.includes(color))).toBe(true);
    expect([...colors].some((color) => greyRamp.includes(color))).toBe(true);
  });

  it('does not change the shapes and the grey sheets with the color', () => {
    const band = bandAfter(30);
    const red = band.rects(WIDTH, HEIGHT, buildRamp('#ff0000'));
    const blue = band.rects(WIDTH, HEIGHT, buildRamp('#0000ff'));
    expect(blue.map(({ x, y }) => ({ x, y }))).toEqual(red.map(({ x, y }) => ({ x, y })));
    const greyRamp = buildRamp('#dcdcdc');
    red.forEach((rect, i) => {
      if (greyRamp.includes(rect.color)) expect(blue[i].color).toBe(rect.color);
    });
  });
});
