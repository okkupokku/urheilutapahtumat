// Hakee jääpallon (Bandyliiga) pääkaupunkiseudun ottelut tunnettujen PK-
// seurojen seurat.php-sivuilta finbandy.torneopal.fi:stä.
//
// Toimintaperiaate: finbandy.torneopal.fi ei paljasta JSON-rajapinnan
// (getMatches) Accept-tokenia selaimelle - sivu on täysin palvelin-
// renderöity eikä tee yhtään XHR/fetch-kutsua (vahvistettu DevTools-
// verkkoliikenteestä). Jokaisen seuran oma sivu (/taso/seurat.php?seura=ID)
// sisältää kuitenkin koko kauden ottelut valmiiksi siistinä HTML:nä, jossa
// jokainen ottelu on <li class='match'>-elementti selkeillä luokkanimillä
// (ml_ottelunro, ml_sarja, ml_sarjanimi, ml_pvm, ml_kenttanimi,
// ml_kotisiisti, ml_kotilogo, ml_tulosklo, ml_vieraslogo, ml_vierassiisti)
// - sama HTML-upotustekniikka kuin salibandyllä (ks. fetch-salibandy.js),
// mutta tässä ei tarvitse edes purkaa JSON:ia, suorat regex-poiminnat
// riittävät.
//
// PK-seudun seurat (seura=id) on selvitetty käymällä läpi
// /taso/seurat.php-listaus ja tarkistamalla kunkin seuran Kotikunta-kenttä.
// Kentät (kotihallit) ja niiden koordinaatit ovat manuaalisesti haettuja
// likiarvoja, eivät rajapinnasta - jos ne osoittautuvat vääriksi, korjaa
// PK_VENUES-taulukko.
//
// HUOM: ottelujen kellonaika ("Klo") ei ole vielä tiedossa kuukausia
// etukäteen julkaistulle otteluohjelmalle (näkyy "--:--"), joten time-kenttä
// jää usein tyhjäksi kunnes seura vahvistaa sen lähempänä ottelupäivää.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://finbandy.torneopal.fi';

const PK_CLUBS = [
  { id: 2, name: 'HIFK' },
  { id: 3, name: 'Botnia' },
  { id: 12, name: 'Vesta' }, // Divari (alempi sarja) - ei otteluita vielä julkaistu tarkistushetkellä
];

// Tunnettujen PK-seudun kotikenttien likikoordinaatit. Täsmäytys tehdään
// sillä, sisältyykö tämä teksti ml_kenttanimi-kentän arvoon.
const PK_VENUES = [
  { match: 'Kallio tj', city: 'Helsinki', lat: 60.1877, lon: 24.9514 },
  { match: 'Oulunkylä tj', city: 'Helsinki', lat: 60.2185, lon: 24.9503 },
];

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function findPKVenue(kenttanimi) {
  return PK_VENUES.find(v => kenttanimi.includes(v.match)) || null;
}

// "14.11." (kuluva vuosi) tai "6.1.2027" (vuosi näkyy heti kun ottelu on
// seuraavana kalenterivuonna - sivu lisää vuoden itse aina kun se vaihtuu).
function parseFinDate(str) {
  const parts = str.trim().replace(/\.$/, '').split('.');
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// HUOM: Playwrightin page.content() palauttaa DOM:in serialisoituna. Selain
// normalisoi tällöin sekä attribuuttien lainausmerkit (aina "-merkeiksi)
// että class-attribuutin sisäisen välilyönnin (esim. "match " typistyy
// muotoon "match") riippumatta siitä miltä palvelimen alkuperäinen HTML
// näyttää (class='match '). Siksi luokkaa ei etsitä kiinteänä
// merkkijonona vaan poimimalla koko class-attribuutin arvo ja tarkistamalla
// sisältääkö sen välilyönnein eroteltu tokenlista halutun luokan.
function hasClassToken(classAttr, cls) {
  return classAttr.split(/\s+/).includes(cls);
}

function field(chunk, cls) {
  const re = /class=["']([^"']*)["']>([^<]*)</g;
  let m;
  while ((m = re.exec(chunk))) {
    if (hasClassToken(m[1], cls)) return m[2].trim();
  }
  return null;
}

function crestSrc(chunk, cls) {
  const re = /class=["']([^"']*)["']>\s*<img src=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(chunk))) {
    if (hasClassToken(m[1], cls)) return m[2];
  }
  return null;
}

function extractMatches(html) {
  const items = [...html.matchAll(/<li class=["']([^"']*)["']>(.*?)<\/li>/gs)];
  return items.filter(m => hasClassToken(m[1], 'match')).map(m => {
    const c = m[2];
    return {
      nro: field(c, 'ml_ottelunro'),
      sarja: field(c, 'ml_sarja'),
      sarjanimi: field(c, 'ml_sarjanimi'),
      pvm: field(c, 'ml_pvm'),
      kentta: field(c, 'ml_kenttanimi'),
      koti: field(c, 'ml_kotisiisti'),
      kotilogo: crestSrc(c, 'ml_kotilogo'),
      aika: field(c, 'ml_tulosklo'),
      vieraslogo: crestSrc(c, 'ml_vieraslogo'),
      vieras: field(c, 'ml_vierassiisti'),
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = todayISO(0);
  const seen = new Set(); // dedup-avain: ottelunumero
  const allMatches = [];

  for (const club of PK_CLUBS) {
    const url = `${BASE_URL}/taso/seurat.php?seura=${club.id}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const html = await page.content();
      const matches = extractMatches(html);
      let matched = 0;
      for (const m of matches) {
        if (!m.pvm || !m.nro) continue;
        const dateStr = parseFinDate(m.pvm);
        if (dateStr < today) continue; // koko loppukausi mukaan, ei enää yläikkunaa
        const pkVenue = findPKVenue(m.kentta || '');
        if (!pkVenue) continue;
        if (seen.has(m.nro)) continue;
        seen.add(m.nro);
        const genderGroup = (m.sarjanimi || '').includes('Naisten') ? 'Naiset' : 'Miehet';
        const level = (m.sarjanimi || '').includes('Bandyliiga') ? 'paasarja' : 'alempi';
        allMatches.push({
          date: dateStr,
          time: (m.aika && m.aika !== '--:--') ? m.aika : '',
          sport: 'Jääpallo',
          category: m.sarjanimi || m.sarja || '',
          categoryId: m.sarja || '',
          genderGroup,
          level,
          teamA: m.koti || '?',
          teamB: m.vieras || '?',
          venue: m.kentta || '',
          city: pkVenue.city,
          lat: pkVenue.lat,
          lon: pkVenue.lon,
          crestA: m.kotilogo || null,
          crestB: m.vieraslogo || null,
        });
        matched++;
      }
      console.log(`${club.name} (seura=${club.id}): ${matches.length} ottelua sivulla, ${matched} täsmäsi PK-alueelle & aikaväliin`);
    } catch (e) {
      console.error(`${club.name} (seura=${club.id}): virhe - ${e.message}`);
    }
    await page.waitForTimeout(500);
  }

  await browser.close();

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jaapallo.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'finbandy.torneopal.fi (Playwright, palvelinrenderöity HTML)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
