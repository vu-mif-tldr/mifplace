import type { CanvasSize } from '@mifplace/shared';

// Screen px per cell at zoom 1, so that the whole canvas fits the viewport.
// The longer side of the canvas touches the viewport edges.
export function fitCellSize(size: CanvasSize, viewportWidth: number, viewportHeight: number) {
  return Math.min(viewportWidth / size.width, viewportHeight / size.height);
}

// Offset of the canvas inside the viewport along one axis, in screen px.
// A canvas longer than the viewport can move only until its far edge reaches the viewport
// edge, so no empty space is shown. A shorter one is centered and does not move.
export function clampOffset(offset: number, canvasLength: number, viewportLength: number) {
  if (canvasLength <= viewportLength) return (viewportLength - canvasLength) / 2;
  return Math.min(0, Math.max(viewportLength - canvasLength, offset));
}

// Offset along one axis after zooming from `scale` to `newScale` around `point` (both in
// viewport px), so the spot under the point stays under it
export function zoomOffset(offset: number, point: number, scale: number, newScale: number) {
  return point - (point - offset) * (newScale / scale);
}

export type Cell = { x: number; y: number };

// Centre of a cell in viewport px: the canvas starts at `offset` and has `cellPx` px per cell
export function cellCenter(cell: Cell, offset: Cell, cellPx: number): Cell {
  return { x: offset.x + (cell.x + 0.5) * cellPx, y: offset.y + (cell.y + 0.5) * cellPx };
}

// The cell at a point in viewport px, or null when the point is beside the canvas. The canvas
// starts at `offset` and has `cellPx` px per cell.
export function cellAt(point: Cell, offset: Cell, cellPx: number, size: CanvasSize): Cell | null {
  const x = Math.floor((point.x - offset.x) / cellPx);
  const y = Math.floor((point.y - offset.y) / cellPx);
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
  return { x, y };
}

// A click on the cell that is already selected places the pixel (FR-7: pick, then confirm);
// a click anywhere else only moves the selection
export function clickAction(selected: Cell | null, clicked: Cell): 'place' | 'select' {
  return selected && selected.x === clicked.x && selected.y === clicked.y ? 'place' : 'select';
}

export type Rect = { x: number; y: number; width: number; height: number };

// The part of `rect` inside a `width` x `height` viewport; zero size when it is all outside
export function visiblePart(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(width, rect.x + rect.width) - x),
    height: Math.max(0, Math.min(height, rect.y + rect.height) - y),
  };
}

// Width of the mark on the selected cell (its ticks, the loupe gap): around the cell, never
// smaller than a fingertip mark
export function ringSize(cellPx: number) {
  return Math.max(34, cellPx + 18);
}
