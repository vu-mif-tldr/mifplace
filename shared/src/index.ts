// Types of the HTTP API shared by the backend and the frontend (see docs/api.md),
// and the canvas geometry (position.ts) used by every workspace.
export * from './position.js';

// What GET /api/canvas/size returns. The size does not change while the server runs,
// so the frontend asks for it once and keeps it.
export type CanvasSize = {
  width: number;
  height: number;
};

// What GET /api/canvas returns.
// pixels has only the painted cells, as [position, colorId] (position = y * width + x)
export type CanvasState = {
  pixels: [number, number][];
};

// One color from GET /api/palette. id is the color id the server uses, not an index in the list
export type PaletteColor = {
  id: number;
  color: string;
};

// Body of POST /api/pixels (colorIndex = index in the palette)
export type PlacePixelRequest = {
  x: number;
  y: number;
  colorIndex: number;
};

// 201 response of POST /api/pixels
export type PlacePixelResponse = {
  success: true;
  eventId: number;
};

// Body of every API error response
export type ErrorResponse = {
  success: false;
  error: string;
};
