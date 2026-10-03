import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CooldownError, PixelService } from '../src/pixelService.js';

function createService(cooldownMs = 300_000): PixelService {
  const db = new DatabaseSync(':memory:');
  return new PixelService(db, {
    width: 10,
    height: 10,
    cooldownMs,
  });
}

test('places a pixel and stores it in canvas and timelapse', () => {
  const service = createService();

  const placed = service.placePixel('student-1', 2, 3, '#AABBCC', 1_000);

  assert.equal(placed.userId, 'student-1');
  assert.equal(service.getCanvas().pixels.length, 1);
  assert.equal(service.getCanvas().pixels[0].color, '#AABBCC');
  assert.equal(service.getTimelapse().length, 1);
});

test('enforces per-user cooldown', () => {
  const service = createService(1_000);

  service.placePixel('student-1', 2, 3, '#AABBCC', 10_000);

  assert.throws(() => service.placePixel('student-1', 1, 1, '#112233', 10_500), (error) => {
    assert.ok(error instanceof CooldownError);
    assert.equal(error.retryAfterMs, 500);
    return true;
  });
});

