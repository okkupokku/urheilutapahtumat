# CLAUDE.md — urheilutapahtumat

Tekninen muistiinpano tuleville Claude-istunnoille (ja ihmisille). Tämä
tiedosto sisältää tietoa joka on löydetty kantapään kautta (API-tokenien
metsästys, kategoriatunnisteiden selvitys, bugikorjaukset) — lue ennen kuin
alat "keksimään pyörää uudelleen".

## Mikä tämä on

Yksisivuinen staattinen sivusto ([index.html](index.html)), joka näyttää
pääkaupunkiseudun (Helsinki/Espoo/Vantaa/Kauniainen) urheiluottelut listana
ja kartalla. Ei backendiä ajon aikana — kaikki suodatus tapahtuu selaimessa.
Julkaistu GitHub Pagesilla osoitteessa
https://okkupokku.github.io/urheilutapahtumat/

Sivulla on oma "Tietoa tästä sivustosta" -paneeli (kiinni oletuksena, aivan
sivun alaosassa) joka selittää käyttäjälle saman asian lyhyemmin — pidä
se ajan tasalla jos teet isoja muutoksia.

## Arkkitehtuuri: kaksi datanhakutapaa

1. **Suora selainhaku** (koripallo, lentopallo, käsipallo, jääkiekko/Liiga.fi):
   `index.html`:n JS hakee näiden rajapinnoista suoraan `fetch()`-kutsulla
   joka kerta kun sivu ladataan. Toimii koska nämä rajapinnat sallivat CORS:n.
2. **Taustaprosessi** (jalkapallo+futsal+maajoukkue, salibandy): rajapinta ei
   salli suoraa selainkutsua (CORS) tai rajapintaa ei ole ollenkaan, joten
   Playwright hakee datan GitHub Actionsissa 4h välein
   ([.github/workflows/update-data.yml](.github/workflows/update-data.yml))
   ja tallentaa JSON:n `data/`-kansioon, jonka `index.html` sitten lukee
   (cache-bustattuna `?t=timestamp`, katso "Sudenkuopat" alla miksi).

## Datalähteet lajeittain

### TorneoPal-alusta (jalkapallo, koripallo, lentopallo, käsipallo, futsal)
Kaikki näillä on sama backend-alusta `*.torneopal.net`, sama REST-muoto:
`GET https://<alidomeeni>/taso/rest/getMatches?date=YYYY-MM-DD` headerillä
`Accept: json/<TOKEN>`. Alidomeeni+token on **eri jokaiselle federaatiolle**
ja löytyy vain kunkin liiton omalta julkiselta sivustolta selaimen
verkkoliikennettä tutkimalla (DevTools → Network → etsi `getMatches`).

Tunnetut toimivat yhdistelmät (näkyvät myös koodissa):
| Laji | Alidomeeni | Token |
|---|---|---|
| Jalkapallo/futsal (Palloliitto) | `spl.torneopal.net` | `4h7dznqdxwtp3hsfdyf5r793uahfxy7x` |
| Koripallo | `koripallo-api.torneopal.net` | `df8e84j9xtdz269euy3h` |
| Lentopallo | `lentopallo-api.torneopal.net` | `df8e84j9xtdz269euy3h` (sama kuin koris) |
| Käsipallo | `hb-api.torneopal.net` | `pfqmz9z6ea43uqy2hzfxpcpxr4svqunn` |

Muita olemassa olevia mutta **avainta ei löydetty** -alidomeeneja (palauttavat
`Invalid db` ilman oikeaa Accept-headeria, eli alusta on olemassa mutta
token puuttuu): `bandy-api.torneopal.net`, `floorball-api.torneopal.net`,
`jaapallo-api.torneopal.net`, `finbandy-api.torneopal.net`,
`sfl-api.torneopal.net`, `fliiga-api.torneopal.net`. Jääpallon
(finbandy.torneopal.fi) oma sivu on palvelinrenderöity eikä paljasta
tokenia selaimelle lainkaan — jos joku löytää oikean tokenin jostain
mobiilisovelluksesta tms., jääpallo olisi helppo lisätä samalla kaavalla
kuin muut TorneoPal-lajit.

**category_id → sarja -mappaus** (ylin sarjataso, käsin selvitetty
tarkistamalla oikea live-data eri päiviltä — katso `KNOWN_SERIES` vakio
[index.html](index.html):ssä, joka on tämän taulukon "source of truth"):
- Jalkapallo: `VL`=Veikkausliiga, `M1L`=Ykkösliiga, `NL`=Naisten Kansallinen
  Liiga (esiintyy usein sponsorinimellä esim. "Briotech Kansallinen Liiga"),
  `UNL`=UEFA Nations League (Huuhkajat, miesten maajoukkue!)
