// Hakee Mestiksen ja Auroraliigan pääkaupunkiseudun ottelut seuraavalle
// DAYS_AHEAD-päivälle.
//
// Toimintaperiaate: sama kuin fetch-jalkapallo.js — Playwright avaa oikean
// Chromium-selaimen ja navigoi ensin tulospalvelu.leijonat.fi:hin, jotta
// seuraava fetch()-kutsu tehdään sivun omasta JavaScript-kontekstista,
// koska suora selainkutsu toiselta origin ilta on CORS-estetty.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ORIGIN_PAGE = 'https://tulospalvelu.leijonat.fi/';
const SEASON = 2027;
const WANTED_LEVELS = { 65: 'Mestis', 73: 'Auroraliiga' };
const DAYS_AHEAD = 6; // tänään + 6 seuraavaa päivää
const REQUEST_DELAY_MS = 200;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isPKCoord(lat, lon) {
  const la = parseFloat(lat), lo = parseFloat(lon);
  if (isNaN(la) || isNaN(lo)) return false;
  return la >= 60.05 && la <= 60.35 && lo >= 24.45 && lo <= 25.30;
}

function normalize(g, levelName) {
  return {
    date: g.GameDateDB || '',
    time: g.GameTime || '',
    sport: 'Jääkiekko',
    category: levelName,
    teamA: g.HomeTeamAbbrv || g.HomeAssociation || '?',
    teamB: g.AwayTeamAbbrv || g.AwayAssociation || '?',
    venue: g.RinkName || '',
    city: '', // ei suoraa kaupunkikenttää — suodatettu jo koordinaateilla pääkaupunkiseudulle
  };
}

async function fetchDay(page, dateStr) {
  return await page.evaluate(async ({ season, dateStr }) => {
    const url = `https://tulospalvelu.leijonat.fi/helpers/getgames?season=${season}&subSerieId=0&teamid=0&districtid=-1&gamedays=-1&dog=${dateStr}&levelid=-1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} — vastauksen alku: ${body.slice(0, 300)}`);
    }
    return await res.json();
  }, { season: SEASON, dateStr });
}

async function diagnoseDirectFetch(dateStr) {
  const url = `https://tulospalvelu.leijonat.fi/helpers/getgames?season=${SEASON}&subSerieId=0&teamid=0&districtid=-1&gamedays=-1&dog=${dateStr}&levelid=-1`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    console.log(`[diagnoosi] Suora Node-fetch (ei selainta): HTTP ${res.status}`);
  } catch (e) {
    console.log(`[diagnoosi] Suora Node-fetch epäonnistui: ${e.message}`);
  }
}

(async () => {
  await diagnoseDirectFetch(todayISO(0));

  // tulospalvelu.leijonat.fi on CloudFront/WAF-suojattu ja palauttaa 403:n
  // Playwrightin oletusarvoisesta headless-Chromiumista (mm. navigator.webdriver
  // -lippu paljastaa automaation) vaikka sama pyyntö toimii tavallisesta
  // selaimesta. Piilotetaan tunnetuimmat automaatiotunnisteet ja annetaan
  // sivulle aikaa latautua kokonaan ennen ensimmäistä fetch-kutsua.
  const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('Navigoidaan origin-sivulle:', ORIGIN_PAGE);
  await page.goto(ORIGIN_PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const allMatches = [];

  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const dateStr = todayISO(i);
    try {
      const levelGroups = await fetchDay(page, dateStr);
      let dayCount = 0;
      for (const levelGroup of (levelGroups || [])) {
        const levelName = WANTED_LEVELS[levelGroup.LevelID];
        if (!levelName) continue;
        for (const g of (levelGroup.Games || [])) {
          if (isPKCoord(g.Latitude, g.Longitude)) {
            allMatches.push(normalize(g, levelName));
            dayCount++;
          }
        }
      }
      console.log(`${dateStr}: ${dayCount} ottelua täsmäsi suodattimiin`);
    } catch (e) {
      console.error(`${dateStr}: virhe — ${e.message}`);
    }
    await page.waitForTimeout(REQUEST_DELAY_MS);
  }

  await browser.close();

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jaakiekko-mestis-aurora.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'tulospalvelu.leijonat.fi (Playwright)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
