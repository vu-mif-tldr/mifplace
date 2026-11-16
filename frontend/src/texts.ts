// Every text of the canvas page in one place, so the Lithuanian can be proofread and the
// English version (NFR-14) added next to it later.

export const texts = {
  loading: 'Kraunama drobė…',
  loadFailed: 'Nepavyko užkrauti drobės',
  loadFailedHint: 'Patikrink interneto ryšį ir bandyk dar kartą.',
  retry: 'Bandyti dar kartą',
  placeFailed: 'Pikselio padėti nepavyko. Bandyk dar kartą.',
  live: 'Gyvai',
  connecting: 'Jungiamasi…',
  reconnecting: 'Ryšys nutrūko, jungiamasi iš naujo…',
  pickCell: 'Spustelk drobę ten, kur nori piešti',
  confirmHint: (color: string, x: number, y: number) =>
    `${color} į (${x}, ${y}). Spustelk žiedą dar kartą, mygtuką arba Enter.`,
  place: (x: number, y: number) => `Dėti pikselį į (${x}, ${y})`,
  placeNothing: 'Pirma pasirink langelį',
  coordinates: (x: number, y: number) => `${x}, ${y}`,
  newPixels: (count: number) => `+${count}`,
  quiet: 'Dabar ramu...',
};

// Names of the colours of the default palette. The palette comes from the server, so a colour
// without a name here is called by its code.
const COLOR_NAMES: Record<string, string> = {
  '#000000': 'Juoda',
  '#FFFFFF': 'Balta',
  '#7F7F7F': 'Pilka',
  '#C3C3C3': 'Šviesiai pilka',
  '#880015': 'Vyšninė',
  '#ED1C24': 'Raudona',
  '#FF7F27': 'Oranžinė',
  '#FFF200': 'Geltona',
  '#22B14C': 'Žalia',
  '#00A2E8': 'Žydra',
  '#3F48CC': 'Mėlyna',
  '#A349A4': 'Violetinė',
  '#B97A57': 'Ruda',
  '#FFAEC9': 'Rožinė',
  '#FFC90E': 'Auksinė',
  '#99D9EA': 'Šviesiai žydra',
};

export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toUpperCase()] ?? hex.toUpperCase();
}
