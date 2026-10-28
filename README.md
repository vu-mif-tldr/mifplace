# mifplace

[![codecov](https://codecov.io/gh/vu-mif-tldr/mifplace/graph/badge.svg)](https://codecov.io/gh/vu-mif-tldr/mifplace)

r/place klonas benda pikselių drobė, kurioje kiekvienas gali idėti po vieną pikselį kas kelias minutes.

## Vietinis paleidimas

```
npm install
npm run setup   # sukuria backend/.env ir vietinę duomenų bazę
npm run dev     # backend (3000) ir frontend (5173) kartu
```

Reikia Node 24 (`nvm use`). Kitos komandos: `npm run check`, `npm run test:coverage`, `npm run clean`.

## GitHub Codespaces

Nieko nediegiant savo kompiuteryje: **Code → Codespaces → Create codespace on main**. Aplinka
(`.devcontainer/devcontainer.json`) pati įdiegia priklausomybes ir paleidžia `npm run setup`, lieka tik
`npm run dev`. Frontend (5173) atsidaro naršyklėje automatiškai. Codespaces valandos skaičiuojamos
kiekvienam asmeniškai, su GitHub Student Developer Pack jų pakanka; nenaudojamą codespace sustabdykite.

## Testų padengimas

CI kiekviename pull request paleidžia `npm run test:coverage` ir siunčia ataskaitas į
[Codecov](https://codecov.io/gh/vu-mif-tldr/mifplace) (nustatymai `codecov.yml`). Kol kas padengimas tik
rodomas ir sujungti netrukdo.

Diegimas į serverį: [deploy/README.md](deploy/README.md).

## Komandos nariai:

- Dmitrij Kosmakov
- Rokas Petronis
- Lukas Vielius
- Renatas Podberiozko
- Lukas Petkevicius
- Titas Mockevicius
