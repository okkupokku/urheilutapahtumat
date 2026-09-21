# CLAUDE.md - urheilutapahtumat

Tekninen muistiinpano tuleville Claude-istunnoille (ja ihmisille). Tämä
tiedosto sisältää tietoa joka on löydetty kantapään kautta (API-tokenien
metsästys, kategoriatunnisteiden selvitys, bugikorjaukset) - lue ennen kuin
alat "keksimään pyörää uudelleen".

## Mikä tämä on

Yksisivuinen staattinen sivusto ([index.html](index.html)), joka näyttää
pääkaupunkiseudun (Helsinki/Espoo/Vantaa/Kauniainen) urheiluottelut listana
ja kartalla. Ei backendiä ajon aikana - kaikki suodatus tapahtuu selaimessa.
Julkaistu GitHub Pagesilla osoitteessa
https://okkupokku.github.io/urheilutapahtumat/

Sivulla on oma "Tietoa tästä sivustosta" -paneeli (kiinni oletuksena, aivan
sivun alaosassa) joka selittää käyttäjälle saman asian lyhyemmin - pidä
se ajan tasalla jos teet isoja muutoksia.

## Kirjoitustyyli

**Ei koskaan em dashia (—, U+2014)** - ei käyttöliittymätekstissä, ei
koodikommenteissa, ei tämän tiedoston proosassa, ei commit-viesteissä.
Käytä sen sijaan tavallista väliviivaa lyöntien kanssa ("sana - sana") tai
pilkkua/kaksoispistettä jos se sopii paremmin lauseeseen. Sääntö on
käyttäjän eksplisiittinen toive (2026-09-20) - kaikki tämän päivämäärän
jälkeen kirjoitettu teksti noudattaa tätä.

## Käyttöliittymän suodattimet

- **Ei "Muu"-vaihtoehtoa SUKUPUOLI- tai KAUPUNKI (ent. ALUE) -suodattimissa**
  (2026-09-21, käyttäjän eksplisiittinen toive). Kaikki sarjat ovat aina
  miesten tai naisten, ja PK-seudulla ei ole muita kaupunkeja kuin Helsinki/
  Espoo/Vantaa/Kauniainen (kaikki lähteet suodattavat jo PK-alueeseen).
  `DISPLAY_GENDERS`/`DISPLAY_CITIES` [index.html](index.html):ssä listaavat
  vain nämä - älä lisää "Muu"-vaihtoehtoa takaisin. Jos jokin data-arvo
  tuottaisi jotain muuta, se on datavirhe joka pitää korjata lähteessä (ks.
  Käsipallon `Maa`-kategoria-bugi alla), ei suodattimeen lisättävä
  paniikkinappi.
- `genderGroup`-kentän oletusarvo (kun `category_group_name` puuttuu) on
  `'Miehet'`, ei `'Muu'` - sama sääntö.

## Ottelusivujen linkit

Jokainen ottelu voi kantaa valinnaisen `matchUrl`-kentän joka linkittää
otteluohjelman sarjan nimeen (näkyy listassa "Sarja ↗" -linkkinä,
[index.html](index.html):n `renderBoard()`). Löydetyt URL-kaavat
(2026-09-21):
- **TorneoPal-federaatiot** (jalkapallo/futsal, koripallo, lentopallo,
  käsipallo): kaikilla sama polku `<federaation oma tulospalvelu-domain>/
  match/<match_id>` - `match_id` tulee suoraan `getMatches`-vastauksen
  `match_id`-kentästä. Domainit ovat ERI kuin `*-api.torneopal.net`
  (jotka ovat vain rajapinta, ei julkista sivua):
  - Jalkapallo/futsal: `tulospalvelu.palloliitto.fi`
  - Koripallo: `tulospalvelu.basket.fi`
  - Lentopallo: `tulospalvelu.lentopallo.fi`
  - Käsipallo: `tulospalvelu.finnhandball.net`
  - (löytöjärjestys: kunkin liiton oma etusivu → linkki "Tulospalvelu")
- **Liiga.fi**: `https://liiga.fi/fi/peli/<season>/<id>` (`season`/`id`
  suoraan `getMatches`-vastauksen kentistä `season`/`id`). Sivu on
  React-SPA - lataa hetken ennen kuin sisältö näkyy, mutta itse URL toimii
  suoraan ilman kyselyparametreja.
