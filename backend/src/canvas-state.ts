import type { CanvasSize, Pixel } from './db.js';

// Current state of the canvas, kept in memory so that GET /api/canvas does not touch the database.
// Built once at server start from the database; every event appended later must also go through
// set(), otherwise the state goes stale. Only one server process may write to the database.
export class CanvasState {
  private readonly cells = new Map<number, number>();
  // Serialized response, dropped on every change and rebuilt on the next read.
  private json: string | undefined;

  constructor(
    private readonly size: CanvasSize,
    painted: Pixel[]
  ) {
    for (const p of painted) this.cells.set(p.position, p.color_id);
  }

  // Positions are validated before an event is appended, there is no bounds check here.
  setCell(position: number, colorId: number): void {
    this.cells.set(position, colorId);
    this.json = undefined;
  }

  // Body of GET /api/canvas: { width, height, position, color_id }. Only painted cells are
  // listed, as two parallel arrays (position[i] is painted with color_id[i]). Arrays instead of
  // an array of objects: ~3x smaller and much faster to parse, see MP-63.
  toJson(): string {
    if (this.json === undefined) {
      const position = Array.from(this.cells.keys());
      const color_id = Array.from(this.cells.values());
      this.json = JSON.stringify({ ...this.size, position, color_id });
    }
    return this.json;
  }
}
