// Herkent welk gegeven in een formulierveld hoort en zet het in het juiste formaat.
// Pure logica zonder DOM, zodat het in Node te testen is en in de browser draait.
(function (root) {
  'use strict';

  // De gegevens op het tabje HRSuite. "berekend" velden vult de extensie zelf als ze leeg zijn.
  const VELDEN = [
    { groep: 'Persoon', sleutel: 'bsn', label: 'BSN', gevoelig: true },
    { groep: 'Persoon', sleutel: 'voorletters', label: 'Voorletters', hint: 'leeg = uit voornamen' },
    { groep: 'Persoon', sleutel: 'voornamen', label: 'Voornamen (officieel)' },
    { groep: 'Persoon', sleutel: 'roepnaam', label: 'Roepnaam' },
    { groep: 'Persoon', sleutel: 'tussenvoegsel', label: 'Tussenvoegsel' },
    { groep: 'Persoon', sleutel: 'achternaam', label: 'Achternaam (eigen)' },
    { groep: 'Persoon', sleutel: 'tussenvoegselPartner', label: 'Tussenvoegsel partner' },
    { groep: 'Persoon', sleutel: 'achternaamPartner', label: 'Achternaam partner', hint: 'leeg als er geen partner is' },
    { groep: 'Persoon', sleutel: 'geslacht', label: 'Geslacht', keuzes: [['', '-'], ['M', 'Man'], ['V', 'Vrouw']] },
    { groep: 'Persoon', sleutel: 'geboortedatum', label: 'Geboortedatum', type: 'date' },
    { groep: 'Adres', sleutel: 'straat', label: 'Straat' },
    { groep: 'Adres', sleutel: 'huisnummer', label: 'Huisnummer', hint: 'alleen het nummer' },
    { groep: 'Adres', sleutel: 'toevoeging', label: 'Toevoeging' },
    { groep: 'Adres', sleutel: 'postcode', label: 'Postcode' },
    { groep: 'Adres', sleutel: 'woonplaats', label: 'Woonplaats' },
    { groep: 'Adres', sleutel: 'land', label: 'Land', standaard: 'Nederland' },
    { groep: 'Contact', sleutel: 'emailWerk', label: 'E-mail werk', type: 'email' },
    { groep: 'Contact', sleutel: 'emailPrive', label: 'E-mail privé', type: 'email' },
    { groep: 'Contact', sleutel: 'telefoon', label: 'Telefoon (vast)' },
    { groep: 'Contact', sleutel: 'mobiel', label: 'Mobiel' },
    { groep: 'Dienstverband', sleutel: 'datumInDienst', label: 'Datum in dienst', type: 'date' },
    // v0.6: faalpunt 9/11. Opgeslagen als soort (onbepaald/bepaald/oproep); per portaal wordt de passende optie gekozen.
    { groep: 'Dienstverband', sleutel: 'dienstverband', label: 'Dienstverband', keuzes: [['', '-'], ['onbepaald', 'Onbepaalde tijd (vast)'], ['bepaald', 'Bepaalde tijd (tijdelijk)'], ['oproep', 'Oproep / nuluren']] },
    { groep: 'Dienstverband', sleutel: 'functie', label: 'Functie' },
    { groep: 'Dienstverband', sleutel: 'afdeling', label: 'Afdeling', standaard: 'Voorbeeld BV' },
    { groep: 'Dienstverband', sleutel: 'urenPerWeek', label: 'Uren per week' },
    { groep: 'Dienstverband', sleutel: 'fulltimeUren', label: 'Fulltime uren', standaard: '40' },
    { groep: 'Dienstverband', sleutel: 'parttimePercentage', label: 'Parttime %', berekend: true },
    { groep: 'Dienstverband', sleutel: 'maandloon', label: 'Bruto maandloon', gevoelig: true },
    { groep: 'Dienstverband', sleutel: 'dertiendeMaand', label: '13e maand', keuzes: [['nee', 'Nee'], ['ja', 'Ja']] },
    { groep: 'Dienstverband', sleutel: 'jaarsalaris', label: 'Jaarsalaris', berekend: true, gevoelig: true },
    { groep: 'Dienstverband', sleutel: 'fulltimeJaarsalaris', label: 'Fulltime jaarsalaris', berekend: true, gevoelig: true },
    { groep: 'Dienstverband', sleutel: 'taal', label: 'Taalvoorkeur', standaard: 'Nederlands' },
    { groep: 'Reiskaart', sleutel: 'ingangsdatumKaart', label: 'Ingangsdatum kaart (leeg = in dienst)', type: 'date', berekend: true },
  ];

  // Sleutels die geen invoerveld hebben maar wel in een portaal kunnen voorkomen.
  const AFGELEID = [
    { sleutel: 'naam', label: 'Volledige naam' },
    { sleutel: 'adres', label: 'Straat + huisnummer' },
    { sleutel: 'email', label: 'E-mail (standaard van dit portaal)' },
    { sleutel: 'loonbegrip', label: 'Loonbegrip (bruto maandloon)' },
    { sleutel: 'huisnummerCompleet', label: 'Huisnummer + toevoeging (één veld)' },
  ];
  // Deze velden blijven altijd leeg (afspraak uit de test van 20-10).
  const LEEG = ['personeelsnummer', 'kostenplaats', 'einddatum'];
  const DATUMS = ['geboortedatum', 'datumInDienst', 'ingangsdatumKaart'];

  const EMAIL = ['e-mailadres', 'emailadres', 'e-mail', 'email', 'mail'];
  const PRIVE = ['prive', 'privé', 'thuis', 'persoonlijk', 'persoonlijke', 'personal', 'private', 'home'];
  const WERK = ['werk', 'zakelijk', 'zakelijke', 'business', 'work', 'kantoor'];
  const PARTNER = ['partner', 'echtgenoot', 'echtgenote', 'spouse'];
  const TUSSEN = ['tussenvoegsels', 'tussenvoegsel', 'voorvoegsels', 'voorvoegsel', 'tussenv', 'infix', 'prefix'];
  const ACHTER = ['achternaam', 'geslachtsnaam', 'familienaam', 'lastname', 'last name', 'surname', 'family name', 'naam'];
  const SALARIS = ['jaarsalaris', 'salaris', 'loon', 'inkomen', 'salary'];

  // Volgorde telt: specifieke regels eerst. "ook" = er moet ook een van deze woorden in staan.
  const REGELS = [
    { sleutel: 'emailPrive', woorden: EMAIL, ook: PRIVE },
    { sleutel: 'emailWerk', woorden: EMAIL, ook: WERK },
    { sleutel: 'email', autocomplete: ['email'], woorden: EMAIL },
    { sleutel: 'mobiel', autocomplete: ['mobile'], woorden: ['mobiel', 'mobiele', 'mobile', 'gsm', 'mobielnummer'] },
    { sleutel: 'telefoon', autocomplete: ['tel', 'tel-national'], woorden: ['telefoonnummer', 'telefoon', 'phone', 'tel', 'telnr'] },
    { sleutel: 'bsn', woorden: ['bsn', 'burgerservicenummer', 'sofinummer', 'sofi nummer'] },
    { sleutel: 'personeelsnummer', woorden: ['personeelsnummer', 'personeelsnr', 'werknemersnummer', 'werknemernummer', 'medewerkernummer', 'employee number', 'employee id'] },
    { sleutel: 'kostenplaats', woorden: ['kostenplaats', 'kostenplaatscode', 'cost center', 'cost centre'] },
    { sleutel: 'voorletters', woorden: ['voorletters', 'voorletter', 'initialen', 'initials'] },
    { sleutel: 'tussenvoegselPartner', woorden: TUSSEN, ook: PARTNER },
    { sleutel: 'achternaamPartner', woorden: ACHTER.concat(['partnernaam']), ook: PARTNER.concat(['partnernaam']) },
    { sleutel: 'tussenvoegsel', autocomplete: ['additional-name'], woorden: TUSSEN },
    { sleutel: 'achternaam', autocomplete: ['family-name'], woorden: ACHTER.filter(w => w !== 'naam') },
    { sleutel: 'voornamen', woorden: ['voornamen', 'alle voornamen', 'first names', 'given names'] },
    { sleutel: 'roepnaam', autocomplete: ['given-name'], woorden: ['roepnaam', 'voornaam', 'firstname', 'first name', 'given name', 'nickname'] },
    { sleutel: 'geslacht', autocomplete: ['sex'], woorden: ['geslacht', 'gender', 'sekse', 'aanhef'] },
    { sleutel: 'geboortedatum', autocomplete: ['bday'], woorden: ['geboortedatum', 'geboren', 'geb datum', 'date of birth', 'dateofbirth', 'birthdate', 'dob'] },
    { sleutel: 'einddatum', woorden: ['einddatum', 'datum uit dienst', 'einde dienstverband', 'end date'] },
    { sleutel: 'datumInDienst', woorden: ['datum in dienst', 'in dienst', 'indienstdatum', 'indiensttreding', 'datum indiensttreding', 'indiensttredingsdatum', 'startdatum', 'start datum', 'ingangsdatum', 'te gebruiken vanaf', 'begindatum', 'start date', 'startdate', 'hire date'] },
    { sleutel: 'postcode', autocomplete: ['postal-code'], woorden: ['postcode', 'zipcode', 'zip code', 'postal code', 'zip'] },
    { sleutel: 'toevoeging', woorden: ['huisnummertoevoeging', 'toevoeging', 'toev', 'addition', 'suffix'] },
    { sleutel: 'huisnummer', woorden: ['huisnummer', 'huisnr', 'house number', 'housenumber', 'nummer', 'nr'] },
    { sleutel: 'straat', autocomplete: ['address-line1'], woorden: ['straatnaam', 'straat', 'street'] },
    { sleutel: 'adres', autocomplete: ['street-address'], woorden: ['adres', 'address'] },
    { sleutel: 'woonplaats', autocomplete: ['address-level2'], woorden: ['woonplaats', 'plaatsnaam', 'plaats', 'city', 'town'] },
    { sleutel: 'land', autocomplete: ['country', 'country-name'], woorden: ['land', 'country', 'landcode'] },
    { sleutel: 'functie', autocomplete: ['organization-title'], woorden: ['functienaam', 'functie', 'job title', 'jobtitle', 'position'] },
    { sleutel: 'afdeling', woorden: ['afdeling', 'team', 'department'] },
    { sleutel: 'taal', woorden: ['taalvoorkeur', 'voorkeurstaal', 'correspondentietaal', 'taal', 'language'] },
    { sleutel: 'parttimePercentage', woorden: ['parttimepercentage', 'parttime percentage', 'part time percentage', 'parttimefactor', 'deeltijdpercentage', 'deeltijdfactor', 'parttime', 'deeltijd'] },
    { sleutel: 'urenPerWeek', woorden: ['uren per week', 'aantal uren', 'contracturen', 'arbeidsduur', 'uren', 'hours per week'] },
    { sleutel: 'fulltimeJaarsalaris', woorden: SALARIS, ook: ['fulltime', 'voltijd', 'full time'] },
    { sleutel: 'jaarsalaris', woorden: ['jaarsalaris', 'jaarloon', 'jaarinkomen', 'annual salary'] },
    { sleutel: 'loonbegrip', woorden: ['loonbegrip', 'loontype', 'salaristype', 'soort salaris', 'salarissoort', 'soort loon'] },
    { sleutel: 'maandloon', woorden: ['bruto maandsalaris', 'bruto maandloon', 'maandsalaris', 'maandloon', 'loonbedrag', 'salaris', 'salary', 'loon'] },
    // Na de datum-, uren- en salarisregels: "Startdatum dienstverband", "Uren dienstverband" en "Einde dienstverband" zijn iets anders.
    { sleutel: 'dienstverband', woorden: ['dienstverband', 'dienstverbanden', 'type contract', 'soort contract', 'contractsoort', 'contracttype', 'contractvorm', 'type arbeidsovereenkomst', 'soort arbeidsovereenkomst', 'aard dienstverband', 'employment type', 'contract type'] },
    // Voor "naam": anders krijgt "Bedrijfsnaam" of "Company name" de naam van de collega.
    { sleutel: 'bedrijf', autocomplete: ['organization'], woorden: ['bedrijfsnaam', 'bedrijf', 'werkgever', 'organisatie', 'company', 'employer', 'organization'] },
    { sleutel: 'naam', autocomplete: ['name'], woorden: ['volledige naam', 'naam', 'full name', 'name'] },
  ];

  const NAAMDELEN = ['roepnaam', 'voornamen', 'voorletters', 'tussenvoegsel', 'achternaam'];
  const OVERSLAAN = ['hidden', 'password', 'submit', 'button', 'reset', 'file', 'image', 'checkbox', 'search'];

  // Maakt van "firstName", "first_name" en "Voornaam*" allemaal "first name" / "voornaam".
  function normaliseer(tekst) {
    return String(tekst || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[_\-.:*()[\]/,?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function bevatWoord(tekst, woord) {
    const w = normaliseer(woord).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Hele woorden, zodat "nr" niet in "telefoonnr" misgaat en "naam" niet in "achternaam".
    return new RegExp('(^|\\s)' + w + '(\\s|$)').test(tekst);
  }

  function past(regel, tekst) {
    return regel.woorden.some(w => bevatWoord(tekst, w)) && (!regel.ook || regel.ook.some(w => bevatWoord(tekst, w)));
  }

  // veld: { type, autocomplete, label, name, id, placeholder, ariaLabel }
  // portaal (optioneel): { regels: [...] } die voor de algemene regels gaan.
  function herken(veld, portaal) {
    const type = String(veld.type || 'text').toLowerCase();
    if (OVERSLAAN.includes(type)) return null;
    const regels = ((portaal && portaal.regels) || []).concat(REGELS);

    const ac = String(veld.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (ac && ac !== 'on' && ac !== 'off') {
      const regel = REGELS.find(r => (r.autocomplete || []).includes(ac));
      if (regel) return regel.sleutel;
    }

    // Label en aria-label wegen zwaarder dan technische namen.
    const bronnen = [veld.label, veld.ariaLabel, veld.placeholder, veld.name, veld.id].map(normaliseer).filter(Boolean);
    for (let i = 0; i < bronnen.length; i++) {
      const regel = regels.find(r => past(r, bronnen[i]));
      if (!regel) continue;
      // "Name" boven twee vakjes met placeholder "First Name" en "Last Name": het specifiekere gegeven wint.
      if (regel.sleutel === 'naam') {
        for (const verder of bronnen.slice(i + 1)) {
          const r2 = regels.find(r => past(r, verder));
          if (r2 && NAAMDELEN.includes(r2.sleutel)) return r2.sleutel;
        }
      }
      return regel.sleutel;
    }
    if (type === 'email') return 'email';
    if (type === 'tel') return 'telefoon';
    return null;
  }

  // ---- Getallen en berekeningen ----

  // "3.500,50", "3500,5" en "3500.50" worden allemaal 3500.5.
  function leesGetal(tekst) {
    let t = String(tekst == null ? '' : tekst).replace(/[€\s%]/g, '');
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
    return Number(t);
  }

  function rond(getal, decimalen) {
    const f = Math.pow(10, decimalen);
    return Math.round(getal * f) / f;
  }

  // Vult standaardwaarden en berekende velden aan, zonder iets te overschrijven wat HR invulde.
  function afleiden(profiel) {
    const p = Object.assign({}, profiel);
    for (const v of VELDEN) if (v.standaard && !p[v.sleutel]) p[v.sleutel] = v.standaard;

    if (!p.voorletters && p.voornamen) p.voorletters = p.voornamen.trim().split(/\s+/).map(d => d[0]).join('');
    if (!p.roepnaam && p.voornamen) p.roepnaam = p.voornamen.trim().split(/\s+/)[0];

    const uren = leesGetal(p.urenPerWeek);
    const fulltime = leesGetal(p.fulltimeUren);
    if (!p.parttimePercentage && uren > 0 && fulltime > 0) p.parttimePercentage = String(rond(uren / fulltime * 100, 2));

    // Jaarsalaris = 12 maanden + 8% vakantiegeld (+ 13e maand). Insurer A wil dit bedrag omgerekend naar fulltime.
    const maand = leesGetal(p.maandloon);
    if (!p.jaarsalaris && maand > 0) p.jaarsalaris = String(Math.round(maand * 12 * 1.08 + (p.dertiendeMaand === 'ja' ? maand : 0)));
    const jaar = leesGetal(p.jaarsalaris);
    const pct = leesGetal(p.parttimePercentage);
    if (!p.fulltimeJaarsalaris && jaar > 0 && pct > 0) p.fulltimeJaarsalaris = String(Math.round(jaar * 100 / pct));

    if (!p.ingangsdatumKaart && p.datumInDienst) p.ingangsdatumKaart = p.datumInDienst;
    p.loonbegrip = 'Bruto maandloon';
    return p;
  }

  // ---- Formaten ----

  function formatPostcode(postcode) {
    // Altijd zonder spatie (afspraak 20-10; TravelCard weigert een spatie).
    return String(postcode || '').toUpperCase().replace(/\s+/g, '');
  }

  // "GS", "G.S." en "g. s." worden "G.S.". "Th." blijft "Th.".
  function formatVoorletters(tekst) {
    const t = String(tekst || '').trim();
    if (!t) return '';
    const delen = /[.\s]/.test(t) ? t.split(/[.\s]+/).filter(Boolean) : t.split('');
    return delen.map(d => d[0].toUpperCase() + d.slice(1).toLowerCase() + '.').join('');
  }

  // Alleen cijfers, +31 en 0031 worden 0, zodat er hooguit 10 cijfers overblijven.
  function formatTelefoon(tekst) {
    let t = String(tekst || '').replace(/[^\d+]/g, '');
    if (t.startsWith('+31')) t = '0' + t.slice(3);
    else if (t.startsWith('0031')) t = '0' + t.slice(4);
    return t.replace(/\+/g, '');
  }

  // Het adressenboekje bewaart datums als JJJJ-MM-DD (zoals <input type="date">).
  // Een tekstveld krijgt het patroon uit de placeholder ("dd/mm/jjjj", "ddmmyyyy"), anders DD-MM-JJJJ.
  function formatDatum(datum, veldType, patroon) {
    const m = String(datum || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(datum || '');
    if (veldType === 'date') return datum;
    const p = String(patroon || '').toLowerCase().replace(/y/g, 'j');
    if (/dd|mm|jjjj/.test(p)) {
      const uit = p.match(/(dd|mm|jjjj|jj)|[^dmj]/g);
      if (uit && uit.some(d => d === 'jjjj' || d === 'jj')) {
        return uit.map(d => d === 'dd' ? m[3] : d === 'mm' ? m[2] : d === 'jjjj' ? m[1] : d === 'jj' ? m[1].slice(2) : d).join('');
      }
    }
    return m[3] + '-' + m[2] + '-' + m[1];
  }

  function datumDeel(datum, deel) {
    const m = String(datum || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return deel === 'dag' ? m[3] : deel === 'maand' ? m[2] : m[1];
  }

  // Een getal voor een tekstveld krijgt een komma ("87,5"), voor type=number altijd een punt.
  // notatie (per portaal in te stellen): 'komma' of 'punt'; leeg = komma (gedrag tot en met v0.5).
  // Nooit een valutateken en nooit een scheiding voor duizendtallen: "45360", niet "€ 45.360".
  function formatGetal(tekst, veldType, notatie) {
    const g = leesGetal(tekst);
    if (isNaN(g)) return String(tekst || '');
    const s = String(rond(g, 2));
    return veldType === 'number' || notatie === 'punt' ? s : s.replace('.', ',');
  }

  // Bedragen: hele euro's zonder decimalen, anders altijd twee ("3780,50").
  function formatBedrag(getal, veldType, notatie) {
    const g = rond(getal, 2);
    const s = Number.isInteger(g) ? String(g) : g.toFixed(2);
    return veldType === 'number' || notatie === 'punt' ? s : s.replace('.', ',');
  }

  // ---- Salaris: per maand of per jaar ----
  // Elk salarisgegeven heeft een eigen eenheid: maandloon per maand, (fulltime) jaarsalaris per jaar.
  // Een portaal kan instellen wat zijn salarisveld verwacht (salarisEenheid 'maand' of 'jaar').
  // Leeg = geen omrekening: het veld krijgt het gegeven waar het aan gekoppeld is (gedrag tot en met v0.5).
  const SALARIS_EENHEID = { maandloon: 'maand', jaarsalaris: 'jaar', fulltimeJaarsalaris: 'jaar' };

  function salarisOmrekening(sleutel, portaal) {
    const van = SALARIS_EENHEID[String(sleutel).split('.')[0]];
    if (!van) return null;
    const e = portaal && portaal.salarisEenheid;
    const naar = e === 'maand' || e === 'jaar' ? e : van;
    return { van, naar, factor: van === naar ? 1 : naar === 'jaar' ? 12 : 1 / 12, uitleg: van === naar ? '' : naar === 'jaar' ? 'x 12, per jaar' : 'gedeeld door 12, per maand' };
  }

  // ---- Dienstverband ----
  // Portalen noemen hetzelfde anders: "Vast", "Onbepaalde tijd", "OBT", "Contract voor onbepaalde tijd".
  // We bewaren de soort en kiezen per portaal de optie van dezelfde soort, nooit een gok op losse letters.
  const DIENSTVERBAND = {
    onbepaald: ['onbepaalde tijd', 'onbepaald', 'vast', 'vast dienstverband', 'vast contract', 'vaste aanstelling', 'obt', 'permanent', 'indefinite', 'open ended'],
    bepaald: ['bepaalde tijd', 'bepaald', 'tijdelijk', 'tijdelijk dienstverband', 'tijdelijk contract', 'jaarcontract', 'bt', 'fixed term', 'temporary'],
    oproep: ['oproep', 'oproepkracht', 'oproepcontract', 'nulurencontract', 'nuluren', 'min max', 'min max contract', 'on call', 'zero hours'],
  };
  // Wat in een portaal-tekstveld komt (de keuzelijsten zoeken zelf de passende optie).
  const DIENSTVERBAND_TEKST = { onbepaald: 'Onbepaalde tijd', bepaald: 'Bepaalde tijd', oproep: 'Oproepkracht' };

  // "Contract voor onbepaalde tijd" -> 'onbepaald'. Twijfel (zowel vast als tijdelijk, of niets herkend) -> ''.
  function dienstverbandSoort(tekst) {
    const t = normaliseer(tekst).replace(/[^a-z0-9à-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    for (const [soort, woorden] of Object.entries(DIENSTVERBAND)) if (woorden.includes(t)) return soort;
    const heeft = w => bevatWoord(t, w);
    const signalen = [];
    // "onbepaald" bevat "bepaald": daarom alleen hele woorden, en "bepaald" niet als deel van "onbepaald".
    if (/(^|\s)onbepaald/.test(t) || ['vast', 'vaste', 'permanent', 'indefinite', 'obt'].some(heeft)) signalen.push('onbepaald');
    if (/(^|\s)bepaald/.test(t) || ['tijdelijk', 'tijdelijke', 'jaarcontract', 'fixed term', 'temporary', 'bt'].some(heeft)) signalen.push('bepaald');
    if (/oproep|nuluren/.test(t) || ['min max', 'on call', 'zero hours'].some(heeft)) signalen.push('oproep');
    return signalen.length === 1 ? signalen[0] : '';
  }

  // ---- Id's die per keer laden anders zijn ----
  // jQuery UI-datumkiezer (dp1794240345411, gezien in HealthDesk 9/11), React useId (":r3:"), GUID's en lange getallen
  // zijn bij de volgende keer anders. Zo'n id telt niet mee in de vingerafdruk; dan beslissen label en volgnummer.
  function stabielId(id) {
    const s = String(id || '');
    if (!s) return '';
    if (/^dp\d{6,}$/.test(s) || /^:r[0-9a-z]+:$/i.test(s) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s) || /[0-9a-f]{32}/i.test(s) || /\d{9,}/.test(s)) return '';
    return s;
  }

  // sleutel kan ook "geboortedatum.dag" zijn (datum verdeeld over drie velden).
  // veld: { type, placeholder }. portaal: { email: 'emailWerk' | 'emailPrive' }.
  function waardeVoor(sleutel, profiel, veld, portaal) {
    const p = afleiden(profiel);
    const v = veld || {};
    const type = typeof v === 'string' ? v : v.type;
    const [basis, deel] = String(sleutel).split('.');
    if (LEEG.includes(basis) || basis === 'leeg') return '';
    if (deel && DATUMS.includes(basis)) return datumDeel(p[basis], deel);
    switch (basis) {
      case 'naam':
        return [p.roepnaam, p.tussenvoegsel, p.achternaam].filter(Boolean).join(' ');
      case 'adres':
        return [p.straat, [p.huisnummer, p.toevoeging].filter(Boolean).join(' ')].filter(Boolean).join(' ');
      case 'email':
        return p[(portaal && portaal.email) || 'emailWerk'] || p.emailWerk || p.emailPrive || '';
      case 'voorletters':
        return formatVoorletters(p.voorletters);
      case 'postcode':
        return formatPostcode(p.postcode);
      case 'telefoon':
      case 'mobiel':
        return formatTelefoon(p[basis]);
      case 'huisnummer':
        // Alleen het nummer, ook als HR "12A" of "12-2" typte.
        return (String(p.huisnummer || '').match(/^\s*(\d+)/) || [, String(p.huisnummer || '')])[1];
      case 'huisnummerCompleet':
        return [waardeVoor('huisnummer', profiel), waardeVoor('toevoeging', profiel)].filter(Boolean).join(' ');
      case 'toevoeging': {
        if (p.toevoeging) return String(p.toevoeging).trim();
        const rest = String(p.huisnummer || '').replace(/^\s*\d+\s*[-\s]?\s*/, '');
        return rest;
      }
      case 'parttimePercentage':
      case 'urenPerWeek':
        return p[basis] ? formatGetal(p[basis], type, portaal && portaal.getalNotatie) : '';
      case 'maandloon':
      case 'jaarsalaris':
      case 'fulltimeJaarsalaris': {
        if (!p[basis]) return '';
        const g = leesGetal(p[basis]);
        // Geen getal (bijvoorbeeld "Maandloon" uit een verkeerd HRSuite-veld): niets invullen, de reden staat in het rapport.
        if (!(g > 0)) return '';
        return formatBedrag(g * salarisOmrekening(basis, portaal).factor, type, portaal && portaal.getalNotatie);
      }
      case 'dienstverband': {
        const soort = dienstverbandSoort(p.dienstverband);
        if (!soort) return '';
        return (portaal && portaal.dienstverbandTekst && portaal.dienstverbandTekst[soort]) || DIENSTVERBAND_TEKST[soort];
      }
      default:
        if (DATUMS.includes(basis)) return formatDatum(p[basis], type, v.placeholder);
        return p[basis] == null ? '' : String(p[basis]);
    }
  }

  const LANDEN = [
    ['nederland', 'netherlands', 'the netherlands', 'nl', 'nld'],
    ['belgië', 'belgie', 'belgium', 'be', 'bel'],
    ['duitsland', 'germany', 'deutschland', 'de', 'deu'],
  ];
  const GESLACHT = {
    m: ['m', 'man', 'male', 'mannelijk', 'heer', 'de heer', 'dhr', 'mr'],
    v: ['v', 'vrouw', 'female', 'vrouwelijk', 'mevrouw', 'mevr', 'mw', 'f', 'mrs', 'ms'],
  };
  const TALEN = [['nederlands', 'nl', 'dutch', 'nl nl', 'nederlandstalig'], ['engels', 'en', 'english', 'en gb', 'en us']];

  // Waarden waarmee een keuzelijst-optie of keuzerondje mag matchen, genormaliseerd.
  function alternatieven(sleutel, waarde) {
    const w = normaliseer(waarde);
    const basis = String(sleutel).split('.')[0];
    if (basis === 'land') return LANDEN.find(g => g.includes(w)) || [w];
    if (basis === 'geslacht') return GESLACHT[w[0]] || [w];
    if (basis === 'taal') return TALEN.find(g => g.includes(w)) || [w];
    if (basis === 'dienstverband') return DIENSTVERBAND[dienstverbandSoort(waarde)] || [w];
    if (String(sleutel).includes('.')) return [w, String(Number(w))];
    return [w];
  }

  // Zoekt een geleerde koppeling: eerst op id, dan op name, dan op label + volgnummer.
  // Een id of name telt niet als het label ernaast iets anders zegt: sommige portalen
  // nummeren hun velden per scherm ("input-3"), en dan zou scherm 2 de koppeling van scherm 1 krijgen.
  function zoekKoppeling(koppelingen, vingerafdruk) {
    const lijst = koppelingen || [];
    const f = vingerafdruk;
    const botst = k => k.veld.label && f.label && k.veld.label !== f.label;
    // Precies dezelfde vingerafdruk gaat voor: op een site met meer pagina's wint de koppeling van deze pagina.
    const precies = lijst.find(k => (k.veld.id || '') === (f.id || '') && (k.veld.name || '') === (f.name || '') && k.veld.label === f.label && k.veld.nr === f.nr);
    return precies || (f.id && lijst.find(k => k.veld.id === f.id && !botst(k)))
      || (f.name && lijst.find(k => k.veld.name === f.name && !botst(k)))
      // Alleen op label: dan ook hetzelfde soort veld (een dag-keuzelijst is geen datumveld van een andere pagina).
      || (f.label && lijst.find(k => k.veld.label === f.label && k.veld.nr === f.nr && !(k.veld.type && f.type && k.veld.type !== f.type)))
      || null;
  }

  // ---- Lezen uit HRSuite: van schermwaarde naar profielwaarde ----

  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  // "07-03-1995", "7/3/1995", "7 maart 1995" en "1995-03-07" worden allemaal "1995-03-07".
  function leesDatum(tekst) {
    const t = String(tekst || '').trim().toLowerCase();
    const twee = n => String(n).padStart(2, '0');
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + twee(m[2]) + '-' + twee(m[3]);
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return m[3] + '-' + twee(m[2]) + '-' + twee(m[1]);
    m = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
    if (m) {
      const nr = MAANDEN.findIndex(x => x.startsWith(m[2].slice(0, 3)));
      if (nr >= 0) return m[3] + '-' + twee(nr + 1) + '-' + twee(m[1]);
    }
    return '';
  }

  // Niet uit HRSuite overnemen: afspraken (leeg), samengestelde velden en wat HR op "overslaan" zette.
  const NIET_LEZEN = LEEG.concat(['leeg', 'overslaan', 'bedrijf', 'naam', 'loonbegrip']);

  // paren: [{ sleutel, waarde, bron }] zoals gelezen van een HRSuite-scherm. De eerste gevonden waarde wint.
  function naarProfiel(paren) {
    const p = {};
    const delen = {};
    const zet = (sleutel, waarde) => { if (waarde && !p[sleutel]) p[sleutel] = waarde; };
    for (const { sleutel, waarde, bron } of paren || []) {
      const w = String(waarde == null ? '' : waarde).replace(/\s+/g, ' ').trim();
      if (!sleutel || !w || NIET_LEZEN.includes(sleutel)) continue;
      const [basis, deel] = sleutel.split('.');
      if (deel) { delen[basis] = delen[basis] || {}; delen[basis][deel] = delen[basis][deel] || w; continue; }
      // De portalen willen standaard Voorbeeld BV als afdeling; de HRSuite-afdeling alleen als HR die zelf koppelde.
      if (basis === 'afdeling' && bron !== 'geleerd') continue;
      if (DATUMS.includes(basis)) zet(basis, leesDatum(w));
      else if (basis === 'geslacht') zet(basis, GESLACHT.m.includes(normaliseer(w)) ? 'M' : GESLACHT.v.includes(normaliseer(w)) ? 'V' : '');
      else if (basis === 'postcode') zet(basis, formatPostcode(w));
      else if (basis === 'dertiendeMaand') zet(basis, /^(ja|yes|j|y|true|1)$/i.test(w) ? 'ja' : 'nee');
      else if (basis === 'dienstverband') zet(basis, dienstverbandSoort(w));
      else if (basis === 'email') zet('emailWerk', w);
      else if (basis === 'telefoonOfMobiel') zet('telefoon', w);
      else if (basis === 'huisnummerCompleet') {
        const m = w.match(/^(\d+)\s*[-\s]?\s*(.*)$/);
        if (m) { zet('huisnummer', m[1]); zet('toevoeging', m[2]); } else zet('huisnummer', w);
      } else if (basis === 'adres') {
        const m = w.match(/^(.*?)\s+(\d+)\s*[-\s]?\s*([a-z0-9]{0,4})$/i);
        if (m) { zet('straat', m[1]); zet('huisnummer', m[2]); zet('toevoeging', m[3]); } else zet('straat', w);
      } else if (['maandloon', 'jaarsalaris', 'fulltimeJaarsalaris', 'urenPerWeek', 'fulltimeUren', 'parttimePercentage'].includes(basis)) {
        // Alleen een echt getal: "Maandloon" of "Ja" uit een verkeerd gekoppeld veld wordt geen salaris.
        if (leesGetal(w) > 0) zet(basis, w.replace(/[€%]/g, '').trim());
      } else zet(basis, w);
    }
    for (const [basis, d] of Object.entries(delen)) {
      const maand = /^\d+$/.test(d.maand || '') ? d.maand : String(MAANDEN.findIndex(x => x.startsWith(String(d.maand || '').toLowerCase().slice(0, 3))) + 1);
      if (d.dag && d.jaar && Number(maand) > 0) zet(basis, d.jaar + '-' + maand.padStart(2, '0') + '-' + d.dag.padStart(2, '0'));
    }
    return p;
  }

  // Waarom een gegeven leeg is, in gewoon Nederlands (voor het rapport: "niet gevonden" met reden).
  function ontbreektReden(sleutel, profiel) {
    const p = afleiden(profiel);
    const basis = String(sleutel).split('.')[0];
    const leeg = s => !String(profiel[s] || '').trim();
    if (basis === 'fulltimeJaarsalaris' || basis === 'jaarsalaris') {
      if (p.maandloon && !(leesGetal(p.maandloon) > 0)) return 'bruto maandloon is geen bedrag ("' + p.maandloon + '")';
      if (leeg('maandloon') && leeg(basis)) return 'niet te berekenen: bruto maandloon ontbreekt';
      if (basis === 'fulltimeJaarsalaris' && !(leesGetal(p.parttimePercentage) > 0)) return 'niet te berekenen: uren per week (of parttime %) ontbreekt';
    }
    if (basis === 'maandloon' && p.maandloon && !(leesGetal(p.maandloon) > 0)) return 'bruto maandloon is geen bedrag ("' + p.maandloon + '")';
    if (basis === 'parttimePercentage' && leeg('parttimePercentage')) return 'niet te berekenen: uren per week ontbreekt';
    if (basis === 'dienstverband' && p.dienstverband && !dienstverbandSoort(p.dienstverband)) return 'dienstverband "' + p.dienstverband + '" niet herkend';
    if (basis === 'telefoonOfMobiel') return 'geen mobiel en geen telefoonnummer op het tabje HRSuite';
    return 'geen gegeven op het tabje HRSuite';
  }

  // ---- HRSuite: gegevens uit het script van de pagina ----
  // In de paginabron van 9/11 stond geen enkel formulierveld, wel per veld
  // `"<Id>":data.DefineDataField({"Id":"<Id>","Label":"<label>",...})` en per groep een rij `{"1":{"<Id>":"<waarde>",...}}`.
  // Geen netwerk, alleen de tekst die al op de pagina staat. De Id's hieronder zijn verzonnen voor deze publieke versie.

  // HRSuite-veld-Id -> gegeven. Id's en labels uit die bron; [aanname] e_hours_per_week = uren per week (label niet leesbaar).
  // Het brutobedrag (nodig voor Insurer A) staat hier bewust niet in: welk Id dat is, is nog niet bekend.
  const HRSUITE_IDS = {
    p_initials: 'voorletters', p_first_names: 'voornamen', p_call_name: 'roepnaam', p_prefix: 'tussenvoegsel', p_last_name: 'achternaam',
    p_partner_prefix: 'tussenvoegselPartner', p_partner_name: 'achternaamPartner', p_gender: 'geslacht', p_ssn: 'bsn', p_birth_date: 'geboortedatum',
    p_language: 'taal', c_phone: 'telefoon', c_mobile: 'mobiel', c_mobile_2: 'mobiel', c_email_work: 'emailWerk', c_email_private: 'emailPrive',
    a_country: 'land', a_postcode: 'postcode', a_house_number: 'huisnummer', a_house_suffix: 'toevoeging', a_street: 'straat', a_city: 'woonplaats',
    e_start_date: 'datumInDienst', e_contract_type: 'dienstverband', e_job_title: 'functie', e_department: 'afdeling', e_hours_per_week: 'urenPerWeek',
  };

  // Leest één object vanaf `start` (een "{") met haakjes tellen, ook met haakjes in teksten. Geen eval.
  function objectVanaf(t, start) {
    let diepte = 0, inTekst = false, esc = false;
    for (let i = start; i < t.length && i < start + 500000; i++) {
      const c = t[i];
      if (inTekst) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inTekst = false; continue; }
      if (c === '"') inTekst = true;
      else if (c === '{') diepte++;
      else if (c === '}' && --diepte === 0) return t.slice(start, i + 1);
    }
    return null;
  }

  // JSON als het kan; anders de losse "sleutel":"waarde"-paren (het script hoeft geen strikte JSON te zijn).
  function leesObject(stuk) {
    try { return JSON.parse(stuk); } catch (e) { /* geen strikte JSON */ }
    const uit = {};
    const re = /"([^"\\]{1,60})"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g;
    let m;
    while ((m = re.exec(stuk))) {
      if (m[1] in uit) continue;
      try { uit[m[1]] = JSON.parse(m[2]); } catch (e) { uit[m[1]] = m[2]; }
    }
    return uit;
  }

  // Een waarde in een rij kan [aanname] ook een object zijn met een weergavetekst.
  function rijWaarde(w) {
    if (w == null) return '';
    if (typeof w !== 'object') return String(w);
    for (const k of ['Display', 'DisplayValue', 'Text', 'Description', 'd', 'v', 'Value']) if (w[k] != null && typeof w[k] !== 'object') return String(w[k]);
    return '';
  }

  // tekst: alle scripttekst van de pagina. Geeft [{ id, label, waarde, zichtbaar }] in de volgorde van de definities.
  function leesHrSuiteScript(tekst) {
    const t = String(tekst || '');
    const kolommen = new Map();
    const def = /DefineDataField\s*\(\s*\{/g;
    let m;
    while ((m = def.exec(t))) {
      const stuk = objectVanaf(t, m.index + m[0].length - 1);
      if (!stuk) continue;
      const o = leesObject(stuk);
      const id = o.Id || o.ID || o.id;
      if (!id || kolommen.has(id)) continue;
      const verborgen = o.Visible === false || o.Hidden === true || o.IsHidden === true;
      kolommen.set(String(id), { id: String(id), label: String(o.Label || o.Caption || ''), zichtbaar: !verborgen });
    }
    const waarden = {};
    if (kolommen.size) {
      const rij = /\{\s*"1"\s*:\s*\{/g;
      while ((m = rij.exec(t))) {
        const stuk = objectVanaf(t, m.index);
        if (!stuk) continue;
        const o = leesObject(stuk);
        const r = o && typeof o['1'] === 'object' ? o['1'] : leesObject(stuk.slice(stuk.indexOf('{', 1)));
        for (const [id, w] of Object.entries(r || {})) {
          if (!kolommen.has(id) || (id in waarden && waarden[id] !== '')) continue;
          waarden[id] = rijWaarde(w).trim();
        }
      }
    }
    return [...kolommen.values()].map(k => Object.assign(k, { waarde: waarden[k.id] || '' }));
  }

  // Leesbare naam van een sleutel voor het rapport in de popup ("geboortedatum.dag" wordt "Geboortedatum: dag").
  function labelVoor(sleutel) {
    const [basis, deel] = String(sleutel || '').split('.');
    if (basis === 'telefoonOfMobiel') return 'Mobiel';
    const v = VELDEN.concat(AFGELEID).find(x => x.sleutel === basis);
    const naam = v ? v.label : basis;
    return deel ? naam + ': ' + deel : naam;
  }

  const api = {
    VELDEN, AFGELEID, LEEG, DATUMS, herken, labelVoor, waardeVoor, afleiden, alternatieven, normaliseer, zoekKoppeling,
    formatPostcode, formatDatum, formatVoorletters, formatTelefoon, leesGetal, leesDatum, naarProfiel,
    formatGetal, formatBedrag, salarisOmrekening, dienstverbandSoort, DIENSTVERBAND_TEKST, stabielId,
    ontbreektReden, HRSUITE_IDS, leesHrSuiteScript, NIET_LEZEN,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdressenboekjeMatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
