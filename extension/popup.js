// storage.session staat alleen in het werkgeheugen van de browser: niet op schijf,
// niet gesynchroniseerd, weg zodra de browser sluit. Daar staan de persoonsgegevens.
// storage.local bewaart alleen veldkoppelingen per portaal (en HRSuite), gekoppelde pagina's en welke site bij welk portaal hoort.
// Sinds v0.5 is elke site een portaal: id = de site ("healthservice.example"), of een van de vier bekende (insurera, insurerb, healthdesk, travelcard).
const sessie = chrome.storage.session;
const lokaal = chrome.storage.local;
const M = globalThis.AdressenboekjeMatcher;
const { PORTALEN, portaal: portaalVan, portaalVoorHost, siteId } = globalThis.AdressenboekjePortalen;
const form = document.getElementById('profiel');
let gekozen = null; // het portaal op het tweede tabje
let siteHost = '';  // de site van het open tabblad

// Verzonnen testpersoon, geen echte gegevens.
const TESTPERSOON = {
  bsn: '111222333', voorletters: 'T.J.', voornamen: 'Test Jan', roepnaam: 'Test', tussenvoegsel: 'van der', achternaam: 'Persoon',
  tussenvoegselPartner: 'de', achternaamPartner: 'Partner', geslacht: 'M', geboortedatum: '1995-03-07',
  straat: 'Teststraat', huisnummer: '12', toevoeging: 'A', postcode: '1234AB', woonplaats: 'Utrecht', land: 'Nederland',
  emailWerk: 'test.persoon@werk.example', emailPrive: 'test.persoon@prive.example', telefoon: '0301234567', mobiel: '0612345678',
  datumInDienst: '2026-11-01', functie: 'Consultant', afdeling: 'Voorbeeld BV', urenPerWeek: '32', fulltimeUren: '40',
  maandloon: '3500', dertiendeMaand: 'nee', taal: 'Nederlands', dienstverband: 'onbepaald',
};

// ---- Tabje HRSuite: formulier opbouwen uit de veldenlijst ----

