import {
  CanvasSizeSchema,
  CanvasStateSchema,
  PaletteSchema,
  zodErrorMessage,
  type CanvasSize,
  type CanvasState,
  type PaletteColor,
  type PlacePixelRequest,
} from '@mifplace/shared';

// TypeScript types are not checked at runtime, so every response is checked with the schema
// of its type from @mifplace/shared before it is used.

// The server answered 401: there is no session any more (it expired, the user signed out in
// another tab, the account was blocked). The page then shows the sign-in screens.
export class SignedOutError extends Error {
  constructor() {
    super('Not signed in');
  }
}

// Throws unless the request succeeded: SignedOutError for 401, an Error with `message` else
function check(response: Response, message: string): void {
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error(message);
}

// Get the color palette from the server
export async function getPalette(): Promise<PaletteColor[]> {
  const response = await fetch('/api/palette');
  check(response, 'Could not load the palette');
  const palette = PaletteSchema.safeParse(await response.json());
  if (!palette.success) {
    throw new Error(`The palette from the server is invalid: ${zodErrorMessage(palette.error)}`);
  }
  return palette.data;
}

// Get the canvas size from the server. It does not change, so it is loaded once.
export async function getCanvasSize(): Promise<CanvasSize> {
  const response = await fetch('/api/canvas/size');
  check(response, 'Could not load the canvas size');
  const size = CanvasSizeSchema.safeParse(await response.json());
  if (!size.success) {
    throw new Error(`The canvas size from the server is invalid: ${zodErrorMessage(size.error)}`);
  }
  return size.data;
}

// Get all painted pixels of the canvas from the server
export async function getCanvas(): Promise<CanvasState> {
  const response = await fetch('/api/canvas');
  check(response, 'Could not load the canvas');
  const state = CanvasStateSchema.safeParse(await response.json());
  if (!state.success) {
    throw new Error(`The canvas from the server is invalid: ${zodErrorMessage(state.error)}`);
  }
  return state.data;
}

// Save one pixel on the server (pos = toPosition(size, x, y), colorIndex = palette color id)
export async function placePixel(pos: number, colorIndex: number) {
  const response = await fetch('/api/pixels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pos, colorIndex } satisfies PlacePixelRequest),
  });
  check(response, 'Could not place the pixel');
}
