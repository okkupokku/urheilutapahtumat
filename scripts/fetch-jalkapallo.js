// Hakee Palloliiton pääkaupunkiseudun tulevat ottelut (jalkapallo, futsal,
// miesten ja naisten A-maajoukkueet) Torneopalin julkisesta
// otteluohjelma-widgetistä.
//
// Tausta (2026-10-30): spl.torneopal.net:n REST-rajapinta (getCategories/
// getMatches) lakkasi hyväksymästä vanhaa Accept-tokenia - tulospalvelu
// käyttää nykyään pyyntökohtaista hash-parametria, eikä sitä kierretä (ks.
// CLAUDE.md "Tunnetut infrarajoitukset"). Sen sijaan käytetään widgetiä
// (taso/widget.php?widget=fixture&class=<sarja>&competition=<kausi>), joka on
// tarkoitettu upotettavaksi muille sivustoille (esim. futsalliiga.fi käyttää
// sitä) ja toimii ilman avainta. Widget palauttaa JS-tiedoston, jonka
// document.write()-kutsun sisällä on HTML-taulukko: yksi <tr> per ottelu,
// <tr class='... matchid_NNN'> ja solut date/time/pitch/home/away. Vain
// tulevat (pelaamattomat) ottelut ovat mukana.
//
// Widget ei kerro kaupunkia eikä koordinaatteja, vain kentän nimen
// (usein sponsorinimellä, esim. "Bolt Arena TN" = Töölön pallokenttä).
// PK-alue päätellään siksi käsin ylläpidetystä PK_VENUES-listasta (sama
// tekniikka kuin salibandyssa). Tuntemattomat kentät tulostetaan lokiin,
// jotta uudet PK-kentät huomataan. Joukkuelogoja widget ei sisällä.
//
// Ei tarvitse Playwrightia - pelkkä HTTP-haku (Node 20:n oma fetch).

const fs = require('fs');
const path = require('path');

const WIDGET_URL = 'https://spl.torneopal.net/taso/widget.php';
const USER_AGENT = 'urheilutapahtumat (+https://okkupokku.github.io/urheilutapahtumat/)';
const REQUEST_DELAY_MS = 1000;

// categoryId -> näyttönimi ja sukupuoli. id:t samat kuin index.html:n
// KNOWN_SERIES:ssä (tulospalvelun Sarjat-sivulta, esim. /category/VL!spljp26).
const CATEGORIES = {
  VL: { name: 'Veikkausliiga', gender: 'Miehet', season: 'jp' },
  M1L: { name: 'Ykkösliiga', gender: 'Miehet', season: 'jp' },
  NL: { name: 'Kansallinen Liiga', gender: 'Naiset', season: 'jp' },
  FML: { name: 'Miesten Futsal-Liiga', gender: 'Miehet', season: 'fs', sport: 'Futsal' },
  FNL: { name: 'Naisten Futsal-Liiga', gender: 'Naiset', season: 'fs', sport: 'Futsal' },
  UNL: { name: 'UEFA Nations League', gender: 'Miehet', season: 'maa' },
  WUNL: { name: 'UEFA Nations League', gender: 'Naiset', season: 'maa' },
  WCQ: { name: 'MM-karsinnat', gender: 'Miehet', season: 'maa' },
  WWCQ: { name: 'MM-karsinnat', gender: 'Naiset', season: 'maa' },
  ECQ: { name: 'EM-karsinnat', gender: 'Miehet', season: 'maa' },
  WECQ: { name: 'EM-karsinnat', gender: 'Naiset', season: 'maa' },
  'Miehet-A': { name: 'A-maaottelut', gender: 'Miehet', season: 'maa' },
  'Naiset-A': { name: 'A-maaottelut', gender: 'Naiset', season: 'maa' },
};

// Kausitunnisteet vaihtuvat vuosittain (spljp26 = jalkapallo 2026,
// splfs2627 = futsal 2026-27, maajp2026 = maaottelut 2026). Kokeillaan aina
// sekä nykyistä että seuraavaa kautta, jotta kauden vaihde ei vaadi
// koodimuutosta niin kauan kuin Palloliitto pitää saman nimeämistavan.
function competitionCandidates(seasonType) {
  const y = new Date().getFullYear();
  const yy = n => String(n % 100).padStart(2, '0');
  if (seasonType === 'jp') return [`spljp${yy(y)}`, `spljp${yy(y + 1)}`];
  if (seasonType === 'fs') return [`splfs${yy(y - 1)}${yy(y)}`, `splfs${yy(y)}${yy(y + 1)}`];
  return [`maajp${y}`, `maajp${y + 1}`];
}