- **Jääpallo**: `https://finbandy.torneopal.fi/taso/ottelu.php?ottelu=<id>`
  - **HUOM:** tämä `<id>` on ERI kuin taulukossa näkyvä "Nro"-sarake
    (`ml_ottelunro`, esim. 546) - oikea id löytyy vain `<li>`-elementin
    ympäröivästä `<a href="...ottelu=NNNNN">`-linkistä. Ks.
    [scripts/fetch-jaapallo.js](scripts/fetch-jaapallo.js):n
    `extractMatches()`.
  - **Mestis**: `https://mestis.fi/fi/ottelut/<kausi>/runkosarja/<id>/` -
    `id` on jo talteen otettu ottelurivin hrefistä.
  - **Salibandy** (fliiga.com, korjattu 2026-09-21): ottelusivu on
    olemassa (jokaisella ottelukortilla "Ottelukeskus"-linkki), mutta sen
    URL ei ole erillinen kenttä upotetussa datassa - se pitää RAKENTAA
    itse: `https://fliiga.com/ottelut/<miehet|naiset>/<koti-slug>-
    <vieras-slug>-<d>-<m>-<yyyy>/` (päivämäärä ilman etunollia). Joukkueen
    slug saadaan `slugify()`-funktiolla (pienet kirjaimet, äöå -> aoa,
    muu -> väliviiva) suoraan samoista `home_club`/`away_club`-kentistä
    joita muutenkin käytetään - ei tarvitse erillistä nimikartoitusta,
    vaikka joukkuesivun oma URL-slug olisikin eri (esim. joukkuesivu on
    `/westend-indians/` mutta `home_club`-kenttä ja siten myös
    ottelu-URL käyttävät pelkkää "Indians"). Vahvistettu vertaamalla
    rakennettuja URL:eja oikeisiin "Ottelukeskus"-linkkeihin sivulla -
    täsmäsivät täydellisesti. Ks.
    [scripts/fetch-salibandy.js](scripts/fetch-salibandy.js):n
    `slugify()`.

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

**Kaikkien category_id:iden listaus ilman live-dataa:** TorneoPal-alustalla on
myös `GET .../taso/rest/getCategories?all_current=1` (sama Accept-header),
joka palauttaa JOKAISEN kauden voimassa olevan sarjan/kilpailun tiedot
(kentät mm. `category_id`, `category_name`, `category_group_name`,
`sport_id`, `organiser_name`, `competition_name`) ilman että millään
kategorialla tarvitsee olla ottelua juuri nyt. Tämä on paljon nopeampi tapa
löytää oikeita category_id:itä kuin `getMatches`-päivien läpikäynti - käytä
tätä ensin kun etsit uutta sarjaa. Esim. Palloliiton maajoukkuesarjat
löytyivät suodattamalla `organiser_name === 'Maaottelut'`.

**Koko kauden haku yhdellä kutsulla (2026-09-20, tärkeä löytö):**
`getMatches?date=YYYY-MM-DD` palauttaa vain yhden päivän dataa koko maasta,
mutta `getMatches?category_id=X&competition_id=Y` (ilman date-parametria
lainkaan) palauttaa KOKO KAUDEN kyseiselle sarjalle yhdellä kutsulla.
`competition_id` löytyy kutakin `category_id`:tä vastaavasta
`getCategories?all_current=1`-tietueesta (kenttä `competition_id`, esim.
Veikkausliigalla `spljp26` kaudella 2026, Palloliiton maajoukkueilla
`maajp2026`). Ilman category_id/competition_id-paria date_start/date_end-
parametrit palauttavat virheen `"Not enough limits"` - rajapinta vaatii
jomman kumman rajauksen. Tämä tekniikka korvasi kaikkialla aiemman
päiväkohtaisen silmukan (`fetchTorneoPalCategories()` index.html:ssä,
sama periaate `scripts/fetch-jalkapallo.js`:ssä) - paljon vähemmän
pyyntöjä (yksi per sarja koko kaudelle) eikä siis myöskään yhtä altis
Cloudflaren pyyntötahdin rajoitukselle (ks. sudenkuoppa alla).

Sama pätee **Liiga.fi:hin**: `date`-parametrin jättäminen kokonaan pois
(`https://liiga.fi/api/v2/games?tournament=runkosarja`) palauttaa koko
kauden (syyskuu-maaliskuu) yhtenä JSON-taulukkona, ei `{games:[...]}`-
kääreessä kuten päiväkohtainen haku.

