import { describe, expect, it } from 'vitest';
import {
  CanvasSizeSchema,
  CanvasStateSchema,
  PaletteSchema,
  PlacePixelRequestSchema,
  zodErrorMessage,
} from './api.js';

describe('PaletteSchema', () => {
  it('accepts a palette with unique ids and #rrggbb colors', () => {
    const palette = [
      { id: 0, color: '#000000' },
      { id: 5, color: '#FFFFFF' },
    ];
    expect(PaletteSchema.parse(palette)).toEqual(palette);
  });

  it.each([
    ['not a list', { id: 0, color: '#000000' }],
    ['an empty list', []],
    ['a plain list of colors', ['#000000']],
    ['a negative id', [{ id: -1, color: '#000000' }]],
    ['a non-integer id', [{ id: 1.5, color: '#000000' }]],
    [
      'a duplicate id',
      [
        { id: 1, color: '#000000' },
        { id: 1, color: '#ffffff' },
      ],
    ],
    ['a color that is not #rrggbb', [{ id: 0, color: 'red' }]],
  ])('rejects a palette with %s', (_case, data) => {
    expect(PaletteSchema.safeParse(data).success).toBe(false);
  });
});

describe('CanvasSizeSchema', () => {
  it('accepts positive integers only', () => {
    expect(CanvasSizeSchema.safeParse({ width: 128, height: 64 }).success).toBe(true);
    expect(CanvasSizeSchema.safeParse({ width: 0, height: 64 }).success).toBe(false);
    expect(CanvasSizeSchema.safeParse({ width: 1.5, height: 64 }).success).toBe(false);
    expect(CanvasSizeSchema.safeParse({ width: 128 }).success).toBe(false);
  });
});

describe('CanvasStateSchema', () => {
  const snapshot = { pixels: [5, 12, -1, -2, 5, -3], eventId: 102, timestamp: 1760000000000 };

  it('accepts a flat array of color ids with its checkpoint, negative is unpainted', () => {
    expect(CanvasStateSchema.safeParse(snapshot).success).toBe(true);
    expect(CanvasStateSchema.safeParse({ pixels: [], eventId: 0, timestamp: 0 }).success).toBe(
      true
    );
  });

  it('rejects a snapshot without a checkpoint or with something else than color ids', () => {
    expect(CanvasStateSchema.safeParse({ pixels: [5] }).success).toBe(false);
    expect(CanvasStateSchema.safeParse({ ...snapshot, eventId: -1 }).success).toBe(false);
    expect(CanvasStateSchema.safeParse({ ...snapshot, timestamp: 1.5 }).success).toBe(false);
    expect(CanvasStateSchema.safeParse({ ...snapshot, pixels: [[5, 2]] }).success).toBe(false);
    expect(CanvasStateSchema.safeParse({ ...snapshot, pixels: [0.5] }).success).toBe(false);
    expect(CanvasStateSchema.safeParse({}).success).toBe(false);
  });
});

describe('zodErrorMessage', () => {
  it('puts every failed field on one line with its path', () => {
    const result = PlacePixelRequestSchema.safeParse({ pos: 'a' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodErrorMessage(result.error)).toMatch(/^pos: .+; colorIndex: .+$/);
  });

  it('has no path prefix for a problem with the whole value', () => {
    const result = PlacePixelRequestSchema.safeParse(undefined);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodErrorMessage(result.error)).not.toMatch(/^: /);
  });
});