function bouwFormulier() {
  const groepen = {};
  for (const v of M.VELDEN) {
    if (!groepen[v.groep]) {
      const fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${v.groep}</legend><div class="raster"></div>`;
      form.appendChild(fs);
      groepen[v.groep] = fs.querySelector('.raster');
    }
    const label = document.createElement('label');
    if (v.gevoelig) label.classList.add('gevoelig');
    if (v.berekend) label.classList.add('berekend');
    label.append(v.label);
    let veld;
    if (v.keuzes) {
      veld = document.createElement('select');
      for (const [waarde, tekst] of v.keuzes) veld.add(new Option(tekst, waarde));
    } else {
      veld = document.createElement('input');
      veld.type = v.type || 'text';
      if (v.hint) veld.placeholder = v.hint;
      if (v.standaard) veld.value = v.standaard;
    }
    veld.name = v.sleutel;
    label.appendChild(veld);
    groepen[v.groep].appendChild(label);
  }
}

function leesFormulier() {
  return Object.fromEntries(new FormData(form).entries());
}

function zetFormulier(profiel) {
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = M.VELDEN.find(x => x.sleutel === el.name);
    el.value = profiel[el.name] != null ? profiel[el.name] : (v && v.standaard) || (el.tagName === 'SELECT' ? el.options[0].value : '');
  }
  toonBerekend();
}

// Laat in lege velden zien wat de extensie zelf invult (voorletters, parttime %, salaris).
function toonBerekend() {
  const p = leesFormulier();
  const a = M.afleiden(p);
  for (const sleutel of ['voorletters', 'roepnaam', 'parttimePercentage', 'jaarsalaris', 'fulltimeJaarsalaris', 'ingangsdatumKaart']) {
    const el = form.elements[sleutel];
    if (!el || el.type === 'date') continue;
    const v = M.VELDEN.find(x => x.sleutel === sleutel);
    el.placeholder = !p[sleutel] && a[sleutel] ? 'berekend: ' + (sleutel === 'voorletters' ? M.formatVoorletters(a[sleutel]) : a[sleutel]) : (v.hint || '');
  }
  const naam = [p.roepnaam || (a.roepnaam || ''), p.tussenvoegsel, p.achternaam].filter(Boolean).join(' ');
  document.getElementById('wie').textContent = naam ? 'Gegevens van: ' + naam : 'Nog geen gegevens: begin op het tabje HRSuite.';
}

async function bewaar() {
  await sessie.set({ profiel: leesFormulier() });
  toonBerekend();
}

// ---- Tabjes: HRSuite en het portaal van de open site ----

function bouwTabs() {
  const tabs = document.getElementById('tabs');
  for (const [id, naam] of [['hrsuite', 'HRSuite'], ['portaal', 'Deze site']]) {
    const b = document.createElement('button');
    b.id = 'tab-' + id;
    b.dataset.tab = id;
    b.textContent = naam;
    b.addEventListener('click', () => toonTab(id === 'hrsuite' ? 'hrsuite' : gekozen || 'portaal'));
    tabs.appendChild(b);
  }
}

// id: 'hrsuite' of een portaal-id. 'portaal' zonder portaal = er is geen site open (nieuw tabblad).
function toonTab(id) {
  const hrsuite = id === 'hrsuite';
  document.getElementById('hrsuite').hidden = !hrsuite;
  document.getElementById('portaal').hidden = hrsuite;
  document.getElementById('meerhrsuite').hidden = !hrsuite;
  document.getElementById('meerportaal').hidden = hrsuite;
  document.getElementById('tab-hrsuite').classList.toggle('actief', hrsuite);
  document.getElementById('tab-portaal').classList.toggle('actief', !hrsuite);
  lokaal.set({ tab: id });
  return hrsuite ? Promise.resolve() : kies(id === 'portaal' ? null : id);
}

async function kies(id) {
  gekozen = id;
  const p = portaalVan(id);
  document.getElementById('tab-portaal').textContent = p ? p.naam : 'Deze site';
  document.getElementById('portaaluitleg').textContent = p ? p.uitleg : 'Open de pagina van het portaal en klik daar op het icoon van het adressenboekje.';
  document.getElementById('vul').textContent = p ? 'Vul deze pagina (' + p.naam + ')' : 'Vul deze pagina';
  document.getElementById('vul').disabled = !p;
  document.getElementById('rapport').textContent = '';
  document.getElementById('koppeltabel').innerHTML = '';
  if (id) lokaal.set({ laatstePortaal: id });
  await toonPaginas();
  await toonHoortBij();
  await toonAantallen();
  await toonInstellingen();
}

function zet(id, tekst) {
  document.getElementById(id).textContent = tekst;
}

async function actieveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// De browser geeft Engelse foutmeldingen; HR krijgt te horen wat ze kan doen.
function uitlegFout(e) {
  const t = String((e && e.message) || e || '');
  if (/cannot access|cannot be scripted|permission|host/i.test(t)) {
    return 'Geen toegang tot deze pagina. Klik nog eens op de knop en kies Toestaan als Edge erom vraagt. Op pagina\'s van Edge zelf (zoals een nieuw tabblad) werkt het niet.';
  }
  if (/frame with id|no tab with id|was removed|closed/i.test(t)) return 'De pagina was nog aan het laden of is net veranderd. Probeer het zo nog eens.';
  return t;
}

// Zijn er gegevens van een collega? Standaardwaarden (land, afdeling, taal) tellen niet mee.
function heeftCollega(p) {
  return !!(p.achternaam || p.voornamen || p.bsn);
}

function hostVan(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

// Liefst in alle frames; weigert de browser een frame van een andere site, dan alleen de pagina zelf.
async function voerUit(tab, details) {
  try {
    return await chrome.scripting.executeScript(Object.assign({ target: { tabId: tab.id, allFrames: true } }, details));
  } catch (e) {
    return chrome.scripting.executeScript(Object.assign({ target: { tabId: tab.id } }, details));
  }
}

// Draait een functie in alle frames van het tabblad en voegt de uitkomsten samen.
async function inTabblad(tab, func, args) {
  await voerUit(tab, { files: ['matcher.js', 'portalen.js', 'fill.js'] });
  const uit = await voerUit(tab, { func, args });
  return uit.flatMap(r => r.result || []);
}

// Toegang per site: de eerste keer vraagt Edge of de extensie deze site mag lezen.
// Het verzoek moet direct in de klik zitten, daarom wordt het tabblad bij het openen al opgehaald.
// Staat het scherm (of een deel) in een iframe van een andere site, dan vragen we in dezelfde klik ook voor die site toegang.
let huidigeTab = null;
let frameSites = [];
function metToegang(fn) {
  return () => {
    const url = (huidigeTab && huidigeTab.url) || '';
    const verzoek = /^https?:/.test(url)
      ? chrome.permissions.request({ origins: [new URL(url).origin + '/*'].concat(frameSites.map(o => o + '/*')) }).catch(() => false)
      : Promise.resolve(false);
    verzoek.then(() => fn());
  };
}

// Plakken: Ctrl+A/Ctrl+C op een pagina zet de pagina als HTML op het klembord; die nemen we in plaats van de platte tekst.
// Daarna meteen velden zoeken, zodat HR alleen hoeft te plakken.
function plakVak(vakId, knopId) {
  const vak = document.getElementById(vakId);
  vak.addEventListener('paste', e => {
    const html = e.clipboardData.getData('text/html');
    if (html) { e.preventDefault(); vak.value = html; }
    setTimeout(() => document.getElementById(knopId).click(), 0);
  });
}

// Geplakte HTML wordt alleen gelezen, nooit uitgevoerd: DOMParser draait geen scripts en laadt niets.
function leesHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bron = html.match(/saved from url=\(\d+\)(\S+)/);
  return { doc, titel: (doc.title || '').trim(), host: bron ? hostVan(bron[1]) : '' };
}

// ---- Koppelingen opslaan ----

const zelfde = (a, b) => a.id === b.id && a.name === b.name && a.label === b.label && a.nr === b.nr;

async function koppelingenVan(id) {
  const { koppelingen = {} } = await lokaal.get('koppelingen');
  return koppelingen[id] || [];
}

// Een veld dat al gekoppeld was, krijgt de nieuwe koppeling in plaats van een dubbele.
async function bewaarKoppelingen(id, nieuw, pagina) {
  const { koppelingen = {}, paginas = {} } = await lokaal.get(['koppelingen', 'paginas']);
  koppelingen[id] = (koppelingen[id] || []).filter(k => !nieuw.some(n => zelfde(n.veld, k.veld))).concat(nieuw);
  if (pagina) {
    paginas[id] = (paginas[id] || []).filter(p => p.id !== pagina.id).concat(pagina);
    // Pagina's waarvan alle koppelingen door een nieuwere pagina zijn overgenomen, vallen weg.
    paginas[id] = paginas[id].filter(p => koppelingen[id].some(k => k.pagina === p.id));
  }
  await lokaal.set({ koppelingen, paginas });
}

// ---- De koppeltabel: elk gevonden veld met de gok van de extensie ----
// rijen: [{ vingerafdruk, naam, sleutel, waarde? }]. Bij opslaan krijgt opslaan() de rijen met de gekozen sleutel.

function toonKoppeltabel(doos, rijen, { metWaarde, telefoon, kop, opslaan }) {
  doos.innerHTML = '';
  if (!rijen.length) return;
  const keuzes = globalThis.AdressenboekjeKeuzes();
  const blok = document.createElement('div');
  blok.className = 'koppeltabel';
  blok.innerHTML = `<div class="uitleg"></div><div class="rijen"><table><tbody></tbody></table></div>
    <div class="knoppen"><button class="hoofd opslaan">Opslaan</button><button class="annuleer">Annuleren</button></div>`;
  const tbody = blok.querySelector('tbody');
  const lijsten = rijen.map(rij => {
    const tr = document.createElement('tr');
    let huidig = rij.sleutel === 'telefoonOfMobiel' ? telefoon : rij.sleutel === 'bedrijf' ? 'overslaan' : M.LEEG.includes(rij.sleutel) ? 'leeg' : rij.sleutel;
    const s = document.createElement('select');
    for (const [w, t] of keuzes) s.add(new Option(t, w));
    if (huidig && keuzes.some(k => k[0] === huidig)) s.value = huidig; else { s.value = 'overslaan'; tr.classList.add('onbekend'); }
    s.addEventListener('change', () => tr.classList.remove('onbekend'));
    const f = rij.vingerafdruk;
    tr.innerHTML = '<td></td>' + (metWaarde ? '<td class="waarde"></td>' : '') + '<td></td>';
    tr.children[0].textContent = rij.naam + (f.nr > 1 ? ' (' + f.nr + 'e)' : '');
    tr.children[0].title = [f.type, f.id && '#' + f.id, f.name && 'name=' + f.name].filter(Boolean).join(' ');
    if (metWaarde) { tr.children[1].textContent = rij.waarde || ''; tr.children[1].title = rij.waarde || ''; }
    tr.lastChild.appendChild(s);
    tbody.appendChild(tr);
    return { rij, s, tr };
  });
  const onbekend = lijsten.filter(l => l.tr.classList.contains('onbekend')).length;
  blok.querySelector('.uitleg').textContent = `${kop}: ${rijen.length} velden gevonden, ${onbekend} niet herkend (rood). Zet goed wat niet klopt.`;
  blok.querySelector('.annuleer').addEventListener('click', () => { doos.innerHTML = ''; });
  blok.querySelector('.opslaan').addEventListener('click', async () => {
    await opslaan(lijsten.map(({ rij, s }) => Object.assign({}, rij, { sleutel: s.value, bron: 'geleerd' })));
    doos.innerHTML = '';
  });
  doos.appendChild(blok);
}

// ---- Tabje HRSuite: lezen uit het HRSuite-scherm ----

let laatsteLees = null; // { sleutels } die de vorige lees zette, zodat Opslaan een verkeerde gok kan terugdraaien

async function neemOver(rijen) {
  const nieuw = M.naarProfiel(rijen);
  let profiel = leesFormulier();
  // Andere collega (ander BSN of andere achternaam): begin leeg, anders blijven gegevens van de vorige staan.
  const anders = s => nieuw[s] && profiel[s] && String(nieuw[s]).trim().toLowerCase() !== String(profiel[s]).trim().toLowerCase();
  if (anders('bsn') || anders('achternaam')) { profiel = {}; laatsteLees = null; }
  if (laatsteLees) for (const s of laatsteLees.sleutels) if (!(s in nieuw)) delete profiel[s];
  Object.assign(profiel, nieuw);
  zetFormulier(profiel);
  await bewaar();
  return nieuw;
}

function meldHrSuite(nieuw, rijen) {
  const labels = Object.keys(nieuw).map(s => (M.VELDEN.find(v => v.sleutel === s) || { label: s }).label);
  const onbekend = rijen.filter(r => !r.sleutel).length;
  zet('hrsuitemelding', (labels.length ? `${labels.length} gegevens overgenomen: ${labels.join(', ')}.` : 'Geen gegevens gevonden op deze pagina.') +
    (onbekend ? `\n${onbekend} velden niet herkend: kies ze hieronder en klik Opslaan, dan weet de extensie het voortaan.` : ''));
}

function hrsuiteTabel(rijen) {
  // De HRSuite-afdeling staat standaard uit: de portalen willen Voorbeeld BV (afspraak 20-10). HR kan hem zelf aanzetten.
  rijen = rijen.map(r => r.sleutel === 'afdeling' && r.bron !== 'geleerd' ? Object.assign({}, r, { sleutel: 'overslaan' }) : r);
  toonKoppeltabel(document.getElementById('hrsuitekoppel'), rijen, {
    metWaarde: true, telefoon: 'telefoon', kop: 'HRSuite',
    opslaan: async gekoppeld => {
      await bewaarKoppelingen('hrsuite', gekoppeld.map(r => ({ veld: r.vingerafdruk, sleutel: r.sleutel })));
      const nieuw = await neemOver(gekoppeld);
      laatsteLees = { sleutels: Object.keys(nieuw) };
      zet('hrsuitemelding', `Koppeling HRSuite opgeslagen. ${Object.keys(nieuw).length} gegevens overgenomen.`);
    },
  });
}

async function haalUitHrSuite(tab) {
  tab = tab || await actieveTab();
  try {
    const koppelingen = await koppelingenVan('hrsuite');
    const rijen = await inTabblad(tab, k => globalThis.AdressenboekjeLeesLive({ koppelingen: k }), [koppelingen]);
    laatsteLees = null;
    const nieuw = await neemOver(rijen);
    laatsteLees = { sleutels: Object.keys(nieuw) };
    meldHrSuite(nieuw, rijen);
    const uitScript = rijen.filter(r => r.waar === 'script').length;
    if (uitScript) document.getElementById('hrsuitemelding').textContent += '\n' + uitScript + ' uit de paginagegevens van HRSuite (script), ' + (rijen.length - uitScript) + ' van het scherm.';
    // De lijst alleen tonen als er iets na te kijken is: de eerste keer, of als het scherm sinds de vorige keer veranderd is.
    // Bekende HRSuite-veld-Id's uit het script zijn net zo vast als een koppeling.
    const los = rijen.filter(r => r.bron !== 'geleerd' && r.bron !== 'hrsuite-id');
    const melding = document.getElementById('hrsuitemelding');
    if (!rijen.length) {
      melding.textContent = 'Geen gegevens gevonden op deze pagina. Staat de nieuwe collega open in HRSuite? Klik dan op dat scherm nog eens Haal uit HRSuite.';
    } else if (!koppelingen.length) {
      melding.textContent += '\nEerste keer op dit scherm: kijk de lijst na (rood = weet ik niet) en klik Opslaan.';
    } else if (los.length) {
      melding.textContent += `\nDit scherm is veranderd sinds de vorige keer (nieuw: ${los.slice(0, 4).map(r => r.naam).join(', ')}). Kijk de lijst na en klik Opslaan.`;
    }
    // Onthoud dat dit de HRSuite-site is, zodat de popup daar meteen op dit tabje opent.
    const host = hostVan(tab.url);
    if (host && Object.keys(nieuw).length) {
      const { hosts = {} } = await lokaal.get('hosts');
      if (hosts[host] !== 'hrsuite') { hosts[host] = 'hrsuite'; await lokaal.set({ hosts }); }
    }
    document.getElementById('hrsuitekoppel').innerHTML = '';
    if (rijen.length && (!koppelingen.length || los.length)) hrsuiteTabel(rijen);
  } catch (e) {
    zet('hrsuitemelding', 'Kon deze pagina niet lezen. ' + uitlegFout(e));
  }
}
document.getElementById('haal').addEventListener('click', metToegang(() => haalUitHrSuite()));

document.getElementById('hrsuitelees').addEventListener('click', async () => {
  const html = document.getElementById('hrsuitehtml').value;
  if (!html.trim()) return zet('hrsuitemelding', 'Plak eerst de HTML van een HRSuite-scherm.');
  const { doc } = leesHtml(html);
  const rijen = globalThis.AdressenboekjeLees({ doc, koppelingen: await koppelingenVan('hrsuite') });
  document.getElementById('hrsuitehtml').value = '';
  zet('hrsuitemelding', rijen.length ? '' : 'Geen velden gevonden in deze HTML.');
  hrsuiteTabel(rijen);
});

// ---- Portaaltabjes: pagina's koppelen ----

async function toonPaginas() {
  const { paginas = {} } = await lokaal.get('paginas');
  const lijst = paginas[gekozen] || [];
  const ul = document.getElementById('paginas');
  ul.innerHTML = '';
  for (const p of lijst) {
    const li = document.createElement('li');
    li.textContent = `${p.titel} · ${p.velden} velden · ${p.datum}`;
    const b = document.createElement('button');
    b.textContent = 'wis';
    b.title = 'Wis de koppelingen van deze pagina';
    b.addEventListener('click', () => wisPagina(p.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
  zet('aantalpaginas', lijst.length);
}

async function wisPagina(paginaId) {
  const { koppelingen = {}, paginas = {} } = await lokaal.get(['koppelingen', 'paginas']);
  koppelingen[gekozen] = (koppelingen[gekozen] || []).filter(k => k.pagina !== paginaId);
  paginas[gekozen] = (paginas[gekozen] || []).filter(p => p.id !== paginaId);
  await lokaal.set({ koppelingen, paginas });
  await toonPaginas();
  toonAantallen();
}

// Alle portalen die HR kent: de vier vaste en elke site met koppelingen of pagina's.
async function bekendePortalen() {
  const { koppelingen = {}, paginas = {} } = await lokaal.get(['koppelingen', 'paginas']);
  const ids = new Set(Object.keys(PORTALEN));
  for (const id of Object.keys(koppelingen).concat(Object.keys(paginas))) {
    if (id !== 'hrsuite' && ((koppelingen[id] || []).length || (paginas[id] || []).length)) ids.add(id);
  }
  return [...ids].map(id => ({ id, naam: portaalVan(id).naam, velden: (koppelingen[id] || []).length + portaalVan(id).koppelingen.length, paginas: (paginas[id] || []).length }));
}

async function toonAantallen() {
  const { koppelingen = {} } = await lokaal.get('koppelingen');
  const lijst = await bekendePortalen();
  zet('aantallen', 'Gekoppelde velden: HRSuite ' + (koppelingen.hrsuite || []).length + ' · ' + lijst.map(p => p.naam + ' ' + p.velden).join(' · '));
  const ul = document.getElementById('sites');
  ul.innerHTML = '';
  for (const p of lijst.filter(x => x.velden || x.paginas)) {
    const li = document.createElement('li');
    li.textContent = `${p.naam} · ${p.paginas} pagina's`;
    const b = document.createElement('button');
    b.textContent = 'bekijk';
    b.title = "Toon de pagina's van dit portaal";
    b.addEventListener('click', () => toonTab(p.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

// "Deze site hoort bij": een site die eigenlijk een van de bekende portalen is (bijvoorbeeld Insurer A op een ander adres).
async function toonHoortBij() {
  const blok = document.getElementById('hoortbijblok');
  blok.hidden = !siteHost;
  if (!siteHost) return;
  const s = document.getElementById('hoortbij');
  s.innerHTML = '';
  const eigen = siteId(siteHost);
  s.add(new Option('eigen portaal (' + eigen + ')', eigen));
  for (const p of await bekendePortalen()) if (p.id !== eigen) s.add(new Option(p.naam, p.id));
  const { hosts = {} } = await lokaal.get('hosts');
  const nu = portaalVoorHost(siteHost, hosts);
  s.value = nu === 'hrsuite' ? eigen : nu;
}

document.getElementById('hoortbij').addEventListener('change', async e => {
  const id = e.target.value;
  const { hosts = {} } = await lokaal.get('hosts');
  delete hosts[siteHost];
  if (id !== siteId(siteHost)) hosts[siteId(siteHost)] = id; else delete hosts[siteId(siteHost)];
  await lokaal.set({ hosts });
  await toonTab(id);
  zet('rapport', 'Deze site hoort nu bij ' + portaalVan(id).naam + '.');
});

// vervang: pagina-id's die deze koppeling vervangt (een veranderde pagina).
// tab: het tabblad om na Opslaan meteen te vullen (leeg bij geplakte HTML).
function portaalTabel(rijen, titel, host, vervang, tab) {
  const id = gekozen;
  const nr = Date.now().toString(36);
  toonKoppeltabel(document.getElementById('koppeltabel'), rijen, {
    telefoon: 'mobiel', kop: titel,
    opslaan: async gekoppeld => {
      if (vervang && vervang.length) {
        const oud = await lokaal.get(['koppelingen', 'paginas']);
        const k = oud.koppelingen || {}, p = oud.paginas || {};
        k[id] = (k[id] || []).filter(x => !vervang.includes(x.pagina));
        p[id] = (p[id] || []).filter(x => !vervang.includes(x.id));
        await lokaal.set({ koppelingen: k, paginas: p });
      }
      const { paginas = {} } = await lokaal.get('paginas');
      const naam = titel || 'Pagina ' + ((paginas[id] || []).length + 1);
      // Wat al uit de vaste koppelingen (portalen.js) komt en niet veranderd is, bewaren we niet nog eens:
      // dan geldt bij een nieuwe versie van de extensie de verbeterde vaste koppeling.
      gekoppeld = gekoppeld.filter(r => !(r.vastSleutel && r.sleutel === r.vastSleutel));
      await bewaarKoppelingen(id, gekoppeld.map(r => ({ veld: r.vingerafdruk, sleutel: r.sleutel, pagina: nr })),
        { id: nr, titel: naam, velden: gekoppeld.length, datum: new Date().toLocaleDateString('nl-NL') });
      // Hoort deze site bij een ander portaal dan zichzelf (een van de vier, of via Meer gekozen), onthoud dat.
      if (host && id !== siteId(host)) {
        const { hosts = {} } = await lokaal.get('hosts');
        hosts[siteId(host)] = id;
        await lokaal.set({ hosts });
      }
      await toonHoortBij();
      await toonPaginas();
      toonAantallen();
      if (tab) await vul(tab);
      else zet('rapport', `${naam} opgeslagen. Klik op die pagina "Vul deze pagina".`);
    },
  });
}

document.getElementById('koppelplak').addEventListener('click', async () => {
  const html = document.getElementById('html').value;
  if (!html.trim()) return;
  if (!gekozen) {
    document.getElementById('html').value = '';
    return zet('rapport', 'Open eerst de pagina van het portaal en klik daar op het icoon; plak daarna hier.');
  }
  const { doc, titel, host } = leesHtml(html);
  const koppelingen = (await koppelingenVan(gekozen)).concat(portaalVan(gekozen).koppelingen);
  const rijen = globalThis.AdressenboekjeVelden({ doc, portaal: portaalVan(gekozen), koppelingen });
  document.getElementById('html').value = '';
  zet('rapport', rijen.length ? 'Geplakte pagina: kijk de lijst na (rood = weet ik niet) en klik Opslaan.' : 'Geen invulvelden gevonden in wat je plakte.');
  // Een kopie met Ctrl+A heeft geen titel en geen adres: dan is het meestal de pagina in het open tabblad.
  const t = huidigeTab || {};
  portaalTabel(rijen, titel || (t.title || '').trim(), host || hostVan(t.url));
});

// Vergelijkt de velden op de pagina met de opgeslagen koppelingen (eigen = de geleerde, zonder de vaste uit portalen.js).
// Geeft null als alles klopt, anders wat HR te zien krijgt en welke oude pagina's vervangen worden.
function paginaStatus(rijen, eigen) {
  const geleerd = rijen.filter(r => r.bron === 'geleerd');
  const los = rijen.filter(r => r.bron !== 'geleerd');
  const gevonden = new Set(geleerd.map(r => r.koppeling).filter(i => i >= 0 && i < eigen.length));
  if (!geleerd.length) {
    return { tekst: 'Eerste keer op deze pagina. Kijk de lijst na: rood = weet ik niet. Hoort het bij de collega, kies het; anders laten staan. Klik dan Opslaan.', vervang: [] };
  }
  // Sinds v0.5 is elke site een portaal met vaak meer pagina's, die velden kunnen delen ("Achternaam").
  // Een opgeslagen pagina is "deze pagina" als minstens de helft van haar velden hier staat; een pagina
  // die alleen een paar velden deelt is een andere pagina en wordt niet vervangen.
  const perPagina = {};
  for (const i of gevonden) if (eigen[i].pagina) perPagina[eigen[i].pagina] = (perPagina[eigen[i].pagina] || 0) + 1;
  const dezePaginas = Object.keys(perPagina).filter(id => perPagina[id] * 2 >= eigen.filter(k => k.pagina === id).length);
  if (!dezePaginas.length) {
    if (!los.length) return null;
    return { tekst: 'Nieuwe pagina op deze site. Kijk de lijst na: rood = weet ik niet. Hoort het bij de collega, kies het; anders laten staan. Klik dan Opslaan.', vervang: [] };
  }
  const weg = eigen.filter((k, i) => dezePaginas.includes(k.pagina) && !gevonden.has(i) && k.sleutel !== 'overslaan');
  if (los.length || weg.length) {
    return {
      tekst: 'Deze pagina is veranderd sinds de vorige keer' +
        (los.length ? ` (nieuw: ${[...new Set(los.map(r => r.naam))].slice(0, 4).join(', ')})` : '') +
        '. Kijk de lijst na en klik Opslaan.',
      vervang: dezePaginas,
    };
  }
  return null;
}

// ---- Portaaltabjes: invullen ----

// Eén knop: eerst kijken of de pagina bekend is. Nieuw of veranderd: eerst de lijst nakijken, na Opslaan wordt gevuld.
async function vulPagina(tab) {
  tab = tab || await actieveTab();
  document.getElementById('koppeltabel').innerHTML = '';
  if (!gekozen) return zet('rapport', 'Open eerst de pagina van het portaal en klik daar op het icoon van het adressenboekje.');
  const eigen = await koppelingenVan(gekozen);
  let rijen;
  try {
    rijen = await inTabblad(tab, (id, k) => globalThis.AdressenboekjeVeldenLive({ portaal: globalThis.AdressenboekjePortalen.portaal(id), koppelingen: k }),
      [gekozen, eigen.concat(portaalVan(gekozen).koppelingen)]);
  } catch (e) {
    return zet('rapport', 'Kon deze pagina niet lezen. ' + uitlegFout(e));
  }
  if (!rijen.length) return zet('rapport', 'Geen invulvelden gevonden op deze pagina. Laadt het formulier nog, probeer het dan zo nog eens.');
  const status = paginaStatus(rijen, eigen);
  if (status) {
    zet('rapport', status.tekst);
    return portaalTabel(rijen, (tab.title || '').trim(), hostVan(tab.url), status.vervang, tab);
  }
  await vul(tab);
}
document.getElementById('vul').addEventListener('click', metToegang(() => vulPagina()));

async function vul(tab) {
  const profiel = leesFormulier();
  if (!heeftCollega(profiel)) {
    return zet('rapport', 'Nog geen gegevens van een collega, dus niets ingevuld. Ga naar het tabje HRSuite en klik Haal uit HRSuite. Daarna hier opnieuw Vul deze pagina.');
  }
  const overschrijven = document.getElementById('overschrijven').checked;
  const koppelingen = await koppelingenVan(gekozen);
  const instellingen = await instellingenVan(gekozen);
  try {
    await voerUit(tab, { files: ['matcher.js', 'portalen.js', 'fill.js'] });
    const resultaten = await voerUit(tab, {
      func: (p, o) => globalThis.AdressenboekjeVul(p, o),
      args: [profiel, { portaal: gekozen, koppelingen, overschrijven, instellingen }],
    });
    const r = { ingevuld: [], leeg: [], ontbreekt: [], overgeslagen: [], onbekend: [], controle: [], mislukt: [], velden: [] };
    for (const { result } of resultaten) {
      if (!result) continue;
      for (const k of Object.keys(r)) r[k].push(...(result[k] || []));
    }
    const lijst = (kop, items, teken) => items.length ? `\n${kop}:\n` + [...new Set(items)].map(x => `  ${teken} ` + x).join('\n') : '';
    laatsteRapport = r.velden;
    const alGevuld = r.mislukt.some(x => x.includes('had al een andere waarde'));
    zet('rapport',
      (r.ingevuld.length ? `Ingevuld: ${r.ingevuld.length} (geel op de pagina, teruggelezen en in orde). Kijk ze na en verstuur zelf.\n` : 'Niets ingevuld op deze pagina.\n') +
      r.ingevuld.map(x => '  ✓ ' + x).join('\n') +
      lijst('Leeg gelaten (afspraak)', r.leeg, '○') +
      lijst('Niet gevonden (met reden)', r.ontbreekt, '–') +
      lijst('Lukte niet, vul zelf in', r.mislukt, '✗') +
      lijst('Overgeslagen', r.overgeslagen, '–') +
      lijst('Niet herkend: zelf invullen', r.onbekend, '?') +
      lijst('Controleer', [...new Set(r.controle)], '!') +
      (alGevuld ? '\n\nVelden met een andere waarde zijn niet aangeraakt (rood op de pagina). Wil je ze vervangen, vink dan onder Meer "Velden die al een waarde hebben ook overschrijven" aan.' : '')
    );
  } catch (e) {
    zet('rapport', 'Kon deze pagina niet invullen. ' + uitlegFout(e));
  }
}

// ---- Instellingen per portaal (v0.6): salaris per maand of jaar, decimaalteken ----
// In storage.local onder `instellingen[portaal]`; geen persoonsgegevens. Leeg = wat portalen.js zegt (standaard: geen omrekening, komma).

let laatsteRapport = [];

async function instellingenVan(id) {
  const { instellingen = {} } = await lokaal.get('instellingen');
  return instellingen[id] || {};
}

async function toonInstellingen() {
  const p = portaalVan(gekozen);
  const eigen = await instellingenVan(gekozen);
  const eenheid = document.getElementById('salariseenheid');
  const notatie = document.getElementById('getalnotatie');
  eenheid.value = eigen.salarisEenheid || (p && p.salarisEenheid) || '';
  notatie.value = eigen.getalNotatie || (p && p.getalNotatie) || '';
  eenheid.disabled = notatie.disabled = !p;
}

for (const [veldId, sleutel] of [['salariseenheid', 'salarisEenheid'], ['getalnotatie', 'getalNotatie']]) {
  document.getElementById(veldId).addEventListener('change', async e => {
    if (!gekozen) return;
    const { instellingen = {} } = await lokaal.get('instellingen');
    instellingen[gekozen] = Object.assign({}, instellingen[gekozen], { [sleutel]: e.target.value });
    await lokaal.set({ instellingen });
    zet('rapport', 'Instelling voor ' + portaalVan(gekozen).naam + ' opgeslagen. Klik Vul deze pagina om het salaris opnieuw in te vullen (vink zo nodig overschrijven aan).');
  });
}

// ---- Diagnose (onder Meer): wat ziet de extensie op deze pagina, en waarom (niet)? ----
// Leest alleen de open pagina. "Kopieer zonder waarden" geeft een tekst zonder persoonsgegevens voor de beheerder.

let laatsteDiagnose = [];

function masker(w) {
  const t = String(w || '').trim();
  if (!t) return '(leeg)';
  if (M.leesDatum(t)) return '(datum)';
  if (/@/.test(t)) return '(e-mailadres)';
  if (/^[\d\s.,€%+\-/]+$/.test(t)) return '(getal, ' + t.replace(/\D/g, '').length + ' cijfers)';
  return '(tekst, ' + t.length + ' tekens)';
}

// De diagnose als tekst, met elke waarde vervangen door alleen de soort (geen persoonsgegevens).
function diagnoseTekst(frames) {
  return frames.map(f => [`== ${f.hoofdframe ? 'Pagina' : 'Iframe'} ${f.frame} (${f.modus}), gewacht ${f.gewacht} ms, ${f.stil ? 'klaar' : 'bleef veranderen'}`, JSON.stringify(f.tellingen)]
    .concat(f.rijen.map(r => [r.waar, labelVoorKopie(r) + (r.id ? ' #' + r.id : ''), masker(r.waarde), r.gegeven || '-', r.reden].join(' | '))).join('\n')).join('\n\n');
}

// Een niet-herkend tekstpaar kan twee waarden naast elkaar zijn ("Test Persoon" en "Utrecht"): dan ook het "label" maskeren,
// behalve als het eruitziet als een label (eindigt op een dubbele punt).
function labelVoorKopie(r) {
  if (r.sleutel || !String(r.waar).startsWith('tekst') || /:\s*$/.test(r.label)) return r.label;
  return 'label ' + masker(r.label);
}

function toonDiagnoseTabel(frames) {
  const doos = document.getElementById('diagnosedoos');
  doos.innerHTML = '';
  for (const f of frames) {
    const t = f.tellingen;
    const kop = document.createElement('p');
    kop.className = 'uitleg';
    kop.textContent = `${f.hoofdframe ? 'Pagina' : 'Iframe'} ${f.frame} · gewacht ${(f.gewacht / 1000).toFixed(1)} s (${f.stil ? 'pagina was klaar' : 'pagina bleef veranderen'}) · ` +
      `${t.invoervelden} invoervelden (${t.verborgenVelden} verborgen), ${t.zichtbareVelden} bruikbaar, ${t.shadowRoots} webcomponenten, ${t.iframes} iframes (${t.iframesAndereSite} van een andere site of niet geladen) · ` +
      `script: ${t.scriptsMetHrSuiteData} blok(ken) HRSuite-gegevens, ${t.scriptVelden} velden, ${t.scriptVeldenMetWaarde} met waarde`;
    doos.appendChild(kop);
    if (!f.rijen.length) continue;
    const blok = document.createElement('div');
    blok.className = 'koppeltabel diagnose';
    const tabel = document.createElement('table');
    tabel.innerHTML = '<thead><tr><th>Waar</th><th>Label</th><th>Waarde</th><th>Gegeven</th><th>Waarom</th></tr></thead><tbody></tbody>';
    for (const r of f.rijen) {
      const tr = document.createElement('tr');
      const goed = r.sleutel && r.sleutel !== 'overslaan' && !/niet om te zetten|leeg$|ontbreekt|niet herkend|alleen-lezen|controleren/.test(r.reden);
      tr.className = goed ? 'goed' : r.sleutel ? 'let' : 'onbekend';
      const waarde = f.modus === 'portaal' && r.invullen ? r.waarde + ' → ' + r.invullen : r.waarde;
      for (const [i, tekst] of [r.waar, r.label + (r.id ? ' #' + r.id : ''), waarde, r.gegeven, r.reden].entries()) {
        const td = document.createElement('td');
        td.textContent = tekst || '';
        td.title = tekst || '';
        if (i === 2) td.className = 'waarde';
        tr.appendChild(td);
      }
      tabel.tBodies[0].appendChild(tr);
    }
    blok.appendChild(tabel);
    doos.appendChild(blok);
  }
  const knop = document.createElement('button');
  knop.textContent = 'Kopieer zonder waarden (voor de beheerder)';
  knop.addEventListener('click', async () => {
    const tekst = diagnoseTekst(frames);
    try { await navigator.clipboard.writeText(tekst); zet('diagnosemelding', 'Gekopieerd, zonder waarden. Plak het in een bericht aan de beheerder.'); } catch (e) { zet('diagnosemelding', 'Kopiëren lukte niet: ' + e.message); }
  });
  doos.appendChild(knop);
}

async function toonDiagnose(tab) {
  tab = tab || await actieveTab();
  const hrsuite = !document.getElementById('hrsuite').hidden;
  zet('diagnosemelding', 'Bezig: wacht tot de pagina klaar is met laden en kijkt dan wat er staat...');
  document.getElementById('diagnosedoos').innerHTML = '';
  try {
    const opties = hrsuite
      ? { modus: 'hrsuite', koppelingen: await koppelingenVan('hrsuite') }
      : { modus: 'portaal', portaal: gekozen, koppelingen: await koppelingenVan(gekozen), instellingen: await instellingenVan(gekozen), profiel: leesFormulier() };
    await voerUit(tab, { files: ['matcher.js', 'portalen.js', 'fill.js'] });
    const uit = await voerUit(tab, { func: o => globalThis.AdressenboekjeDiagnose(o), args: [opties] });
    const frames = uit.map(r => r.result).filter(Boolean);
    laatsteDiagnose = frames;
    const herkend = frames.reduce((n, f) => n + f.rijen.filter(r => r.sleutel && r.sleutel !== 'overslaan').length, 0);
    const totaal = frames.reduce((n, f) => n + f.rijen.length, 0);
    zet('diagnosemelding', `Diagnose ${hrsuite ? 'HRSuite' : portaalVan(gekozen) ? portaalVan(gekozen).naam : ''}: ${totaal} labels/velden gevonden, ${herkend} herkend. Groen = wordt gebruikt, geel = herkend maar let op, rood = niet herkend.`);
    toonDiagnoseTabel(frames);
  } catch (e) {
    zet('diagnosemelding', 'Diagnose lukte niet. ' + uitlegFout(e));
  }
}
document.getElementById('diagnose').addEventListener('click', metToegang(() => toonDiagnose()));

// ---- Koppelingen delen (onder Meer, op elk tabje) ----

function meld(tekst) {
  zet(document.getElementById('hrsuite').hidden ? 'rapport' : 'hrsuitemelding', tekst);
}

document.getElementById('exporteer').addEventListener('click', async () => {
  const { koppelingen = {}, hosts = {}, paginas = {}, instellingen = {} } = await lokaal.get(['koppelingen', 'hosts', 'paginas', 'instellingen']);
  const inhoud = JSON.stringify({ soort: 'adressenboekje-koppelingen', versie: 4, datum: new Date().toISOString().slice(0, 10), koppelingen, hosts, paginas, instellingen }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([inhoud], { type: 'application/json' }));
  a.download = 'adressenboekje-koppelingen.json';
  a.click();
  meld('Bestand gedownload. Dit bevat alleen veldnamen, geen persoonsgegevens: je kunt het naar de beheerder sturen.');
});

document.getElementById('importeer').addEventListener('click', async () => {
  let data;
  try { data = JSON.parse(document.getElementById('import').value); } catch (e) { return meld('Dit is geen koppelingenbestand.'); }
  if (data.soort !== 'adressenboekje-koppelingen') return meld('Dit is geen koppelingenbestand.');
  const { koppelingen = {}, hosts = {}, paginas = {} } = await lokaal.get(['koppelingen', 'hosts', 'paginas']);
  for (const [id, lijst] of Object.entries(data.koppelingen || {})) {
    koppelingen[id] = (koppelingen[id] || []).filter(k => !lijst.some(n => zelfde(n.veld, k.veld))).concat(lijst);
  }
  for (const [id, lijst] of Object.entries(data.paginas || {})) {
    paginas[id] = (paginas[id] || []).filter(p => !lijst.some(n => n.id === p.id)).concat(lijst);
  }
  const { instellingen = {} } = await lokaal.get('instellingen');
  await lokaal.set({ koppelingen, paginas, hosts: Object.assign(hosts, data.hosts || {}), instellingen: Object.assign(instellingen, data.instellingen || {}) });
  document.getElementById('import').value = '';
  await toonPaginas();
  toonAantallen();
  meld('Koppelingen geïmporteerd.');
});

// ---- Opstarten ----

bouwFormulier();
bouwTabs();
form.addEventListener('input', bewaar);
form.addEventListener('change', bewaar);
plakVak('html', 'koppelplak');
plakVak('hrsuitehtml', 'hrsuitelees');

document.getElementById('test').addEventListener('click', async () => {
  zetFormulier(TESTPERSOON);
  await bewaar();
  zet('hrsuitemelding', 'Testpersoon ingevuld: verzonnen gegevens, alleen om te oefenen. Klik Wis gegevens voor een echte collega.');
});

document.getElementById('wis').addEventListener('click', async () => {
  await sessie.remove('profiel');
  laatsteLees = null;
  zetFormulier({});
  zet('hrsuitemelding', 'Gegevens gewist.');
});

// Koppelingen uit v0.4 blijven werken: de vier vaste portalen houden hun id en de tabel site → portaal blijft.
// Alleen "www." valt weg uit de sitenamen, zodat www.voorbeeld.example en voorbeeld.example één portaal zijn,
// en een site die naar zichzelf wijst hoeft niet meer in de tabel.
async function migreer() {
  const { schema = 0, hosts = {} } = await lokaal.get(['schema', 'hosts']);
  if (schema < 5) {
    const nieuw = {};
    for (const [host, id] of Object.entries(hosts)) {
      const kaal = siteId(host);
      if (id !== kaal && !nieuw[kaal]) nieuw[kaal] = id;
    }
    await lokaal.set({ schema: 5, hosts: nieuw });
  }
  // v0.6: tot v0.5 bestond Dienstverband niet als gegeven, dus koppelde HR zo'n veld op "niet invullen"
  // (zoals dienstverbandCode op AbsencePortal, test 9/11). Die koppelingen worden Dienstverband.
  if (schema < 6) {
    const { koppelingen = {} } = await lokaal.get('koppelingen');
    for (const lijst of Object.values(koppelingen)) {
      for (const k of lijst || []) if (k.sleutel === 'overslaan' && k.veld && M.herken(k.veld) === 'dienstverband') k.sleutel = 'dienstverband';
    }
    await lokaal.set({ schema: 6, koppelingen });
  }
}

async function start() {
  await migreer();
  const { profiel } = await sessie.get('profiel');
  if (profiel) zetFormulier(profiel); else toonBerekend();
  const { laatstePortaal, hosts = {} } = await lokaal.get(['laatstePortaal', 'hosts']);
  const tab = await actieveTab();
  huidigeTab = tab;
  siteHost = /^https?:/.test((tab && tab.url) || '') ? hostVan(tab.url) : '';
  const opSite = portaalVoorHost(siteHost, hosts);
  // Het tweede tabje is altijd het portaal van de open site; zonder site het laatst gebruikte.
  gekozen = opSite && opSite !== 'hrsuite' ? opSite : laatstePortaal || null;
  document.getElementById('tab-portaal').textContent = gekozen ? portaalVan(gekozen).naam : 'Deze site';
  // Zonder gegevens of op de HRSuite-site eerst HRSuite.
  if (opSite === 'hrsuite' || !(profiel && profiel.achternaam) || !gekozen) await toonTab('hrsuite');
  else await toonTab(gekozen);
  // Iframes van andere sites op dit scherm (HRSuite of portaal): bij de eerste klik ook daarvoor toegang vragen.
  if (siteHost) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill.js'] });
      const [uit] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.AdressenboekjeFrames() });
      frameSites = (uit && uit.result) || [];
    } catch (e) { frameSites = []; }
  }
}
const gestart = start();
