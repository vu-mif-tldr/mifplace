import { DatabaseSync } from 'node:sqlite';

export interface Placement {
  id: number;
  userId: string;
  x: number;
  y: number;
  color: string;
  placedAt: number;
}

export interface PixelServiceOptions {
  width: number;
  height: number;
  cooldownMs: number;
}

export class CooldownError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Cooldown active');
  }
}

export class ValidationError extends Error {}

export class PixelService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly options: PixelServiceOptions,
  ) {
    this.setup();
  }

  private setup(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        last_placed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pixels (
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        color TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (x, y)
      );

      CREATE TABLE IF NOT EXISTS placements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        color TEXT NOT NULL,
        placed_at INTEGER NOT NULL
      );
    `);
  }

  placePixel(userId: string, x: number, y: number, color: string, now = Date.now()): Placement {
    this.validatePlacement(userId, x, y, color);

    const lastPlacement = this.db
      .prepare('SELECT last_placed_at as lastPlacedAt FROM users WHERE user_id = ?')
      .get(userId) as { lastPlacedAt?: number } | undefined;

    if (lastPlacement?.lastPlacedAt !== undefined) {
      const retryAfterMs = this.options.cooldownMs - (now - lastPlacement.lastPlacedAt);
      if (retryAfterMs > 0) {
        throw new CooldownError(retryAfterMs);
      }
    }

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO users(user_id, last_placed_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_placed_at = excluded.last_placed_at')
        .run(userId, now);

      this.db
        .prepare('INSERT INTO pixels(x, y, color, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at')
        .run(x, y, color, now);

      this.db
        .prepare('INSERT INTO placements(user_id, x, y, color, placed_at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, x, y, color, now);

      const inserted = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number };
      this.db.exec('COMMIT');

      return { id: inserted.id, userId, x, y, color, placedAt: now };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getCanvas(): { width: number; height: number; pixels: Array<{ x: number; y: number; color: string }> } {
    const pixels = this.db
      .prepare('SELECT x, y, color FROM pixels ORDER BY y ASC, x ASC')
      .all() as Array<{ x: number; y: number; color: string }>;

    return {
      width: this.options.width,
      height: this.options.height,
      pixels,
    };
  }

  getTimelapse(): Placement[] {
    const rows = this.db
      .prepare(
        'SELECT id, user_id as userId, x, y, color, placed_at as placedAt FROM placements ORDER BY id ASC',
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      userId: String(row.userId),
      x: Number(row.x),
      y: Number(row.y),
      color: String(row.color),
      placedAt: Number(row.placedAt),
    }));
  }

  private validatePlacement(userId: string, x: number, y: number, color: string): void {
    if (!userId.trim()) {
      throw new ValidationError('userId is required');
    }

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new ValidationError('x and y must be integers');
    }

    if (x < 0 || x >= this.options.width || y < 0 || y >= this.options.height) {
      throw new ValidationError('x/y out of bounds');
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new ValidationError('color must be a hex value like #RRGGBB');
    }
  }
}