- Futsal: `FML`=Miesten Futsal-Liiga, `FNL`=Naisten Futsal-Liiga — **HUOM:**
  näiden `sport_id` on `"futsal"`, EI `"football"` — jos suodatat
  `sport_id`:n mukaan, muista sallia molemmat.
- Koripallo: `4`=Korisliiga (M), `1`=Naisten Korisliiga (N), `15`=Miesten
  Suomen cup
- Käsipallo: `SM-liiga`=Miesten Aktialiiga, `NSM`=Naisten Aktialiiga,
  `MSC`=Miesten Suomen Cup, `NSC`=Naisten Suomen Cup
- Lentopallo: `NL`=Naisten Mestaruusliiga (vahvistettu livenä). `ML`=Miesten
  Mestaruusliiga — **ei koskaan nähty livenä tässä projektissa** (kausi ei
  ollut käynnissä haun aikaan, vain "PREM"-preseason-otteluita näkyi), joten
  tarkista jos sarja ei koskaan tuota tuloksia.

`isPKAreaTorneoPal()` suodattaa alueen `venue_area_name`/`venue_city_name`
-kentistä. **Käsipalloliiton data sisältää ylimääräisiä välilyöntejä**
näissä kentissä (esim. `"Kauniainen          "`) — kaikki kaupunki-/
paikkakentät trimmataan siksi aina (`.trim()`).

### Liiga.fi (jääkiekko, Liiga)
`GET https://liiga.fi/api/v2/games?tournament=runkosarja&date=YYYY-MM-DD`,
ei avainta, avoin CORS. `tournament`-parametrin väärä arvo palauttaa 403
(kokeiltu: vain `runkosarja`/`playoffs`/`playout` toimivat — muut liigat
kuten Mestis eivät ole tällä samalla API:lla ollenkaan).

### Salibandy (F-liiga) — fliiga.com
Ei julkista JSON-rajapintaa. **Löytö:** jokaisen joukkueen oma sivu
(`fliiga.com/<slug>/miehet|naiset/`) sisältää koko kauden ottelut valmiiksi
upotettuna palvelinrenderöityyn HTML:ään yhtenä JSON-tekstilohkona (WP-
artikkelidataa), **ilman kenoviivapakoja** (siis suoraan `"gameday":123`,
ei `\"gameday\":123`). Jokaisella ottelulla on `venue`-kenttä joka kertoo
oikean pelipaikan **sekä koti- että vierasotteluille** — tätä käytetään
PK-alueen suodatukseen sen sijaan että pitäisi tietää jokaisen joukkueen
kotikaupunki.

Katso [scripts/fetch-salibandy.js](scripts/fetch-salibandy.js) täydelle
purkulogiikalle (`extractMatches()`). PK-seudun joukkueet on selvitetty
käsin käymällä läpi *kaikki* F-liigan joukkuesivut ja lukemalla niiden
kotihalli (`OTTELUT`-välilehden yläreunassa):

| Joukkue | Sukupuoli | Kotihalli | Kaupunki |
|---|---|---|---|
| Oilers | Miehet | Tapiolan Urheiluhalli | Espoo |
| Westend Indians | Miehet | Otahalli | Espoo |
| Hawks | Miehet | Urhea-halli | Helsinki |
| EräViikingit | Miehet+Naiset | Mosahalli (kenttä 1/2) | Vantaa |
| PSS | Naiset | Aurora | Helsinki |

Näiden hallien **koordinaatit ovat manuaalisesti haettuja likiarvoja**, eivät
rajapinnasta — jos ne osoittautuvat väärin, korjaa `PK_VENUES`-taulukko
[scripts/fetch-salibandy.js](scripts/fetch-salibandy.js):ssä.

Jos F-liigaan nousee/laskee joukkueita, tämä lista pitää päivittää käsin
(`TEAM_PAGES`-taulukko samassa tiedostossa) — ei automaattista tapaa
havaita tätä.

Muita tutkittuja reittejä jotka **eivät** toimineet: `wp-admin/admin-ajax.php`
-kutsut (`team-standing`, `team-live-match`, `team-birthdays` — ei sisällä
otteluohjelmaa), iframe `engine.groweo.com` (vain chat-widget, ei dataa,
"Groweo" on asiakaspalvelu-chatbot-alusta, ei liity otteluihin mitenkään).

## Tunnetut infrarajoitukset (ei koodilla korjattavissa)

- **Mestis/Auroraliiga** (tulospalvelu.leijonat.fi): CloudFront/WAF estää
  GitHub Actionsin IP-alueen HTTP 403:lla — vahvistettu jopa täysin
  selaimettomalla suoralla Node-fetchillä, eli kyse ei ole selaimen
  bot-tunnistuksesta vaan verkkotason IP-mustalistauksesta. Toimisi jos
  taustaprosessi ajettaisiin jostain muusta verkosta (esim. käyttäjän omalta
  koneelta cronilla, tai maksullisen proxyn kautta — ei toteutettu, koska
  proxy maksaa ja on eettisesti harmaampi).
