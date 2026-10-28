# mifplace

[![codecov](https://codecov.io/gh/vu-mif-tldr/mifplace/graph/badge.svg)](https://codecov.io/gh/vu-mif-tldr/mifplace)

r/place klonas benda pikselių drobė, kurioje kiekvienas gali idėti po vieną pikselį kas kelias minutes.

## Vietinis paleidimas

```bash
npm install
npm run setup   # sukuria backend/.env ir vietinę duomenų bazę
npm run dev     # backend (3000) ir frontend (5173) kartu
```

Reikia Node 24 (`nvm use`). Kitos komandos: `npm run check`, `npm run test:coverage`, `npm run clean`.

MCP serveris (Claude Code): `npm run setup:mcp` sukuria `.mcp.json` iš `.mcp.json.example` su šio katalogo keliais.

Diegimas į serverį: [deploy/README.md](deploy/README.md).

### Kitas drobės dydis

Drobės dydis saugomas duomenų bazės lentelėje `canvas` (numatytasis 128×128). Serveris jį nuskaito
paleidžiamas, puslapis – atsidarydamas, todėl pakeitus dydį reikia perkrauti abu. Dydį keiskite tik
naujoje duomenų bazėje: pikselio vieta saugoma kaip `y * width + x`, todėl pakeitus jau naudojamos
drobės dydį padėti pikseliai pasislinktų. Plotis ir aukštis turi būti teigiami sveikieji skaičiai.

Atskira duomenų bazė, pvz. 200×100 (pagrindinė `backend/data/mifplace.db` lieka nepaliesta;
santykinis `DB_PATH` skaičiuojamas nuo `backend/`):

```bash
export DB_PATH=./data/canvas-200x100.db
npm run db:setup:dev -w backend
npm exec -w backend -- node -e "require('better-sqlite3')(process.env.DB_PATH).prepare('UPDATE canvas SET width = ?, height = ?').run(200, 100)"
npm run dev
```

`DB_PATH` aplinkos kintamasis turi pirmenybę prieš `backend/.env`, todėl tame pačiame terminale
`npm run dev` naudoja naują bazę. Kitame terminale (be `DB_PATH`) vėl naudojama pagrindinė.

## GitHub Codespaces

Nieko nediegiant savo kompiuteryje: **Code → Codespaces → Create codespace on main**. Aplinka
(`.devcontainer/devcontainer.json`) pati įdiegia priklausomybes ir paleidžia `npm run setup`, lieka tik
`npm run dev`. Frontend (5173) atsidaro naršyklėje automatiškai. Codespaces valandos skaičiuojamos
kiekvienam asmeniškai, su GitHub Student Developer Pack jų pakanka; nenaudojamą codespace sustabdykite.

## Testų padengimas

CI kiekviename pull request paleidžia `npm run test:coverage` ir siunčia ataskaitas į
[Codecov](https://codecov.io/gh/vu-mif-tldr/mifplace) (nustatymai `codecov.yml`). Kol kas padengimas tik
rodomas ir sujungti netrukdo.

CI taip pat siunčia testų rezultatus (JUnit) į Codecov Test Analytics: pull request matyti, kurie testai
nepavyko, o laikui bėgant ir kurie testai nestabilūs ar lėti.

## Komandos nariai

- Dmitrij Kosmakov
- Rokas Petronis
- Lukas Vielius
- Renatas Podberiozko
- Lukas Petkevicius
- Titas Mockevicius
