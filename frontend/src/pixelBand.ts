// The decorative band of big pixels at the bottom of the page: what is where at a given moment.
// The pixels lie on an endless plane of cells, turned as a whole and moving as a whole.
// The page shows the plane only through a mask at the bottom of the screen (see .pixel-band).
// Each pixel is a sheet of paper that from time to time rotates, folds in two or unfolds.
// The look of a sheet is computed from its cell coordinates and how long it is in sight, so
// only the way the plane has moved and when each sheet came into sight are stored between
// frames. Drawing is in PixelBand.vue.

// Sheets take the tints of the color selected on the page and stay light grey in part.
// Burgundy, the main VU color, is there until a color is selected.
export const DEFAULT_BAND_COLOR = '#78003f';
const LIGHT_GREY = '#dcdcdc';

export const CELL_SIZE = 60; // px
export const SPEED = 10; // px per second
// Turning the plane by 60 degrees makes the squares look tilted by 30. At first the band moves
// along their own sides, up and to the left; it can be turned any way (see Band).
const PLANE_ANGLE = Math.PI / 3;
const PLANE_COS = Math.cos(PLANE_ANGLE);
const PLANE_SIN = Math.sin(PLANE_ANGLE);
const MOVE_DURATION = 1.2; // seconds
// How long the band takes to turn the most of the way to a new direction, in seconds
const TURN_TIME = 1.5;
// The longest step of the band: after a pause (a hidden tab) it goes on where it stopped
const MAX_STEP = 0.5; // seconds

// How often a sheet makes a move, in seconds
const MIN_MOVE_PERIOD = 12;
const MAX_MOVE_PERIOD = 40;
const ROTATE_SHARE = 1 / 3; // The other moves are folds and unfolds

// Limits of a sheet, in cells, relative to its own cell
const MIN_SIDE = 0.5;
const MAX_SIDE = 4;
const MIN_OFFSET = -2;
const MAX_OFFSET = 3;

const DENSITY = 0.3; // Share of the cells that have a sheet
// How long the sheets seen at the start may have been in sight, in seconds
const HEAD_START = 2 * MAX_MOVE_PERIOD;

// A ramp goes from the color itself (index 0) to a pastel tint (the last index)
const RAMP_LENGTH = 8;
const MAX_TINT = 0.9;
const GREY_RAMP = buildRamp(LIGHT_GREY);

const GREY_SHARE = 0.2;
// The tone of a sheet: 0 is the color itself, 1 is the palest tint. The mask makes it paler still
// towards the top of the band.
const MIN_TONE = 0.05;
const MAX_TONE = 0.7;

// Rectangle to draw, in px of the plane
export interface BandRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