- **Jääpallo** (finbandy.torneopal.fi): ks. yllä, token ei paljastu.
- **Amerikkalainen jalkapallo**: ei tiedossa olevaa rajapintaa lainkaan.

## Sudenkuoppia (opittu kantapään kautta)

1. **MapLibre-merkkien CSS `position`**: `.map-marker`-luokassa EI SAA
   asettaa `position`-ominaisuutta. MapLibre asettaa oman
   `.maplibregl-marker { position: absolute }` -sääntönsä, ja jos oma
   `<style>`-lohko (joka on HTML:ssä `maplibre-gl.css`-linkin jälkeen, joten
   voittaa saman-spesifisyyden CSS-cascadessa) määrittää `position: relative`,
   merkit jäävät dokumenttivirtaukseen ja pinoutuvat päällekkäin sen sijaan
   että pysyisivät oikeissa koordinaateissa. Bugi näkyi vain räikeästi kun
   zoomasi ulos maailmankartan tasolle (pienillä zoomeilla efekti oli
   muutaman kymmenen pikselin luokkaa, huomaamaton).
2. **Cache-bustaus `data/*.json`-tiedostoille on pakollinen.** GitHub Pagesin
   CDN (Fastly) palauttaa muuten vanhentuneen version taustaprosessin juuri
   päivittämästä tiedostosta useiden minuuttien ajan. Kaikki `data/*.json`
   -haut käyttävät `?t=${Date.now()}`-parametria — älä poista tätä.
3. **CartoDB:n ilmaiset "dark"/"positron"-rasterikartat vaativat nykyään
   API-avaimen** (näyttävät "API key required" -vesileiman). Käytössä on nyt
   sen sijaan **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron`,
   MapLibre GL -yhteensopiva vektorityyli, ei avainta, ei rajoja) — jos tämä
   joskus lakkaa toimimasta, OpenFreeMap on ainoa tunnettu täysin ilmainen
   ja avaimeton vaihtoehto tälle laadulle.
4. **`categoryId` on suodattimien avain, ei kategorian nimi** (`category`).
   Nimet muuttuvat sponsoroinnin myötä (esim. "Briotech Kansallinen Liiga"),
   joten `KNOWN_SERIES`-rekisteri ja live-data yhdistetään aina
   `categoryId`:n perusteella, ei tekstivertailulla.
5. **`torneopal.net`-rajapinnat rajoittavat pyyntötahtia** (Cloudflare 403
   jos hakkaa liikaa peräkkäin lyhyessä ajassa) — jos teet manuaalista
   tutkimusta curlilla, odota sekunteja pyyntöjen välissä tai käytä
   selainta `fetch()`:n kautta sen sijaan (ei näyttänyt kärsivän samasta
   rajoituksesta tässä projektissa).

## Ylläpito

- **Uuden sarjan lisääminen** olemassa olevaan TorneoPal-lajiin: lisää
  `category_id` kyseisen lajin `ALLOWED_CATEGORIES`/`allow`-settiin
  ([scripts/fetch-jalkapallo.js](scripts/fetch-jalkapallo.js) tai
  [index.html](index.html):n `SOURCES`) JA vastaava rivi
  `KNOWN_SERIES`-rekisteriin ([index.html](index.html)) jotta sarja näkyy
  tarkennetussa haussa myös silloin kun sillä ei ole otteluita juuri nyt.
- **Datan päivitystiheys**: joka 4. tunti + manuaalisesti GitHubin
  Actions-välilehdeltä ("Run workflow" -painike
  [update-data.yml](.github/workflows/update-data.yml):lle).
- Testaus paikallisesti: `python3 -m http.server <portti>` projektin
  juuressa + selain — ei vaadi Node/npm:ää paikallisella koneella (niitä ei
  ollut asennettuna kehityksen aikana, joten Playwright-skriptit on aina
  testattu vasta oikeasti GitHub Actionsissa, ei paikallisesti).

## Ideoita jatkoa varten

- Salibandy: laajenna kattamaan myös muut mahdolliset uudet PK-joukkueet
  jos niitä nousee sarjaan.
- Jääpallo: token-metsästys jatkuu, tai vaihtoehtoisesti sama
  HTML-upotus-tekniikka kuin salibandyllä jos finbandy.torneopal.fi
  osoittautuu sisältävän vastaavan datan.
- Mestis/Auroraliiga: harkitse paikallista cron-ajoa käyttäjän omalta
  koneelta jos IP-esto muuten estää.
- Naisten maajoukkueet (Helmarit ym.) — ei vielä tutkittu löytyykö niille
  vastaava `category_id` samasta Palloliitto-rajapinnasta kuin Huuhkajille.