Muita olemassa olevia mutta **avainta ei löydetty** -alidomeeneja (palauttavat
`Invalid db` ilman oikeaa Accept-headeria, eli alusta on olemassa mutta
token puuttuu): `bandy-api.torneopal.net`, `floorball-api.torneopal.net`,
`jaapallo-api.torneopal.net`, `finbandy-api.torneopal.net`,
`sfl-api.torneopal.net`, `fliiga-api.torneopal.net`. Jääpallolle (ks. alla)
löytyi kuitenkin ratkaisu ilman tokenia - samaan tapaan kuin salibandylle.

**category_id → sarja -mappaus** (ylin sarjataso, käsin selvitetty
tarkistamalla oikea live-data eri päiviltä - katso `KNOWN_SERIES` vakio
[index.html](index.html):ssä, joka on tämän taulukon "source of truth"):
- Jalkapallo: `VL`=Veikkausliiga, `M1L`=Ykkösliiga, `NL`=Naisten Kansallinen
  Liiga (esiintyy usein sponsorinimellä esim. "Briotech Kansallinen Liiga").
  A-maajoukkueet (vahvistettu `getCategories`-rajapinnasta): `UNL`/`WUNL`=
  UEFA Nations League (Huuhkajat/Helmarit), `WCQ`/`WWCQ`=MM-karsinnat,
  `ECQ`/`WECQ`=EM-karsinnat, `Miehet-A`/`Naiset-A`=A-maaottelut
  (ystävyysottelut). Näiden lisäksi rajapinnassa on kymmeniä nuorten
  maajoukkuesarjoja (`U21M`, `U21ECQ`, `U19M`, `U17M`, jne. - ks.
  "Ideoita jatkoa varten") joita ei ole vielä lisätty.
- Futsal: `FML`=Miesten Futsal-Liiga, `FNL`=Naisten Futsal-Liiga - **HUOM:**
  näiden `sport_id` on `"futsal"`, EI `"football"` - jos suodatat
  `sport_id`:n mukaan, muista sallia molemmat.
- Koripallo: `4`=Korisliiga (M), `1`=Naisten Korisliiga (N), `15`=Miesten
  Suomen cup. Maajoukkueet: `44116`=Miehet, `45052`=Naiset ("Kansainväliset",
  Koripalloliitolla ei erottele MM-/EM-karsintoja omiksi kategorioiksi kuten
  Palloliitto). Löytyi myös `45051`=Miesten haastajamaajoukkue (B-joukkue),
  ei lisätty (ei koettu tarpeeksi relevantiksi).
- Käsipallo: `SM-liiga`=Miesten Aktialiiga, `NSM`=Naisten Aktialiiga,
  `MSC`=Miesten Suomen Cup, `NSC`=Naisten Suomen Cup. Maajoukkueet:
  `Maa-M`/`Maa-N` (miehet/naiset) - **HUOM (2026-09-21 löydetty bugi ja
  korjaus):** rajapinnan oma `Maa`-kategoria on YHTEINEN kaikille
  ikäluokille (aikuiset JA kaikki nuorten maajoukkueet, esim. P06/T10),
  ja jokaisen ottelun `category_group_name`-kenttä on kirjaimellisesti
  aina `"Maajoukkueet"` riippumatta oikeasta sukupuolesta/ikäluokasta -
  täysin hyödytön kenttä. Oikea sukupuoli ja ikäluokka pääteltiin
  joukkueiden nimien päätteestä (`kasipalloMaaGender()`
  [index.html](index.html):ssä): `"FIN M"`/`"CRO M"` = miehet, `"FIN
  N"`/`"KOS N"` = naiset, `"FIN P06"`/`"LAT T10"` (kirjain + kaksinumeroinen
  syntymävuosi) = nuoret, jätetään pois. `fixKasipalloMaajoukkue()`
  muuttaa live-datan categoryId:n `Maa`:sta `Maa-M`/`Maa-N`:ksi jotta
  molemmat sukupuolet saavat oman rivinsä hierarkiassa (sama `id` ei voisi
  näkyä kahdesti). **Jos joskus lisäät toiselle lajille vastaavan
  "yhteinen id, oikea tieto vain joukkuenimistä" -ratkaisun, kopioi tämä
  malli.**
