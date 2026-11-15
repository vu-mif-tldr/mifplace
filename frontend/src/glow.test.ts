import { INK, NEUTRAL_GLOW, glowColor, luma, readableOn } from './glow';

describe('luma', () => {
  it('is 0 for black and 255 for white', () => {
    expect(luma('#000000')).toBe(0);
    expect(luma('#FFFFFF')).toBe(255);
  });

  it('is null for anything but #RRGGBB', () => {
    expect(luma('red')).toBeNull();
    expect(luma('#fff')).toBeNull();
  });
});

describe('glowColor', () => {
  it('lights the page with a bright selected colour', () => {
    expect(glowColor('#00A2E8')).toBe('#00a2e8');
    expect(glowColor('#FFF200')).toBe('#fff200');
  });

  it('uses the neutral light for dark colours, nothing selected or a bad value', () => {
    expect(glowColor('#000000')).toBe(NEUTRAL_GLOW);
    expect(glowColor('#3F48CC')).toBe('#3f48cc');
    expect(glowColor('#880015')).toBe(NEUTRAL_GLOW);
    expect(glowColor(undefined)).toBe(NEUTRAL_GLOW);
    expect(glowColor('blue')).toBe(NEUTRAL_GLOW);
  });
});

describe('readableOn', () => {
  it('puts dark text on light colours and white text on dark ones', () => {
    expect(readableOn('#FFF200')).toBe(INK);
    expect(readableOn('#3F48CC')).toBe('#ffffff');
    expect(readableOn('nonsense')).toBe('#ffffff');
  });
});
