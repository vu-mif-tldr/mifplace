import { describe, expect, it } from 'vitest';
import { VuEmailSchema, WaitlistTokenRequestSchema, isVuEmail } from './waitlist.js';

describe('isVuEmail', () => {
  it('accepts vu.lt and its subdomains only', () => {
    expect(isVuEmail('a@vu.lt')).toBe(true);
    expect(isVuEmail('a@mif.stud.vu.lt')).toBe(true);
    expect(isVuEmail('a@MIF.VU.LT')).toBe(true);
    expect(isVuEmail('a@notvu.lt')).toBe(false);
    expect(isVuEmail('a@vu.lt.evil.com')).toBe(false);
    expect(isVuEmail('a@gmail.com')).toBe(false);
    expect(isVuEmail('vu.lt')).toBe(false);
  });
});

describe('VuEmailSchema', () => {
  it('trims and lower-cases the address', () => {
    expect(VuEmailSchema.parse('  Jonas.Jonaitis@MIF.stud.vu.lt ')).toBe(
      'jonas.jonaitis@mif.stud.vu.lt'
    );
  });

  it('rejects other domains and broken addresses', () => {
    expect(VuEmailSchema.safeParse('a@gmail.com').success).toBe(false);
    expect(VuEmailSchema.safeParse('a@b@vu.lt').success).toBe(false);
    expect(VuEmailSchema.safeParse('@vu.lt').success).toBe(false);
    expect(VuEmailSchema.safeParse('').success).toBe(false);
    expect(VuEmailSchema.safeParse(`${'a'.repeat(250)}@vu.lt`).success).toBe(false);
    expect(VuEmailSchema.safeParse(42).success).toBe(false);
  });
});

describe('WaitlistTokenRequestSchema', () => {
  it('accepts base64url tokens only', () => {
    expect(WaitlistTokenRequestSchema.safeParse({ token: 'A'.repeat(43) }).success).toBe(true);
    expect(WaitlistTokenRequestSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(WaitlistTokenRequestSchema.safeParse({ token: `${'A'.repeat(42)}=` }).success).toBe(
      false
    );
    expect(WaitlistTokenRequestSchema.safeParse({}).success).toBe(false);
  });
});