- Lentopallo: `NL`=Naisten Mestaruusliiga (vahvistettu livenä). `ML`=Miesten
  Mestaruusliiga - **ei koskaan nähty livenä tässä projektissa** (kausi ei
  ollut käynnissä haun aikaan, vain "PREM"-preseason-otteluita näkyi), joten
  tarkista jos sarja ei koskaan tuota tuloksia. Maajoukkueet (miehet): `EM`,
  `EM-Karsinta`, `GLM`=Kultainen liiga, `ELM`=Euroopan liiga, `Maaottelu`=
  harjoitusottelut. Maajoukkueet (naiset): `EL`=Euroopan liiga, `Harj`=
  harjoitusottelut. Eurooppalaiset seuracupit: `CLM`/`CHL`/`CEVC`=
  Mestareiden liiga/Challenge liiga/CEV Cup (miehet), `CEVcup`/`CHLW`
  (naiset) - nämä ovat klubijoukkueiden, ei maajoukkueen, otteluita.
  Käsipallolla vastaava on `EC_M`=EHF European Cup (vain miehet, naisten
  vastaavaa ei löytynyt getCategories-hausta).

**Kolmas hierarkiataso "Eurooppalaiset seurasarjat":** `KNOWN_SERIES`:n
`group`-kenttä voi olla `'seura'` (oletus), `'maajoukkue'` tai `'eurooppa'`
(kotimaisten klubien kansainväliset cupit, esim. jääkiekon Champions Hockey
League, jalkapallon UEFA-cupit). `renderHierarchy()` näyttää kaikki kolme
ryhmää omina otsikoinaan kun lajilla on useampi kuin yksi. Jalkapallolle,
koripallolle, jääkiekolle ja salibandylle ei löytynyt avointa dataa
eurooppalaisille seuracupeille (UEFA/FIBA/IIHF järjestävät ne itse, eivät
näy TorneoPal- tai Liiga.fi-rajapinnoissa) - nämä ovat siis `PH-EUR-`-
paikanvaraajia, ei todellista dataa.

`isPKAreaTorneoPal()` suodattaa alueen `venue_area_name`/`venue_city_name`
-kentistä. **Käsipalloliiton data sisältää ylimääräisiä välilyöntejä**
näissä kentissä (esim. `"Kauniainen          "`) - kaikki kaupunki-/
paikkakentät trimmataan siksi aina (`.trim()`).

### Liiga.fi (jääkiekko, Liiga)
`GET https://liiga.fi/api/v2/games?tournament=runkosarja&date=YYYY-MM-DD`,
ei avainta, avoin CORS. `tournament`-parametrin väärä arvo palauttaa 403
(kokeiltu: vain `runkosarja`/`playoffs`/`playout` toimivat - muut liigat
kuten Mestis eivät ole tällä samalla API:lla ollenkaan).

### Salibandy (F-liiga) - fliiga.com
Ei julkista JSON-rajapintaa. **Löytö:** jokaisen joukkueen oma sivu
(`fliiga.com/<slug>/miehet|naiset/`) sisältää koko kauden ottelut valmiiksi
upotettuna palvelinrenderöityyn HTML:ään yhtenä JSON-tekstilohkona (WP-
artikkelidataa), **ilman kenoviivapakoja** (siis suoraan `"gameday":123`,
ei `\"gameday\":123`). Jokaisella ottelulla on `venue`-kenttä joka kertoo
oikean pelipaikan **sekä koti- että vierasotteluille** - tätä käytetään
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
rajapinnasta - jos ne osoittautuvat väärin, korjaa `PK_VENUES`-taulukko
[scripts/fetch-salibandy.js](scripts/fetch-salibandy.js):ssä.

Jos F-liigaan nousee/laskee joukkueita, tämä lista pitää päivittää käsin
(`TEAM_PAGES`-taulukko samassa tiedostossa) - ei automaattista tapaa
havaita tätä.

Muita tutkittuja reittejä jotka **eivät** toimineet: `wp-admin/admin-ajax.php`
-kutsut (`team-standing`, `team-live-match`, `team-birthdays` - ei sisällä
otteluohjelmaa), iframe `engine.groweo.com` (vain chat-widget, ei dataa,
"Groweo" on asiakaspalvelu-chatbot-alusta, ei liity otteluihin mitenkään).

