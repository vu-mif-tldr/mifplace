# mifplace: reikalavimai

Versija: 0.1 (juodraštis)

## Žymėjimai

Prioritetai pagal MoSCoW:

- **M** (Must / būtina)
- **S** (Should / pageidautina)
- **C** (Could / galima)
- **W** (Won't have / šiame semestre nebus įgyvendinta)

Būsenos: **Pasiūlyta** → **Suderinta** → **Įgyvendinta** → **Patikrinta** (arba **Atšaukta**).

Taisyklės:

- ID niekada nekeičiami ir nenaudojami pakartotinai. Atšauktas reikalavimas lieka sąraše su būsena „Atšaukta“ ir priežastimi.
- Vienas reikalavimas — viena patikrinama mintis.
- Užduotys GitHub Issues nurodo reikalavimo ID pavadinime, pvz. `[FR-8] Pauzės tikrinimas serveryje`.

## Funkciniai reikalavimai

### Prisijungimas ir prieiga

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-1 | Naudotojas prisijungia per VU paskyrą (Microsoft Entra ID) | M | Pasiūlyta |
| FR-2 | Paprasta registracija: leidžiamų el. pašto domenų sąrašas nustatomas konfigūracijoje | M | Pasiūlyta |
| FR-3 | Neprisijungusiam naudotojui drobė prieinama tik peržiūrai | S | Pasiūlyta |
| FR-4 | Naudotojas gali atsijungti | S | Pasiūlyta |

### Drobė

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-5 | Drobės dydis D×D, paletė iš K fiksuotų spalvų (žr. atvirus klausimus) | M | Pasiūlyta |
| FR-6 | Drobę galima priartinti, nutolinti ir slinkti pele bei gestais jutikliniame ekrane | M | Pasiūlyta |
| FR-7 | Naudotojas pasirenka pikselį ir spalvą, tada patvirtina padėjimą | M | Pasiūlyta |
| FR-8 | Tarp padėjimų taikoma N minučių pauzė; serveris atmeta bandymus anksčiau laiko. N konfigūruojamas ir gali būti keičiamas veikimo metu | M | Pasiūlyta |
| FR-9 | Kitų naudotojų pakeitimai matomi neperkraunant puslapio | M | Pasiūlyta |
| FR-10 | Padėjęs pikselį naudotojas mato laikmatį iki kito galimo padėjimo | S | Pasiūlyta |
| FR-11 | Rodomos pikselio po žymekliu koordinatės | S | Pasiūlyta |
| FR-12 | Paspaudus ant pikselio matomas paskutinio jo pakeitimo laikas | C | Pasiūlyta |

### Moderavimas

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-13 | Administratorius gali užblokuoti naudotoją | M | Pasiūlyta |
| FR-14 | Administratorius gali keisti drobės pikselius (vieną arba kelis) be pauzės | M | Pasiūlyta |
| FR-15 | Administratorius gali atkurti stačiakampės srities būseną pasirinktu laiko momentu | S | Pasiūlyta |
| FR-16 | Administratorius gali keisti pauzės trukmę neperkraudamas serverio | S | Pasiūlyta |
| FR-17 | Administratoriaus puslapis, kuriame galima užblokuoti naudotoją, atšaukti pakeitimus ir užrakinti drobės sritį | S | Pasiūlyta |
| FR-18 | Naudotojas gali pranešti apie netinkamą drobės sritį | C | Pasiūlyta |

### Žurnalas ir timelapse

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-19 | Kiekvienas padėjimas įrašomas į žurnalą: koordinatės, spalva, naudotojas, laikas | M | Pasiūlyta |
| FR-20 | Iš žurnalo generuojamas timelapse vaizdo įrašas už bet kurį laikotarpį | M | Pasiūlyta |
| FR-21 | Serveris saugo, kas ir kada pakeitė pikselį | S | Atšaukta - FR-19 dublis |
| FR-22 | Nustatytą dieną drobė užšaldoma ir pikselių dėti nebegalima | S | Pasiūlyta |
| FR-23 | Galutinę drobę ir timelapse galima atsisiųsti svetainėje | C | Pasiūlyta |

### Papildomos funkcijos

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-24 | Statistika: aktyviausi naudotojai, šiandien pakeistų pikselių skaičius, populiariausios spalvos, aktyviausios valandos ir pan. | C | Pasiūlyta |
| FR-25 | Komandos / grupės: naudotojai gali susikurti komandą ir piešti kartu; statistikoje rodomas komandų indėlis | C | Pasiūlyta |

### Kita

| ID | Reikalavimas | Pr. | Būsena |
|----|--------------|-----|--------|
| FR-26 | Svetainėje yra taisyklės ir privatumo politika, prieinamos ir neprisijungus | M | Pasiūlyta |

## Nefunkciniai reikalavimai

| ID | Kategorija | Reikalavimas | Būsena |
|----|------------|--------------|--------|
| NFR-1 | Našumas | Padėtas pikselis kitiems naudotojams matomas ne vėliau kaip po 5 s (p95) | Pasiūlyta |
| NFR-2 | Našumas | Pradinis drobės įkėlimas mobiliuoju 5G ryšiu trunka ne ilgiau kaip 5 s | Pasiūlyta |
| NFR-3 | Plečiamumas | Sistema atlaiko 500 vienalaikių prisijungimų ir 25 padėjimus per sekundę; tai patvirtinama apkrovos testu | Pasiūlyta |
| NFR-4 | Patikimumas | Patvirtintas padėjimas neprarandamas: jis įrašomas į žurnalą prieš atsakant klientui | Pasiūlyta |
| NFR-5 | Patikimumas | Kasdienė atsarginė kopija saugoma už serverio ribų; atkūrimas patikrintas bent kartą prieš paleidimą | Pasiūlyta |
| NFR-6 | Pasiekiamumas | Paslauga veikia visą parą visą semestrą | Pasiūlyta |
| NFR-7 | Pasiekiamumas | Nutrūkus ryšiui klientas pats prisijungia iš naujo ir nepraranda pakeitimų | Pasiūlyta |
| NFR-8 | Saugumas | Teisės, pauzė ir blokavimai tikrinami kliento pusėje, po to serveryje | Pasiūlyta |
| NFR-9 | Saugumas | Naudojamas HTTPS | Pasiūlyta |
| NFR-10 | Saugumas | Vienam naudotojui ribojamas užklausų ir prisijungimų skaičius | Pasiūlyta |
| NFR-11 | Privatumas | Pikselių autorystė viešai neskelbiama | Pasiūlyta |
| NFR-12 | Privatumas | Sistema atitinka BDAR (GDPR) reikalavimus | Pasiūlyta |
| NFR-13 | Suderinamumas | Veikia naujausiose Chrome, Firefox ir Safari versijose, įskaitant mobiliąsias | Pasiūlyta |
| NFR-14 | Lokalizacija | Sąsaja lietuvių ir anglų kalbomis | Pasiūlyta |
| NFR-15 | Kaštai | Infrastruktūros išlaidos neviršija 10 € per mėnesį | Pasiūlyta |

## Apribojimai

- Viešas paleidimas iki lapkričio vidurio.
- Ribotas biudžetas.

## Atviri klausimai

1. Drobės dydis D ir spalvų skaičius K? Ar drobės išdėstymas dinamiškas (FR-5)?
2. Kokia pradinė pauzės trukmė N (FR-8)?
3. Ar dalyvauja tik MIF, ar visas VU? Ar leidžiami dėstytojai (FR-2)?
4. Ar leidžiami botai ir skriptai?
5. Ar statistika (FR-24) neprieštarauja autorystės neskelbimui (NFR-11)?

## Pakeitimų žurnalas

| Versija | Data | Pakeitimai |
|---------|------|------------|
| 0.1 | 2026-10-03 | Pirmasis juodraštis |
