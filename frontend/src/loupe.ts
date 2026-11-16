import type { CanvasSize } from '@mifplace/shared';
import { ringSize, type Cell } from './view';

// The loupe over the selected cell (components/CellLoupe.vue): a round lens that magnifies
// the middle most, like a real one. The selected cell is large in the middle; towards the rim
// the cells get smaller and bend, so more of the cells around fit in.
//
// The lens maps a point at distance r from its centre to a point of the canvas at distance
//   s(u) = LOUPE_REACH * u * (FLAT + (1 - FLAT) * u²) cells,  u = r / radius,
// from the middle of the selected cell: LOUPE_REACH cells at the rim, cells of
// radius / (LOUPE_REACH * FLAT) px in the middle.

// Width of the loupe on screen, px
export const LOUPE_SIDE = 176;
// Cells from the middle of the selected cell to the rim
export const LOUPE_REACH = 6.5;
// How flat the middle is: 1 would be no bend at all
const FLAT = 0.7;
// Shown while the cells on screen are smaller than this, px
export const LOUPE_UNTIL_PX = 12;
// Space between the loupe and the edges of the viewport and the ring
const MARGIN = 8;
const RADIUS = LOUPE_SIDE / 2;

// px per cell in the middle of the lens
export const LOUPE_MIDDLE_PX = RADIUS / (LOUPE_REACH * FLAT);

// Centre of the loupe for the cell centred at `cell` (viewport px): above the ring, so a finger
// on the cell does not cover it; below when there is no room above; inside the viewport
export function loupePlace(cell: Cell, cellPx: number, width: number, height: number): Cell {
  const gap = ringSize(cellPx) / 2 + MARGIN;
  const above = cell.y - gap - RADIUS;
  const y = above - RADIUS >= MARGIN ? above : cell.y + gap + RADIUS;
  const x =
    width < LOUPE_SIDE + 2 * MARGIN
      ? width / 2
      : Math.min(width - RADIUS - MARGIN, Math.max(RADIUS + MARGIN, cell.x));
  return { x, y: Math.min(y, height - RADIUS) };
}

// Where a point of the loupe (px from its top left corner) looks on the canvas: cells from the
// middle of the selected cell, with the px per cell there (along the radius, where the
// cells are narrowest); null outside the lens
export function lensOffset(px: number, py: number) {
  const dx = px - RADIUS;
  const dy = py - RADIUS;
  const u2 = (dx * dx + dy * dy) / (RADIUS * RADIUS);
  if (u2 > 1) return null;
  const cellsPerPx = (LOUPE_REACH * (FLAT + (1 - FLAT) * u2)) / RADIUS;
  const pxPerCell = RADIUS / (LOUPE_REACH * (FLAT + 3 * (1 - FLAT) * u2));
  return { x: dx * cellsPerPx, y: dy * cellsPerPx, pxPerCell };
}

// The canvas cell under a point of the loupe around `center`; null outside the lens or the canvas
export function loupeCell(center: Cell, px: number, py: number, size: CanvasSize): Cell | null {
  const offset = lensOffset(px, py);
  if (!offset) return null;
  const x = Math.floor(center.x + 0.5 + offset.x);
  const y = Math.floor(center.y + 0.5 + offset.y);
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
  return { x, y };
}

// The cells the lens can show, around `center`: the part of the canvas to read for drawLens
export function lensArea(center: Cell) {
  const reach = Math.ceil(LOUPE_REACH);
  return { x: center.x - reach, y: center.y - reach, width: 2 * reach + 1, height: 2 * reach + 1 };
}

// RGBA of the cells of lensArea: transparent where it is off the canvas
export type LensSource = { x: number; y: number; width: number; data: Uint8ClampedArray };
type Rgb = [number, number, number];

const INK: Rgb = [12, 16, 48];
const WHITE: Rgb = [255, 255, 255];

// "#rrggbb" -> [r, g, b]; null for anything else
export function hexRgb(color: string | undefined): Rgb | null {
  const match = color && /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Draws the lens into `out`, RGBA of `side` x `side` device px (side = LOUPE_SIDE * pixel
// ratio): the cells through the lens with the lines between them, the coming pixel in the
// selected cell framed inside it, and a thin white frame on the hovered cell.
// Outside the circle it stays transparent.
export function drawLens(
  out: Uint8ClampedArray,
  side: number,
  source: LensSource,
  center: Cell,
  pixel: string | undefined,
  hovered: Cell | null
) {
  const ratio = side / LOUPE_SIDE;
  const coming = hexRgb(pixel);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const at = (j * side + i) * 4;
      const offset = lensOffset((i + 0.5) / ratio, (j + 0.5) / ratio);
      if (!offset) {
        out[at + 3] = 0;
        continue;
      }
      const fx = center.x + 0.5 + offset.x;
      const fy = center.y + 0.5 + offset.y;
      const cx = Math.floor(fx);
      const cy = Math.floor(fy);
      // Distance to the nearest edge of the cell, in device px
      const edge = Math.min(fx - cx, cx + 1 - fx, fy - cy, cy + 1 - fy) * offset.pxPerCell * ratio;

      let color: Rgb;
      const selected = cx === center.x && cy === center.y;
      if (selected && coming) {
        color = coming;
      } else {
        const sx = cx - source.x;
        const sy = cy - source.y;
        const s = (sy * source.width + sx) * 4;
        const inside = sx >= 0 && sy >= 0 && sx < source.width && s < source.data.length;
        color =
          inside && source.data[s + 3] > 0
            ? [source.data[s], source.data[s + 1], source.data[s + 2]]
            : INK;
      }

      // The selected cell: a dark edge, then a white frame inside it. Any other: the line
      // between the cells, or a white frame when the mouse is over it.
      if (selected) {
        if (edge < ratio) color = INK;
        else if (edge < 3 * ratio) color = WHITE;
      } else if (hovered?.x === cx && hovered.y === cy && edge < 1.5 * ratio) {
        color = mix(color, WHITE, 0.85);
      } else if (edge < 0.6 * ratio) {
        color = mix(color, INK, 0.18);
      }

      out[at] = color[0];
      out[at + 1] = color[1];
      out[at + 2] = color[2];
      out[at + 3] = 255;
    }
  }
}