### Jääpallo (Bandyliiga) - finbandy.torneopal.fi
Käyttäjä löysi 2026-09-20 osoitteen `finbandy.torneopal.fi/taso/
seurat.php?seura=<ID>` - jokaisen seuran oma sivu, joka listaa koko kauden
ottelut. Sivu on **täysin palvelinrenderöity** (ei yhtään XHR/fetch-kutsua,
vahvistettu verkkoliikenteestä) eli aiemmin dokumentoitu "token ei paljastu"
-este pätee yhä `getMatches`-rajapinnalle, mutta sitä ei tarvita: HTML on
niin siistiä (`<li class='match'>` jonka lapsilla selkeät luokkanimet
`ml_ottelunro`/`ml_sarja`/`ml_sarjanimi`/`ml_pvm`/`ml_kenttanimi`/
`ml_kotisiisti`/`ml_kotilogo`/`ml_tulosklo`/`ml_vieraslogo`/
`ml_vierassiisti`) että se puretaan suoraan regexillä ilman JSON:ia -
yksinkertaisempi tekniikka kuin salibandyn upotetun-JSON-purku.

Koska data haetaan seurakohtaisilta sivuilta (ei päivähaulla kuten muut
TorneoPal-lajit), **ei tarvita category_id-sallittulistaa** - kaikki
kyseisen seuran sivulla näkyvät ottelut ovat relevantteja, PK-alue
suodatetaan `ml_kenttanimi`-kentän perusteella (vrt. salibandyn
`PK_VENUES`-tekniikka).

