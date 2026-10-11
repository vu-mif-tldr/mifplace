// DK: This script is still in development, it is not used in production. 
// It is only for development convenience, to fill the database with a known picture 
// for testing. 
// The script is not part of the application and may be removed or changed at any time.
// 
// Use this website to create a sprite and export it as a C array:
// https://www.piskelapp.com/p/create/sprite/
//
// Fills the events table with the pixels of a sprite exported as a C array
// (Piskel/Pixil "uint32_t data[1][W*H]", values 0xAABBGGRR, row by row).
// Usage: npm run db:seed:dev -- <pixil-frame-file.c> [offsetX] [offsetY]
// Settings (DB_PATH) come from the environment, then from .env, see .env.example.
//
// What it does:
// - Every pixel becomes one row in events: user_id = 0 (Test User), color_id,
//   position = y * canvas.width + x and a shared timestamp.
// - Everything runs in one transaction via MifDb.appendEvent.
// - Fully transparent pixels (alpha 0) are skipped.
// - If the file does not contain exactly 128 * 128 = 16384 values, the script stops.
//
// Things to be aware of:
// - Canvas size: the sprite is 128x128, but the canvas in 002_add_canvas.sql is
//   256x256. By default the sprite goes to the top left corner. The position is
//   computed with the canvas width from the DB, not 128, otherwise the picture
//   would be skewed. Pass an offset (e.g. 64 64) to center the sprite.
// - Palette: palette has 8 colors and COLOR_COUNT in db.ts is 16. Colors of the
//   sprite missing from the palette are added to it (INSERT OR IGNORE). If the
//   sprite has more than 16 colors, the application may reject the extra ones.
//   If the palette must stay fixed, map the colors to the nearest palette color.
// - Channel order: 0xAABBGGRR is assumed, as in Piskel. If red and blue look
//   swapped on the picture, swap r and b below.
// - Re-running: events is append-only, so a second run inserts duplicates.
//   Recreate the database before running the script again.
import * as fs from "node:fs";
import { MifDb, openDb, resolveDbPath } from "../db.js";
import { loadDotEnv } from "../env.js";

const SPRITE_WIDTH = 128;
const SPRITE_HEIGHT = 128;
const SEED_USER_ID = 0;

const [file, offsetXArg = "0", offsetYArg = "0"] = process.argv.slice(2);
if (!file) {
    console.error("Usage: seed-events <sprite.h> [offsetX] [offsetY]");
    process.exit(1);
}
const offsetX = Number(offsetXArg);
const offsetY = Number(offsetYArg);

const text = fs.readFileSync(file, "utf8");
// Only the data part, so numbers in the header are not picked up.
const tokens = text.slice(text.indexOf("_data")).match(/0x[0-9a-fA-F]{8}/g) ?? [];
if (tokens.length !== SPRITE_WIDTH * SPRITE_HEIGHT) {
    console.error(`Expected ${SPRITE_WIDTH * SPRITE_HEIGHT} pixels, found ${tokens.length}`);
    process.exit(1);
}

loadDotEnv(".env");
const db = openDb(resolveDbPath());

try {
    const canvas = db.prepare(`SELECT width, height FROM canvas`).get() as { width: number; height: number };
    if (offsetX < 0 || offsetY < 0 || offsetX + SPRITE_WIDTH > canvas.width || offsetY + SPRITE_HEIGHT > canvas.height) {
        throw new Error(`Sprite does not fit the ${canvas.width}x${canvas.height} canvas at offset ${offsetX},${offsetY}`);
    }

    const insertColor = db.prepare(`INSERT OR IGNORE INTO palette (text) VALUES (?)`);
    const selectColor = db.prepare(`SELECT color_id FROM palette WHERE text = ?`);
    const colorIds = new Map<string, number>();
    const colorId = (hex: string): number => {
        let id = colorIds.get(hex);
        if (id === undefined) {
            insertColor.run(hex);
            id = (selectColor.get(hex) as { color_id: number }).color_id;
            colorIds.set(hex, id);
        }
        return id;
    };

    const mif = new MifDb(db);
    const now = Date.now();
    let inserted = 0;

    db.transaction(() => {
        tokens.forEach((token, i) => {
            const value = parseInt(token, 16);
            if (value >>> 24 === 0) return; // transparent

            const r = value & 255;
            const g = (value >>> 8) & 255;
            const b = (value >>> 16) & 255;
            const hex = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();

            const x = offsetX + (i % SPRITE_WIDTH);
            const y = offsetY + Math.floor(i / SPRITE_WIDTH);
            mif.appendEvent({ user_id: SEED_USER_ID, color_id: colorId(hex), position: y * canvas.width + x }, now);
            inserted++;
        });
    })();

    console.log(`Inserted ${inserted} events, ${colorIds.size} distinct colors`);
} finally {
    db.close();
}
