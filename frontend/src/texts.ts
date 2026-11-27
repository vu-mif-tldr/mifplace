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
  signOut: 'Atsijungti',
};

// The sign-in, registration and password screens (components/AuthScreen.vue)
export const authTexts = {
  about: 'Bendra Vilniaus universiteto drobė, piešiama po vieną pikselį.',
  email: 'VU el. paštas',
  emailExample: 'vardas.pavarde@mif.stud.vu.lt',
  password: 'Slaptažodis',
  newPassword: 'Naujas slaptažodis',
  passwordHint: 'Bent 10 simbolių',
  repeatPassword: 'Pakartok slaptažodį',

  signInTitle: 'Prisijunk',
  signIn: 'Prisijungti',
  toRegister: 'Neturi paskyros? Registruokis',
  forgot: 'Pamiršai slaptažodį?',

  registerTitle: 'Registracija',
  register: 'Registruotis',
  toSignIn: 'Jau turi paskyrą? Prisijunk',

  forgotTitle: 'Pamiršai slaptažodį?',
  forgotLead: 'Įvesk savo el. paštą: atsiųsime nuorodą naujam slaptažodžiui nustatyti.',
  sendLink: 'Siųsti nuorodą',
  backToSignIn: 'Grįžti į prisijungimą',

  checkEmailTitle: 'Patikrink el. paštą',
  registeredLead: (email: string) =>
    `Išsiuntėme laišką adresu ${email}. Atidaryk jame esančią nuorodą: ji galioja 24 valandas.`,
  forgotSentLead: (email: string) =>
    `Jei adresas ${email} turi paskyrą, išsiuntėme jam nuorodą. Ji galioja 1 valandą.`,
  noEmail: 'Laiško nėra? Pažiūrėk šlamšto aplanke.',

  verifyTitle: 'Patvirtink el. paštą',
  verifyLead: 'Liko vienas žingsnis: patvirtink, kad šis el. pašto adresas yra tavo.',
  verify: 'Patvirtinti adresą',
  verified: 'Adresas patvirtintas. Dabar prisijunk.',
  verifyExpired:
    'Ši nuoroda nebegalioja arba jau panaudota. Jei adresas dar nepatvirtintas, registruokis iš naujo.',

  resetTitle: 'Nustatyk naują slaptažodį',
  savePassword: 'Išsaugoti slaptažodį',
  resetDone: 'Slaptažodis pakeistas. Prisijunk su naujuoju.',
  resetExpired: 'Ši nuoroda nebegalioja arba jau panaudota. Paprašyk naujos.',

  invalidEmail: 'Įvesk el. pašto adresą.',
  noPassword: 'Įvesk slaptažodį.',
  shortPassword: 'Slaptažodis turi būti bent 10 simbolių.',
  longPassword: 'Slaptažodis per ilgas: daugiausia 128 simboliai.',
  passwordsDiffer: 'Slaptažodžiai nesutampa.',
};

// What to say when an account request fails, by the code of the answer (auth.ts). The English
// text of the server is for developers and is not shown.
const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: 'Neteisingas el. paštas arba slaptažodis.',
  email_not_verified: 'El. paštas dar nepatvirtintas. Atidaryk nuorodą iš mūsų laiško.',
  banned: 'Ši paskyra užblokuota.',
  too_many_attempts: 'Per daug neteisingų bandymų. Pabandyk po 15 minučių.',
  rate_limited: 'Per daug užklausų iš tavo tinklo. Pabandyk vėliau.',
  email_not_allowed:
    'Registruotis galima tik su VU el. paštu (pvz., vardas.pavarde@mif.stud.vu.lt), be „+“ ženklo adrese.',
  mail_unavailable: 'Šiuo metu negalime išsiųsti laiško. Pabandyk po valandos.',
  busy: 'Serveris užimtas. Pabandyk dar kartą po akimirkos.',
  network: 'Nepavyko pasiekti serverio. Patikrink interneto ryšį.',
};

export function authError(code: string): string {
  return AUTH_ERRORS[code] ?? 'Kažkas nepavyko. Pabandyk dar kartą.';
}

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
