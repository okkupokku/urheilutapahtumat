// Hakee jääkiekon Mestiksen (miesten toiseksi ylin sarjataso) K-Vantaan
// kotiottelut mestis.fi:n otteluohjelmasta.
//
// Tausta: Leijonien virallinen tulospalvelu (tulospalvelu.leijonat.fi) on
// CloudFront/WAF-suojattu ja torjuu GitHub Actionsin IP-osoitteet HTTP
// 403:lla (ks. CLAUDE.md "Tunnetut infrarajoitukset") - tätä ei voi korjata
// koodilla. Käyttäjä löysi kuitenkin mestis.fi:n, joka on eri, avoin
// palvelu samalle sarjalle eikä ole IP-estetty.
//
// Sivu on palvelinrenderöity HTML (ei JSON-rajapintaa, ei CORS-headeria eli
// suora selainhaku toiselta origin:lta ei toimisi). Jokainen ottelurivi on
// <tr data-time="YYYYMMDD"> jonka sisällä on ottelulinkki muotoa
// "Koti - Vieras" sekä aika (<td class="h-l">HH:MM</td>). Otteluohjelma
// listaa KAIKKI kauden ottelut yhdellä sivulla, joten päiväkohtaista hakua
// ei tarvita (sama periaate kuin jääpallon seurat.php-sivuilla).
//
// PK-seudulla on vain yksi Mestis-joukkue: K-Vantaa (Kiekko-Vantaa),
// kotihalli "Läntinen Valkoisenlähteentie 52-54, 01300 Vantaa" (osoite
// vahvistettu mestis.fi:n joukkuesivulta). Koordinaatit ovat manuaalisesti
// haettuja likiarvoja, eivät rajapinnasta.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCHEDULE_URL = 'https://mestis.fi/fi/ottelut/2026-2027/runkosarja/';
const PK_TEAM = 'K-Vantaa';
const PK_VENUE = { city: 'Vantaa', lat: 60.2710, lon: 24.8360 };

// Joukkuelogot (2026-09-27, käyttäjän löytämä puute - "kaikkia logoja ei
// löydy... ainakin Mestis"). Otteluohjelman <tr>-rivit sisältävät VAIN
// tekstin (ei <img>-tageja lainkaan, vahvistettu tarkistamalla oikea HTML),
// joten logoja ei voi purkaa ottelukohtaisesti samasta kohdasta kuin muut
// kentät - sen sijaan sivun ylälaidan "team-logos"-lohko listaa kaikkien
// 9 Mestis-joukkueen logot kertaalleen. Mestiksen joukkuejoukko on pieni ja
// vaihtuu harvoin, joten käsin kirjoitettu nimi->URL-taulukko on
// yksinkertaisempi ja luotettavampi kuin yritys purkaa se ottelutaulukosta.
// Tiedostonimien hash-pätkät (esim. .v3d7af107) ovat sivuston oman
// build-prosessin cache-busting-versioita - voivat teoriassa muuttua jos
// mestis.fi julkaisee uuden version, jolloin kuva vain katoaa hiljaa
// (crestImg()'s onerror poistaa rikkoutuneen <img>:n, ei riko mitään).
const TEAM_CRESTS = {
  'Hermes': 'https://mestis.fi/static/liiga/common/img/team-logos/hermes.vc0382e5a.png',
  'IPK': 'https://mestis.fi/static/liiga/common/img/team-logos/ipk.va9ad0be6.png',
  'JoKP': 'https://mestis.fi/static/liiga/common/img/team-logos/kiekko-pojat.v2e6af7bf.png',
  'K-Vantaa': 'https://mestis.fi/static/liiga/common/img/team-logos/kiekko-vantaa.v3d7af107.png',
  'Ketterä': 'https://mestis.fi/static/liiga/common/img/team-logos/kettera.v7d3a6faa.png',
  'KeuPa HT': 'https://mestis.fi/static/liiga/common/img/team-logos/keupa.vfa36865d.png',
  'Pyry': 'https://mestis.fi/static/liiga/common/img/team-logos/pyry.v43fa5859.png',
  'RoKi': 'https://mestis.fi/static/liiga/common/img/team-logos/roki_new.v364bd5ec.png',
  'TUTO Hockey': 'https://mestis.fi/static/liiga/common/img/team-logos/tuto.v00912d18.png',
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// HUOM: Playwrightin page.content() serialisoi DOM:in, jolloin lainausmerkit
// normalisoituvat aina kaksoislainausmerkeiksi - regexit hyväksyvät siksi
// molemmat ["'] samaan tapaan kuin scripts/fetch-jaapallo.js:ssä.
function extractMatches(html) {
  const rows = [...html.matchAll(/<tr data-time=["'](\d{8})["']>([\s\S]*?)<\/tr>/g)];
  return rows.map(r => {
    const d8 = r[1];
    const chunk = r[2];
    const idMatch = chunk.match(/runkosarja\/(\d+)\//);
    const timeMatch = chunk.match(/<td class=["']h-l["']>\s*([\d:]+)\s*<\/td>/);
    // Erottimena käytetään välilyöntien ympäröimää "-" -merkkiä, koska
    // joukkuenimet itsessään voivat sisältää kenoviivan ilman välilyöntiä
    // (esim. "K-Vantaa") - se ei siis saa täyttää \s+-\s+-ehtoa.
    const teamsMatch = chunk.match(/<a href=["'][^"']*["']>\s*([^<]*?)\s+-\s+([^<]*?)\s*<\/a>/);
    return {
      id: idMatch ? idMatch[1] : null,
      date: `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`,
      time: timeMatch ? timeMatch[1] : '',
      home: teamsMatch ? teamsMatch[1].trim() : null,
      away: teamsMatch ? teamsMatch[2].trim() : null,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = todayISO(0);
  const allMatches = [];

  try {
    await page.goto(SCHEDULE_URL, { waitUntil: 'domcontentloaded' });
    const html = await page.content();
    const matches = extractMatches(html);
    let matched = 0;
    for (const m of matches) {
      if (!m.id || !m.home || !m.away) continue;
      if (m.date < today) continue; // koko loppukausi mukaan, ei enää yläikkunaa
      // Vain K-Vantaan KOTIOTTELUT ovat PK-seudulla - vierasottelut
      // pelataan muiden joukkueiden kotikaupungeissa (Kokkola, Iisalmi,
      // Joensuu, Imatra, Jyväskylä, Kemi/Tornio, Rovaniemi, Turku).
      if (m.home !== PK_TEAM) continue;
      allMatches.push({
        date: m.date,
        time: m.time || '',
        sport: 'Jääkiekko',
        category: 'Mestis',
        categoryId: 'Mestis',
        genderGroup: 'Miehet',
        level: 'alempi',
        teamA: m.home,
        teamB: m.away,
        venue: 'Vantaan jäähalli',
        city: PK_VENUE.city,
        lat: PK_VENUE.lat,
        lon: PK_VENUE.lon,
        matchUrl: `${SCHEDULE_URL}${m.id}/`,
        crestA: TEAM_CRESTS[m.home] || null,
        crestB: TEAM_CRESTS[m.away] || null,
      });
      matched++;
    }
    console.log(`Mestis: ${matches.length} ottelua otteluohjelmassa, ${matched} K-Vantaan kotiottelua täsmäsi aikaväliin`);
  } catch (e) {
    console.error(`Mestis: virhe - ${e.message}`);
  }

  await browser.close();

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'mestis.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'mestis.fi (Playwright, palvelinrenderöity HTML)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
