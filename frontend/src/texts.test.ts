import { colorName, texts } from './texts';

describe('colorName', () => {
  it('names the colours of the default palette, whatever the case', () => {
    expect(colorName('#00A2E8')).toBe('Žydra');
    expect(colorName('#00a2e8')).toBe('Žydra');
  });

  it('falls back to the code for a colour it does not know', () => {
    expect(colorName('#123abc')).toBe('#123ABC');
  });
});

describe('texts', () => {
  it('puts the colour and the cell into the hints', () => {
    expect(texts.confirmHint('Žydra', 4, 7)).toContain('Žydra į (4, 7)');
    expect(texts.place(4, 7)).toBe('Dėti pikselį į (4, 7)');
    expect(texts.coordinates(4, 7)).toBe('4, 7');
  });
});