// Where a sheet lies, in cells, relative to its own cell
export interface Sheet {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Axis = 'x' | 'y';

// rotate: turn around the axis across `axis`, the sheet stays in place.
// fold: one half goes over the other, and the half on the `sign` side of `axis` stays.
// unfold: the sheet opens up to double size towards the `sign` side of `axis`.
export interface Move {
  kind: 'rotate' | 'fold' | 'unfold';
  axis: Axis;
  sign: 1 | -1;
}

function channelsOf(color: string) {
  return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
}

function toHex(channels: number[]) {
  const hex = channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0'));
  return `#${hex.join('')}`;
}

// The color at `share` of the way from one #rrggbb color to another
export function mixColors(from: string, to: string, share: number) {
  const target = channelsOf(to);
  return toHex(channelsOf(from).map((channel, i) => channel + (target[i] - channel) * share));
}

export function buildRamp(color: string) {
  return Array.from({ length: RAMP_LENGTH }, (_, index) =>
    mixColors(color, '#ffffff', (index / (RAMP_LENGTH - 1)) * MAX_TINT)
  );
}

// Stable pseudo-random number from 0 (inclusive) to 1 (exclusive) for a cell
function random(col: number, row: number, salt: number) {
  let hash = Math.imul(col, 73856093) ^ Math.imul(row, 19349663) ^ Math.imul(salt + 1, 83492791);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 2 ** 32;
}

// Salts of random() that belong to the move number `moves` of a sheet
function moveSalt(moves: number, part: number) {
  return 10 + 8 * moves + part;
}

// The color after `moves` moves
function sheetColor(col: number, row: number, moves: number, ramp: string[]) {
  const tone = MIN_TONE + (MAX_TONE - MIN_TONE) * random(col, row, moveSalt(moves, 0));
  const index = Math.round(tone * (RAMP_LENGTH - 1));
  const isGrey = random(col, row, moveSalt(moves, 1)) < GREY_SHARE;
  return isGrey ? GREY_RAMP[index] : ramp[index];
}

function spanOf(sheet: Sheet, axis: Axis) {
  return axis === 'x' ? { start: sheet.x, length: sheet.w } : { start: sheet.y, length: sheet.h };
}

function withSpan(sheet: Sheet, axis: Axis, start: number, length: number): Sheet {
  return axis === 'x' ? { ...sheet, x: start, w: length } : { ...sheet, y: start, h: length };
}

// The same, for a span given by its fixed end and the signed length from it
function withSpanFrom(sheet: Sheet, axis: Axis, hinge: number, signedLength: number) {
  return withSpan(sheet, axis, Math.min(hinge, hinge + signedLength), Math.abs(signedLength));
}

// Where the sheet lies after the move
export function applyMove(sheet: Sheet, { kind, axis, sign }: Move): Sheet {
  if (kind === 'rotate') return sheet;
  const { start, length } = spanOf(sheet, axis);
  if (kind === 'fold')
    return withSpan(sheet, axis, sign > 0 ? start + length / 2 : start, length / 2);
  return withSpan(sheet, axis, sign > 0 ? start : start - length, length * 2);
}

// A sheet may be a square or, for the time of the next move, a 1:2 rectangle. So a square folds
// and unfolds along any side, a rectangle only into a square. It also must stay near its cell.
function isAllowed({ x, y, w, h }: Sheet) {
  return (
    Math.min(w, h) >= MIN_SIDE &&
    Math.max(w, h) <= MAX_SIDE &&
    Math.max(w, h) <= 2 * Math.min(w, h) &&
    x >= MIN_OFFSET &&
    y >= MIN_OFFSET &&
    x + w <= MAX_OFFSET &&
    y + h <= MAX_OFFSET
  );
}

// The folds and unfolds this sheet can make
export function paperMoves(sheet: Sheet) {
  const moves: Move[] = [];
  for (const kind of ['fold', 'unfold'] as const) {
    for (const axis of ['x', 'y'] as const) {
      for (const sign of [1, -1] as const) {
        const move = { kind, axis, sign };
        if (isAllowed(applyMove(sheet, move))) moves.push(move);
      }
    }
  }
  return moves;
}

const isSquare = ({ w, h }: Sheet) => w === h;

const isSame = (a: Sheet, b: Sheet) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// The move number `moves` of a sheet that lies as `sheet` after lying as `previous`.
// A rectangle at once becomes a square again, by a fold or an unfold, and not the same square
// it came from.
export function pickMove(
  col: number,
  row: number,
  moves: number,
  sheet: Sheet,
  previous?: Sheet
): Move {
  const choice = random(col, row, moveSalt(moves, 4));
  if (!isSquare(sheet)) {
    const back = (move: Move) => previous !== undefined && isSame(applyMove(sheet, move), previous);
    const ways = paperMoves(sheet).filter((move) => !back(move));
    return ways[Math.floor(choice * ways.length)];
  }
  const paper = paperMoves(sheet);
  if (paper.length > 0 && random(col, row, moveSalt(moves, 3)) >= ROTATE_SHARE) {
    return paper[Math.floor(choice * paper.length)];
  }
  return { kind: 'rotate', axis: choice < 0.5 ? 'x' : 'y', sign: 1 };
}

// What is visible during a move, in drawing order. `progress` goes from 0 to 1. A moving part
// turns from 0 to 180 degrees, so seen from the front its size is the cosine of the angle,
// and the other side of the paper, in the new color, shows from the middle of the turn.
export function movePieces(
  sheet: Sheet,
  { kind, axis, sign }: Move,
  progress: number,
  oldColor: string,
  newColor: string
) {
  const cosine = Math.cos(Math.PI * progress);
  const moving = progress < 0.5 ? oldColor : newColor;
  const { start, length } = spanOf(sheet, axis);

  if (kind === 'rotate') {
    const visible = length * Math.abs(cosine);
    return [
      { sheet: withSpan(sheet, axis, start + (length - visible) / 2, visible), color: moving },
    ];
  }
  if (kind === 'fold') {
    // The moving half starts on the side opposite to `sign` and ends on top of the other one
    const middle = start + length / 2;
    return [
      { sheet: applyMove(sheet, { kind, axis, sign }), color: oldColor },
      { sheet: withSpanFrom(sheet, axis, middle, -sign * (length / 2) * cosine), color: moving },
    ];
  }
  // The top layer starts on top of the sheet and opens around the edge on the `sign` side,
  // showing the inside of the paper under it
  const hinge = sign > 0 ? start + length : start;
  return [
    { sheet, color: newColor },
    { sheet: withSpanFrom(sheet, axis, hinge, -sign * length * cosine), color: moving },
  ];
}

// What a sheet looks like `elapsed` seconds after it has come into sight. A square waits for
// its next move, a rectangle goes on to the next one right away.
function sheetPieces(col: number, row: number, elapsed: number, ramp: string[]) {
  const period = MIN_MOVE_PERIOD + (MAX_MOVE_PERIOD - MIN_MOVE_PERIOD) * random(col, row, 1);
  let start = period * random(col, row, 2);
  let sheet: Sheet = { x: 0, y: 0, w: 1, h: 1 };
  let previous: Sheet | undefined;
  let moves = 0;
  for (; start <= elapsed; moves++) {
    const move = pickMove(col, row, moves, sheet, previous);
    const progress = (elapsed - start) / MOVE_DURATION;
    if (progress < 1) {
      const oldColor = sheetColor(col, row, moves, ramp);
      const newColor = sheetColor(col, row, moves + 1, ramp);
      return movePieces(sheet, move, progress, oldColor, newColor);
    }
    previous = sheet;
    sheet = applyMove(sheet, move);
    start += isSquare(sheet) ? period : MOVE_DURATION;
  }
  return [{ sheet, color: sheetColor(col, row, moves, ramp) }];
}

// How to get from the plane to the screen, in px of the band, as the arguments of
// CanvasRenderingContext2D.transform(). The plane turns around the center of the band.
export function planeTransform(width: number, height: number) {
  return [PLANE_COS, PLANE_SIN, -PLANE_SIN, PLANE_COS, width / 2, height / 2] as const;
}

// The sheets on the plane: where they have moved to, which way they go, and since when each
// one is in sight. A sheet starts as a square when it comes into sight, so its moves are
// replayed only from then on, whatever way the band has been moving.
export class Band {
  // Seconds of the band's own clock, it stops while there are no frames
  private clock = 0;
  // How far the sheets have moved, in px of the plane
  private offsetX = 0;
  private offsetY = 0;
  // Velocity and the one the band turns to, in px of the plane per second. At first the band
  // goes along the rows, up and to the left.
  private velocityX = -SPEED;
  private velocityY = 0;
  private targetX = -SPEED;
  private targetY = 0;
  // When each sheet in sight came into sight, by `${col},${row}`
  private births = new Map<string, number>();
  private isStarted = false;

