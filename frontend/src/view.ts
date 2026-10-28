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