// PK-seudun kentät widgetin nimillä (pinta-pääte " TN"/" N" poistettuna).
// Koordinaatit vanhasta REST-datasta (venue_lat/lon) missä saatavilla, muut
// manuaalisesti haettuja likiarvoja. homeTeam rajaa geneerisen nimen
// (esim. "Jalkapallostadion") vain tietyn joukkueen kotiotteluihin.
const PK_VENUES = [
  { pitch: 'Bolt Arena', city: 'Helsinki', lat: 60.185855, lon: 24.923453 },          // Töölön pallokenttä
  { pitch: 'Töölön pallokenttä', city: 'Helsinki', lat: 60.185855, lon: 24.923453 },
  { pitch: 'Markku.fi Areena', city: 'Helsinki', lat: 60.234016, lon: 24.966134 },    // Oulunkylän urheilupuisto
  { pitch: 'Oulunkylän urheilupuisto', city: 'Helsinki', lat: 60.234016, lon: 24.966134 },
  { pitch: 'Briotech Arena', city: 'Helsinki', lat: 60.247834, lon: 24.922115 },      // HPS, Pakilantie 86 (Paloheinä)
  { pitch: 'Paloheinä', city: 'Helsinki', lat: 60.247834, lon: 24.922115 },
  { pitch: 'Olympiastadion', city: 'Helsinki', lat: 60.1870, lon: 24.9271 },
  { pitch: 'Helsingin Olympiastadion', city: 'Helsinki', lat: 60.1870, lon: 24.9271 },
  { pitch: 'Pirkkolan palloiluhalli', city: 'Helsinki', lat: 60.23243, lon: 24.909818 },
  { pitch: 'Matinkylän liikuntahalli', city: 'Espoo', lat: 60.1594, lon: 24.7384 },
  { pitch: 'Myyrmäen urheilutalo', city: 'Vantaa', lat: 60.2620, lon: 24.8560 },
  { pitch: 'Jalkapallostadion', homeTeam: /^PK-35/, city: 'Vantaa', lat: 60.2613, lon: 24.8546 }, // Myyrmäen jalkapallostadion
];

function cleanPitch(p) {
  return p.trim().replace(/\s+(TN|N)$/, '');
}

function findPkVenue(pitch, homeTeam) {
  return PK_VENUES.find(v => v.pitch === pitch && (!v.homeTeam || v.homeTeam.test(homeTeam))) || null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

// "31.10.2026" -> "2026-10-31"
function toISODate(d) {
  const m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function extractRows(js) {
  // Widgetin HTML on document.write("...")-merkkijonon sisällä, mahdolliset
  // \" ja \/ -pakomerkit puretaan ennen regexiä.
  const html = js.replace(/\\"/g, '"').replace(/\\\//g, '/');
  const rows = [];
  const re = /<tr class='([^']*matchid_(\d+)[^']*)'>(.*?)<\/tr>/gs;
  let m;
  // Widget näyttää päivämäärän vain päivän ENSIMMÄISELLÄ rivillä - saman
  // päivän seuraavien otteluiden date-solu on tyhjä, joten päivä periytyy
  // edelliseltä riviltä (taulukko on aikajärjestyksessä).
  let lastDate = null;
  while ((m = re.exec(html))) {
    const cell = cls => {
      // Solulla voi olla lisäluokkia (esim. <td class='date daysfirst'>).
      const c = m[3].match(new RegExp(`<td class='${cls}(?: [^']*)?'>(.*?)</td>`, 's'));
      return c ? decodeEntities(c[1].replace(/<[^>]+>/g, '')) : '';
    };
    lastDate = toISODate(cell('date')) || lastDate;
    rows.push({
      matchId: m[2],
      date: lastDate,
      time: /^\d{1,2}:\d{2}$/.test(cell('time')) ? cell('time').padStart(5, '0') : '',
      pitch: cleanPitch(cell('pitch')),
      home: cell('home'),
      away: cell('away'),
    });
  }
  return rows;
}

async function fetchWidget(categoryId, competition) {
  const url = `${WIDGET_URL}?widget=fixture&class=${encodeURIComponent(categoryId)}&competition=${encodeURIComponent(competition)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return extractRows(await res.text());
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map();
  const unknownPitches = new Set();
  let okRequests = 0;
  let failedRequests = 0;

  for (const [categoryId, meta] of Object.entries(CATEGORIES)) {
    for (const competition of competitionCandidates(meta.season)) {
      try {
        const rows = await fetchWidget(categoryId, competition);
        okRequests++;
        let pk = 0;
        for (const r of rows) {
          if (!r.date || r.date < today) continue;
          const venue = findPkVenue(r.pitch, r.home);
          if (!venue) {
            if (r.pitch) unknownPitches.add(r.pitch);
            continue;
          }
          pk++;
          byId.set(r.matchId, {
            date: r.date,
            time: r.time,
            sport: meta.sport || 'Jalkapallo',
            category: meta.name,
            categoryId,
            genderGroup: meta.gender,
            teamA: r.home || '?',
            teamB: r.away || '?',
            venue: r.pitch,
            city: venue.city,
            lat: venue.lat,
            lon: venue.lon,
            matchUrl: `https://tulospalvelu.palloliitto.fi/match/${r.matchId}`,
            crestA: null,
            crestB: null,
          });
        }
        if (rows.length) console.log(`${categoryId} (${competition}): ${rows.length} tulevaa ottelua, ${pk} PK-alueella`);
      } catch (e) {
        failedRequests++;
        console.error(`${categoryId} (${competition}): virhe - ${e.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  if (okRequests === 0) {
    console.error(`Kaikki ${failedRequests} widget-hakua epäonnistuivat - ei kirjoiteta tiedostoa.`);
    process.exit(1);
  }

  if (unknownPitches.size) {
    console.log(`\nTuntemattomat kentät (ei PK_VENUES-listassa, ohitettu): ${[...unknownPitches].sort().join(', ')}`);
  }

  const allMatches = [...byId.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'jalkapallo.json');
  fs.writeFileSync(outPath, JSON.stringify({
    updated: new Date().toISOString(),
    source: 'spl.torneopal.net widget.php (fixture)',
    matches: allMatches,
  }, null, 2));

  console.log(`\nValmis: ${allMatches.length} ottelua tallennettu tiedostoon ${outPath}`);
})();
