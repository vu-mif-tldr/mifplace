import { PALETTE } from './palette';

describe('PALETTE', () => {
  it('has 16 colours', () => {
    expect(PALETTE).toHaveLength(16);
  });

  it('contains only #rrggbb values', () => {
    for (const color of PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has no duplicates, so colour index identifies a colour', () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});
