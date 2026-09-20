// Hakee Palloliiton pääkaupunkiseudun ottelut (jalkapallo, futsal, miesten
// ja naisten A-maajoukkueet) koko kaudelta ("kaikki saatavilla olevat
// ottelut" - asiakas suodattaa näytettävän aikavälin itse).
//
// Toimintaperiaate: Playwright avaa oikean Chromium-selaimen ja navigoi
// ensin tulospalvelu.palloliitto.fi:hin, jotta seuraava fetch()-kutsu
// tehdään sivun omasta JavaScript-kontekstista (sama origin kuin mitä
// rajapinta odottaa) - sama tekniikka jolla data saatiin toimimaan
// manuaalisessa testauksessa selaimen konsolista.
//
// getMatches?date=YYYY-MM-DD palauttaa vain yhden päivän koko maasta.
// getMatches?category_id=X&competition_id=Y (ilman date-parametria)
// palauttaa sen sijaan KOKO KAUDEN kyseiselle sarjalle yhdellä kutsulla -
// paljon tehokkaampi kun halutaan enemmän kuin muutama päivä eteenpäin.
// competition_id vaihtelee kaudittain, joten se selvitetään aina ajon
// alussa getCategories?all_current=1-hausta (ks. CLAUDE.md "getCategories").

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://spl.torneopal.net';
const ACCEPT_TOKEN = 'json/4h7dznqdxwtp3hsfdyf5r793uahfxy7x';
const ORIGIN_PAGE = 'https://tulospalvelu.palloliitto.fi/';
const ALLOWED_CATEGORIES = new Set([
  'VL', 'M1L', 'NL',   // Veikkausliiga, Ykkösliiga, naisten Kansallinen Liiga
  'FML', 'FNL',        // Miesten ja naisten Futsal-Liiga
  // A-maajoukkueet (Huuhkajat/Helmarit) - id:t vahvistettu suoraan
  // spl.torneopal.net:n getCategories-rajapinnasta (all_current=1).
  'UNL', 'WUNL',       // UEFA Nations League, miehet/naiset
  'WCQ', 'WWCQ',       // MM-karsinnat, miehet/naiset
  'ECQ', 'WECQ',       // EM-karsinnat, miehet/naiset
  'Miehet-A', 'Naiset-A', // A-maaottelut (ystävyysottelut), miehet/naiset
]);
const PK_CITIES = ['HELSINKI', 'ESPOO', 'VANTAA', 'KAUNIAINEN'];
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
    categoryId: m.category_id || '',
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

async function fetchCategories(page) {
  return await page.evaluate(async ({ baseUrl, token }) => {
    const res = await fetch(`${baseUrl}/taso/rest/getCategories?all_current=1`, { headers: { Accept: token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.categories || [];
  }, { baseUrl: BASE_URL, token: ACCEPT_TOKEN });
}

async function fetchCategoryMatches(page, categoryId, competitionId) {
  return await page.evaluate(async ({ baseUrl, token, categoryId, competitionId }) => {
    const url = `${baseUrl}/taso/rest/getMatches?category_id=${encodeURIComponent(categoryId)}&competition_id=${encodeURIComponent(competitionId)}`;
    const res = await fetch(url, { headers: { Accept: token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.matches || [];
  }, { baseUrl: BASE_URL, token: ACCEPT_TOKEN, categoryId, competitionId });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Navigoidaan origin-sivulle:', ORIGIN_PAGE);
  await page.goto(ORIGIN_PAGE, { waitUntil: 'domcontentloaded' });

  const today = todayISO(0);
  const allMatches = [];

  const categories = await fetchCategories(page);
  const pairs = new Map(); // "category_id|competition_id" -> {category_id, competition_id}
  categories.forEach(c => {
    if (ALLOWED_CATEGORIES.has(c.category_id) && c.competition_id) {
      pairs.set(`${c.category_id}|${c.competition_id}`, { category_id: c.category_id, competition_id: c.competition_id });
    }
  });
  console.log(`Löytyi ${pairs.size} (category_id, competition_id) -paria ${ALLOWED_CATEGORIES.size} sallitusta kategoriasta.`);

  for (const { category_id, competition_id } of pairs.values()) {
    try {
      const raw = await fetchCategoryMatches(page, category_id, competition_id);
      const filtered = raw
        .filter(m => m.date >= today && (m.sport_id === 'football' || m.sport_id === 'futsal') && isPKArea(m))
        .map(normalize);
      allMatches.push(...filtered);
      console.log(`${category_id} (${competition_id}): ${raw.length} ottelua kaudella, ${filtered.length} täsmäsi PK-alueelle`);
    } catch (e) {
      console.error(`${category_id} (${competition_id}): virhe - ${e.message}`);
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