PK-seudun seurat (`/taso/seurat.php`-listauksesta, `Kotikunta`-kenttä
tarkistettu): `seura=2`=HIFK (Miesten Bandyliiga, kotikenttä "Kallio tj,
Hki"), `seura=3`=Botnia (Miesten Bandyliiga, "Oulunkylä tj, Hki"),
`seura=12`=Vesta (Divari eli alempi sarja - ei otteluita julkaistu
2026-09-20 mennessä, joten Vestan sarjan oikeaa `category_id`:tä ei ole
vielä nähty livenä; `level`-päättely koodissa on `sarjanimi.includes
('Bandyliiga') ? 'paasarja' : 'alempi'` joten se toimii silti oikein heti
kun Vestan otteluita ilmestyy). **HUOM:** Akilles (huolimatta Helsinki-
tuntuisesta nimestä) on Porvoosta, ei PK-seutua - tarkistettu erikseen.

**Ottelun kellonaika ei ole tiedossa kuukausia etukäteen** julkaistulle
otteluohjelmalle (näkyy `--:--`) - `scripts/fetch-jaapallo.js` tallentaa
tällöin tyhjän `time`-kentän, joka näytetään sovelluksessa viivana ("–").
Aika todennäköisesti tarkentuu lähempänä ottelupäivää, mutta tätä ei ole
vielä nähty käytännössä (kausi ei ole käynnissä).

Katso [scripts/fetch-jaapallo.js](scripts/fetch-jaapallo.js) täydelle
purkulogiikalle. Skripti tallentaa koko loppukauden PK-seudun ottelut (ei
enää päiväikkunaa, ks. "AJANKOHTA-suodattimen laajennus 2026-09-20" alla) -
asiakas suodattaa näytettävän aikavälin AJANKOHTA-valinnan mukaan.

### Jääkiekko - Mestis - mestis.fi
Leijonien virallinen tulospalvelu (tulospalvelu.leijonat.fi) on
CloudFront-suojattu ja torjuu GitHub Actionsin (ks. "Tunnetut
infrarajoitukset" alla) - tätä ei ole ratkaistu. Käyttäjä löysi kuitenkin
2026-09-20 osoitteen `mestis.fi/fi/ottelut/<kausi>/runkosarja/`, joka on
Suomen Jääkiekkoliiton eri, avoin palvelu samalle sarjalle eikä ole
IP-estetty (samat staattiset resurssit `static/liiga/...` viittaavat
siihen että Liiga.fi ja Mestis.fi jakavat saman julkaisualustan, mutta
Mestis.fi ei ole CloudFrontin takana).

Sivu on palvelinrenderöity HTML (ei JSON-rajapintaa, ei CORS-headeria).
Koko kauden otteluohjelma on yhdellä sivulla `<tr data-time="YYYYMMDD">`
-riveinä, joten päiväkohtaista hakua ei tarvita - sama periaate kuin
jääpallon seurat.php-sivuilla. **HUOM samasta Playwright-DOM-serialisointi-
sudenkuopasta kuin jääpallolla:** regexit hyväksyvät sekä `"` että `'`
lainausmerkkeinä.

PK-seudulla on vain yksi Mestis-joukkue: **K-Vantaa** (Kiekko-Vantaa),
kotihalli "Läntinen Valkoisenlähteentie 52-54, 01300 Vantaa" (osoite
vahvistettu mestis.fi:n joukkuesivulta `/fi/joukkueet/k-vantaa/`,
koordinaatit manuaalisesti haettuja likiarvoja). Vain K-Vantaan
KOTIOTTELUT ovat PK-seudulla - muiden joukkueiden (Hermes/Kokkola,
IPK/Iisalmi, JoKP/Joensuu, Ketterä/Imatra, KeuPa HT/Jyväskylä,
Pyry/Kemi-Tornio, RoKi/Rovaniemi, TUTO Hockey/Turku) kotikaupungit ovat
kaikki PK-seudun ulkopuolella.

Mestis on `KNOWN_SERIES`:ssä lisätty **Jääkiekko**-lajin alle omana
sarjana (`categoryId: 'Mestis'`, `level: 'alempi'`) - ei omana lajinaan,
koska se on sama laji kuin Liiga, vain alempi sarjataso. Auroraliigalle
(naisten ylin sarja) ei ole vielä löydetty vastaavaa avointa peilipalvelua
- se on yhä `tulospalvelu.leijonat.fi`:n takana, ks. "Tunnetut
infrarajoitukset".

## Tunnetut infrarajoitukset (ei koodilla korjattavissa)

- **Auroraliiga** (naisten ylin sarja, tulospalvelu.leijonat.fi):
  CloudFront/WAF estää GitHub Actionsin IP-alueen HTTP 403:lla -
  vahvistettu jopa täysin selaimettomalla suoralla Node-fetchillä, eli
  kyse ei ole selaimen bot-tunnistuksesta vaan verkkotason
  IP-mustalistauksesta. Toimisi jos taustaprosessi ajettaisiin jostain
  muusta verkosta (esim. käyttäjän omalta koneelta cronilla, tai
  maksullisen proxyn kautta - ei toteutettu, koska proxy maksaa ja on
  eettisesti harmaampi). ~~Mestis~~ ratkaistu 2026-09-20 löytämällä
  mestis.fi, avoin peilipalvelu joka ei ole CloudFrontin takana (ks.
  "Jääkiekko - Mestis" yllä) - sama tekniikka ei toistaiseksi ole
  löytänyt vastaavaa Auroraliigalle.
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
   -haut käyttävät `?t=${Date.now()}`-parametria - älä poista tätä.
3. **CartoDB:n ilmaiset "dark"/"positron"-rasterikartat vaativat nykyään
   API-avaimen** (näyttävät "API key required" -vesileiman). Käytössä on nyt
   sen sijaan **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron`,
   MapLibre GL -yhteensopiva vektorityyli, ei avainta, ei rajoja) - jos tämä
   joskus lakkaa toimimasta, OpenFreeMap on ainoa tunnettu täysin ilmainen
   ja avaimeton vaihtoehto tälle laadulle.
4. **`categoryId` on suodattimien avain, ei kategorian nimi** (`category`).
   Nimet muuttuvat sponsoroinnin myötä (esim. "Briotech Kansallinen Liiga"),
   joten `KNOWN_SERIES`-rekisteri ja live-data yhdistetään aina
   `categoryId`:n perusteella, ei tekstivertailulla.
5. **`torneopal.net`-rajapinnat rajoittavat pyyntötahtia** (Cloudflare 403
   jos hakkaa liikaa peräkkäin lyhyessä ajassa) - jos teet manuaalista
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
  juuressa + selain - ei vaadi Node/npm:ää paikallisella koneella (niitä ei
  ollut asennettuna kehityksen aikana, joten Playwright-skriptit on aina
  testattu vasta oikeasti GitHub Actionsissa, ei paikallisesti).
- **AJANKOHTA-suodattimen laajennus (2026-09-20):** normihaun AJANKOHTA on
  nyt Tänään / Seuraavat 7 päivää / Seuraavat 30 päivää / Kaikki saatavilla
  olevat / Valitse päivämäärät. Tämän mahdollisti yllä kuvattu koko kauden
  yhden kutsun haku - kaikki lähteet (myös scripts/fetch-*.js-skriptit)
  hakevat nyt koko kauden dataa eivätkä enää rajaa mitään DAYS_AHEAD-tyyppisellä
  ikkunalla haku- tai tallennusvaiheessa. `DAYS_AHEAD`-vakio
  [index.html](index.html):ssä tarkoittaa nykyään VAIN "Kaikki saatavilla
  olevat" -valinnan ja "Valitse päivämäärät" -valitsimen ylärajaa (370 pv),
  ei enää datanhaun rajoitinta - älä sekoita näitä jos muokkaat sitä.

## Ideoita jatkoa varten

- ~~Salibandyn ottelusivulinkki~~ - löydetty ja korjattu 2026-09-21
  (rakennetaan slugeista, ks. "Ottelusivujen linkit" yllä).
- Salibandy: laajenna kattamaan myös muut mahdolliset uudet PK-joukkueet
  jos niitä nousee sarjaan.
- ~~Jääpallo~~ - löydetty ja lisätty 2026-09-20 (käyttäjän löytämä
  seurat.php-sivu, ks. "Jääpallo (Bandyliiga)" yllä). Vestan (Divari)
  todellinen `category_id` pitää vielä vahvistaa kun sen ensimmäinen
  ottelu ilmestyy datassa. Naisten Bandyliigalle ei ole vielä tarkistettu
  löytyykö PK-seudulta joukkueita.
- ~~Mestis~~ - löydetty ja lisätty 2026-09-20 (mestis.fi, ks. "Jääkiekko -
  Mestis" yllä). Auroraliigalle (naiset) ei löytynyt vastaavaa avointa
  peilipalvelua tällä kierroksella - kannattaa kokeilla samaa hakutapaa
  (etsi "auroraliiga" + "otteluohjelma"/"runkosarja" tms.) tai harkita
  paikallista cron-ajoa käyttäjän omalta koneelta jos IP-esto muuten estää.
- ~~Naisten maajoukkueet (Helmarit ym.)~~ - löydetty ja lisätty (`WUNL`,
  `WWCQ`, `WECQ`, `Naiset-A`), ks. yllä.
- Nuorten maajoukkueet (jalkapallo): Palloliiton `getCategories`-haku
  paljasti kymmeniä valmiita category_id:itä, esim. `U21M`/`U21ECQ`
  (EM-karsinnat U21-miehet), `U19M`, `U17M`, `WU19M`, `WU17M` jne. Näillä on
  oikeasti otteluita (esim. U21-EM-karsinnat 25.9.2026 Tampereella) mutta ei
  vielä nähty PK-seudulla - voisi lisätä KNOWN_SERIES:iin ja
  ALLOWED_CATEGORIES:iin samaan tapaan kuin A-maajoukkueet, jolloin ne
  ilmestyvät automaattisesti kun ottelu osuu PK-alueelle.
- ~~Muille TorneoPal-lajeille (koripallo, käsipallo, lentopallo)~~ - tehty:
  `getCategories?all_current=1` löysi maajoukkue-id:t kaikille kolmelle
  (ks. yllä), lisätty sekä `KNOWN_SERIES`:iin että kunkin lajin `SOURCES`-
  entryn `allow`-settiin index.html:ssä.
- Salibandy ja jääkiekko (Leijonat) ovat ainoat lajit joiden maajoukkueet
  ovat yhä `PH-`-paikanvaraajia - kummallakaan ei ole tiedossa avointa
  rajapintaa (jääkiekon Liiga.fi ei kata maajoukkuetta lainkaan, salibandyn
  fliiga.com:sta ei löytynyt maajoukkuesivua `/maajoukkueet/`-osoitteesta).
  Jos näille löytyy joskus data, sama korvausmenettely kuin jalkapallolle.
- Eurooppalaiset seuracupit (uusi `group: 'eurooppa'`, ks. yllä): lentopallon
  ja käsipallon (miesten EC_M) osalta oikeaa dataa on jo mukana. Jalkapallon
  UEFA-cupit, koripallon FIBA-cupit, jääkiekon Champions Hockey League ja
  salibandyn Champions Cup ovat `PH-EUR-`-paikanvaraajia, koska niitä
  järjestävät kansainväliset kattojärjestöt (UEFA/FIBA/IIHF/IFF) eivätkä ne
  näy Suomen liittojen omissa rajapinnoissa - vaatisi kunkin kattojärjestön
  oman (todennäköisesti maksullisen tai suljetun) rajapinnan.
