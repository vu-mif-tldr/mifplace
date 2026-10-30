import { z } from 'zod';

// The HTTP API (see docs/api.md) as zod schemas. Each type is inferred from its schema, so the
// TypeScript type and the run-time check cannot drift apart: the backend checks requests and
// the frontend checks responses with the same definitions.

// What GET /api/canvas/size returns. The size does not change while the server runs,
// so the frontend asks for it once and keeps it.
export const CanvasSizeSchema = z.object({
  width: z.int().positive(),
  height: z.int().positive(),
});
export type CanvasSize = z.infer<typeof CanvasSizeSchema>;

// What GET /api/canvas returns: the snapshot of the whole canvas.
// pixels is the color id of every cell, index = pos (see position.ts), so its length is
// width * height; a negative colorId is an unpainted cell. The length cannot be checked
// here, the size is a separate response.
// eventId and timestamp are the last event in the snapshot (both 0 for an empty log):
// the checkpoint /api/ws resumes from.
export const CanvasStateSchema = z.object({
  pixels: z.array(z.int()),
  eventId: z.int().nonnegative(),
  timestamp: z.int().nonnegative(),
});
export type CanvasState = z.infer<typeof CanvasStateSchema>;

// One color from GET /api/palette. id is the color id the server uses, not an index in the list
export const PaletteColorSchema = z.object({
  id: z.int().nonnegative(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'color must be #rrggbb'),
});
export type PaletteColor = z.infer<typeof PaletteColorSchema>;

// The whole GET /api/palette response: at least one color, ids are unique
export const PaletteSchema = z
  .array(PaletteColorSchema)
  .min(1)
  .refine((palette) => new Set(palette.map(({ id }) => id)).size === palette.length, {
    error: 'palette color ids must be unique',
  });

// Body of POST /api/pixels (pos = position = y * width + x, see toPosition; colorIndex = palette color id).
// Only the shape is checked here: whether the position is on the canvas is positionSchema.
export const PlacePixelRequestSchema = z.object({
  pos: z.int(),
  colorIndex: z.int(),
});
export type PlacePixelRequest = z.infer<typeof PlacePixelRequestSchema>;

// 201 response of POST /api/pixels
export const PlacePixelResponseSchema = z.object({
  success: z.literal(true),
  eventId: z.int(),
});
export type PlacePixelResponse = z.infer<typeof PlacePixelResponseSchema>;

// Body of every API error response
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// A failed check as one line for an error response or an MCP tool result,
// e.g. "x: x must be less than canvas width (128)". Issues are joined with "; ".
export function zodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ` : '') + issue.message)
    .join('; ');
}
