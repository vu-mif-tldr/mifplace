import { authError, authTexts, colorName, texts } from './texts';

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

describe('authTexts', () => {
  it('puts the address into the messages about emails', () => {
    expect(authTexts.registeredLead('ona@vu.lt')).toContain('ona@vu.lt');
    expect(authTexts.forgotSentLead('ona@vu.lt')).toContain('ona@vu.lt');
  });
});

describe('authError', () => {
  it('has its own words for the failures a visitor can do something about', () => {
    const general = authError('internal');
    for (const code of [
      'invalid_credentials',
      'email_not_verified',
      'banned',
      'too_many_attempts',
      'rate_limited',
      'email_not_allowed',
      'mail_unavailable',
      'busy',
      'network',
    ]) {
      expect(authError(code), code).not.toBe(general);
    }
    expect(authError('something new')).toBe(general);
  });
});