  // Makes the band turn smoothly to `direction`, an angle on the screen in radians
  // (as of Math.atan2: 0 is to the right, PI / 2 is down)
  turnTo(direction: number) {
    const planeDirection = direction - PLANE_ANGLE;
    this.targetX = SPEED * Math.cos(planeDirection);
    this.targetY = SPEED * Math.sin(planeDirection);
  }

  // Moves the sheets on by `seconds`
  advance(seconds: number) {
    const step = Math.min(seconds, MAX_STEP);
    const share = Math.min(1, step / TURN_TIME);
    this.velocityX += (this.targetX - this.velocityX) * share;
    this.velocityY += (this.targetY - this.velocityY) * share;
    this.offsetX += this.velocityX * step;
    this.offsetY += this.velocityY * step;
    this.clock += step;
  }

  // The rectangles to draw for a band of this size (in px), in px of the plane, using the tints
  // from `ramp`. They cover the whole band, and later ones lie on top.
  rects(width: number, height: number, ramp: string[]) {
    // The part of the plane that can get into the band, with the reach of a sheet around it
    const halfWidth = (width * PLANE_COS + height * PLANE_SIN) / 2;
    const halfHeight = (width * PLANE_SIN + height * PLANE_COS) / 2;
    const firstCol = Math.floor((-halfWidth - this.offsetX) / CELL_SIZE) - MAX_OFFSET;
    const lastCol = Math.ceil((halfWidth - this.offsetX) / CELL_SIZE) - MIN_OFFSET;
    const firstRow = Math.floor((-halfHeight - this.offsetY) / CELL_SIZE) - MAX_OFFSET;
    const lastRow = Math.ceil((halfHeight - this.offsetY) / CELL_SIZE) - MIN_OFFSET;

    // Sheets out of sight are forgotten
    const births = new Map<string, number>();
    const rects: BandRect[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        if (random(col, row, 0) >= DENSITY) continue;

        const key = `${col},${row}`;
        // The sheets seen first are not all fresh squares: some have made moves already
        const birth =
          this.births.get(key) ??
          (this.isStarted ? this.clock : this.clock - HEAD_START * random(col, row, 3));
        births.set(key, birth);

        const homeX = col * CELL_SIZE + this.offsetX;
        const homeY = row * CELL_SIZE + this.offsetY;
        for (const { sheet, color } of sheetPieces(col, row, this.clock - birth, ramp)) {
          rects.push({
            x: homeX + sheet.x * CELL_SIZE,
            y: homeY + sheet.y * CELL_SIZE,
            width: sheet.w * CELL_SIZE,
            height: sheet.h * CELL_SIZE,
            color,
          });
        }
      }
    }
    this.births = births;
    this.isStarted = true;
    return rects;
  }
}
