// Hakee Palloliiton pääkaupunkiseudun ottelut (jalkapallo, futsal, miesten
// maajoukkue) seuraavalle DAYS_AHEAD-päivälle.
//
// Toimintaperiaate: Playwright avaa oikean Chromium-selaimen ja navigoi
// ensin tulospalvelu.palloliitto.fi:hin, jotta seuraava fetch()-kutsu
// tehdään sivun omasta JavaScript-kontekstista (sama origin kuin mitä
// rajapinta odottaa) — sama tekniikka jolla data saatiin toimimaan
// manuaalisessa testauksessa selaimen konsolista.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://spl.torneopal.net';
const ACCEPT_TOKEN = 'json/4h7dznqdxwtp3hsfdyf5r793uahfxy7x';
const ORIGIN_PAGE = 'https://tulospalvelu.palloliitto.fi/';
const ALLOWED_CATEGORIES = new Set([
  'VL', 'M1L', 'NL',   // Veikkausliiga, Ykkösliiga, naisten Kansallinen Liiga
  'FML', 'FNL',        // Miesten ja naisten Futsal-Liiga
  'UNL',               // Miesten maajoukkue (Huuhkajat), UEFA Nations League
]);
const PK_CITIES = ['HELSINKI', 'ESPOO', 'VANTAA', 'KAUNIAINEN'];
const DAYS_AHEAD = 13; // tänään + 13 seuraavaa päivää (sama ikkuna kuin index.html:n "valitse päivämäärät")
const REQUEST_DELAY_MS = 200;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isPKArea(m) {
  const area = (m.venue_area_name || '').trim().toLowerCase();
  const city = (m.venue_city_name || '').trim().toUpperCase();
  return area === 'pääkaupunkiseutu' || PK_CITIES.includes(city);
}

const FUTSAL_CATEGORIES = new Set(['FML', 'FNL']);

function normalize(m) {
  return {
    date: m.date,
    time: (m.time || '').slice(0, 5),
    sport: FUTSAL_CATEGORIES.has(m.category_id) ? 'Futsal' : 'Jalkapallo',
    category: m.category_name || '',
    genderGroup: (m.category_group_name || '').trim() || 'Muu',
    teamA: m.team_A_name || m.club_A_name || '?',
    teamB: m.team_B_name || m.club_B_name || '?',
    venue: (m.venue_location_name || m.venue_name || '').trim(),
    city: (m.venue_city_name || '').trim(),
    lat: m.venue_lat ? parseFloat(m.venue_lat) : null,
    lon: m.venue_lon ? parseFloat(m.venue_lon) : null,
    crestA: m.club_A_crest || null,
    crestB: m.club_B_crest || null,
  };
}

async function fetchDay(page, dateStr) {
  return await page.evaluate(async ({ baseUrl, token, dateStr }) => {
    const res = await fetch(`${baseUrl}/taso/rest/getMatches?date=${dateStr}`, {
      headers: { Accept: token },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.matches || [];
  }, { baseUrl: BASE_URL, token: ACCEPT_TOKEN, dateStr });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Navigoidaan origin-sivulle:', ORIGIN_PAGE);
  await page.goto(ORIGIN_PAGE, { waitUntil: 'domcontentloaded' });

  const allMatches = [];

  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const dateStr = todayISO(i);
    try {
      const raw = await fetchDay(page, dateStr);
      const filtered = raw
        .filter(m => (m.sport_id === 'football' || m.sport_id === 'futsal') && ALLOWED_CATEGORIES.has(m.category_id) && isPKArea(m))
        .map(normalize);
      allMatches.push(...filtered);
      console.log(`${dateStr}: ${raw.length} ottelua haettu, ${filtered.length} täsmäsi suodattimiin`);
    } catch (e) {
      console.error(`${dateStr}: virhe — ${e.message}`);
    }
    await page.waitForTimeout(REQUEST_DELAY_MS);
  }

  await browser.close();

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jalkapallo.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'spl.torneopal.net (Playwright)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
