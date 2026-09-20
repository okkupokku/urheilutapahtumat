// Hakee F-liigan (salibandy) pääkaupunkiseudun ottelut seuraavalle
// DAYS_AHEAD-päivälle tunnettujen PK-seudun joukkueiden fliiga.com-sivuilta.
//
// Toimintaperiaate: fliiga.com ei tarjoa julkista JSON-rajapintaa (toisin
// kuin Palloliitto/Korisliitto/Lentopalloliitto/Käsipalloliitto, joilla on
// oma *-api.torneopal.net-osoite selaimelle näkyvällä avaimella). fliiga.com
// on WordPress-sivusto, jonka jokaisen joukkueen oma sivu kuitenkin sisältää
// koko kauden ottelut valmiiksi upotettuna sivun HTML:ään yhtenä
// JSON-muotoisena tekstilohkona. Haetaan siis suoraan kunkin tunnetun
// PK-joukkueen sivu Playwrightilla ja puretaan ottelut säännöllisillä
// lausekkeilla HTML:n sisältä sen sijaan että kutsuttaisiin rajapintaa.
//
// PK-seudun joukkueet ja niiden kotihallit on selvitetty käsin käymällä läpi
// F-liigan kaikki miesten ja naisten joukkuesivut (fliiga.com ei tarjoa
// kaupunki- tai koordinaattitietoa suoraan) — jos uusi joukkue nousee
// F-liigaan PK-seudulta, tämä lista pitää päivittää käsin. Koordinaatit ovat
// samasta syystä manuaalisesti haettuja likiarvoja, eivät rajapinnasta
// suoraan saatuja (toisin kuin muiden lajien venue_lat/venue_lon-kentät).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TEAM_PAGES = [
  'https://fliiga.com/oilers/miehet/',
  'https://fliiga.com/westend-indians/miehet/',
  'https://fliiga.com/hawks/miehet/',
  'https://fliiga.com/eraviikingit/miehet/',
  'https://fliiga.com/eraviikingit/naiset/',
  'https://fliiga.com/pss/naiset/',
];

// Tunnettujen PK-seudun hallien likikoordinaatit. Täsmäytys tehdään sillä,
// alkaako ottelun venue-kenttä jollain näistä nimistä, koska sama halli voi
// esiintyä usealla kentällä (esim. "Mosahalli kenttä 1" / "kenttä 2").
const PK_VENUES = [
  { prefix: 'Tapiolan Urheiluhalli', city: 'Espoo', lat: 60.1756, lon: 24.8025 },
  { prefix: 'Otahalli', city: 'Espoo', lat: 60.1875, lon: 24.8296 },
  { prefix: 'Urhea-halli', city: 'Helsinki', lat: 60.2263, lon: 25.0788 },
  { prefix: 'Mosahalli', city: 'Vantaa', lat: 60.2707, lon: 24.8395 },
  { prefix: 'Aurora', city: 'Helsinki', lat: 60.2030, lon: 24.9250 },
];

const DAYS_AHEAD = 13; // sama ikkuna kuin muissa lähteissä
const REQUEST_DELAY_MS = 500;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function findPKVenue(venueName) {
  return PK_VENUES.find(v => venueName.startsWith(v.prefix)) || null;
}

function decodeUnicodeEscapes(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Ottelut ovat sivun HTML:ssä yksinkertaisina "avain":"arvo"-pareina ilman
// kenoviivapakoja (ei siis sisäkkäin toisen JSON-merkkijonon sisällä), joten
// jokainen ottelu löydetään "gameday"-aikaleiman kohdalta ja muut kentät
// puretaan sitä seuraavasta n. 2500 merkin ikkunasta.
function extractMatches(html) {
  const anchors = [...html.matchAll(/"gameday":(\d+)/g)];
  const field = (chunk, name) => {
    const m = chunk.match(new RegExp(`"${name}":"([^"]*)"`));
    return m ? decodeUnicodeEscapes(m[1]) : null;
  };
  return anchors.map(a => {
    const chunk = html.slice(a.index, a.index + 2500);
    return {
      gameday: Number(a[1]),
      time: field(chunk, 'match_time'),
      homeClub: field(chunk, 'home_club'),
      awayClub: field(chunk, 'away_club'),
      venue: field(chunk, 'venue'),
      status: field(chunk, 'status'),
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = todayISO(0);
  const maxDate = todayISO(DAYS_AHEAD);
  const seen = new Set(); // dedup-avain: gameday+kotijoukkue+vierasjoukkue
  const allMatches = [];

  for (const url of TEAM_PAGES) {
    const genderGroup = url.includes('/naiset/') ? 'Naiset' : 'Miehet';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const html = await page.content();
      const matches = extractMatches(html);
      let matched = 0;
      for (const m of matches) {
        if (!m.venue || !m.gameday) continue;
        const dateStr = new Date(m.gameday * 1000).toISOString().slice(0, 10);
        if (dateStr < today || dateStr > maxDate) continue;
        const pkVenue = findPKVenue(m.venue);
        if (!pkVenue) continue;
        const key = `${m.gameday}|${m.homeClub}|${m.awayClub}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allMatches.push({
          date: dateStr,
          time: (m.time || '').slice(0, 5),
          sport: 'Salibandy',
          category: 'F-liiga',
          categoryId: genderGroup === 'Naiset' ? 'FLN' : 'FLM',
          genderGroup,
          teamA: m.homeClub || '?',
          teamB: m.awayClub || '?',
          venue: m.venue,
          city: pkVenue.city,
          lat: pkVenue.lat,
          lon: pkVenue.lon,
          crestA: null,
          crestB: null,
        });
        matched++;
      }
      console.log(`${url}: ${matches.length} ottelua sivulla, ${matched} täsmäsi PK-alueelle & aikaväliin`);
    } catch (e) {
      console.error(`${url}: virhe — ${e.message}`);
    }
    await page.waitForTimeout(REQUEST_DELAY_MS);
  }

  await browser.close();

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'salibandy.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'fliiga.com (Playwright, sivulle upotettu data)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
