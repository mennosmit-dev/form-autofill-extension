// Elke site is een portaal (sinds v0.5). Hieronder de vier bekende portalen met wat daar anders is dan de algemene regels in matcher.js;
// een site die hier niet staat krijgt na één keer koppelen een eigen portaal met de algemene regels (e-mail werk).
// "koppelingen" zijn vaste veldkoppelingen: plak hier wat HR met "Exporteer koppelingen" terugstuurt (zonder het veld "pagina").
(function (root) {
  'use strict';

  // HealthDesk (verzonnen portaal van Health Service Co), opgebouwd in v0.6 uit een export van koppelingen
  // (pagina "HealthDesk" op apps.healthdesk.example).
  // Datagedreven: per veld de vingerafdruk zoals de extensie hem op die pagina zag (label genormaliseerd, volgnummer, soort)
  // en het gegeven. `controleer` = nog niet bevestigd op het echte portaal; staat ook in de testchecklist.
  // Wat er bewust NIET in staat (geen label, inhoud onbekend): vakje 1 zonder label, keuzelijst 2 en 4 zonder label,
  // datumveld 3 (vermoedelijk geboortedatum), datumvelden 9 en 11 (vermoedelijk startdatum), notitievak 10.
  // Die verschijnen de eerste keer in de lijst, met het label van het veld ervoor, zodat HR ze één keer koppelt.
  const XS = (label, nr, type, sleutel, controleer) => {
    const k = { veld: { id: '', name: '', label, nr, type }, sleutel };
    if (controleer) k.controleer = controleer;
    return k;
  };
  const TEL = '[aanname] De keuzelijst met dit label is de landcode; het nummer hoort in het vakje zonder label erna (export 9/11: keuzelijst met label, tekstvak zonder label).';
  const HEALTHDESK = [
    XS('medewerkernummer', 1, 'text', 'leeg'),
    XS('achternaam', 1, 'text', 'achternaam'),
    XS('tussenvoegsels', 1, 'text', 'tussenvoegsel'),
    XS('roepnaam', 1, 'text', 'roepnaam'),
    XS('voorletters', 1, 'text', 'voorletters'),
    XS('postcode', 1, 'text', 'postcode'),
    XS('nummer en toevoeging', 1, 'text', 'huisnummer'),
    XS('', 5, 'text', 'toevoeging', 'Vakje zonder label direct na "Nummer en toevoeging".'),
    XS('adresregel 2', 1, 'text', 'overslaan'),
    XS('straat', 1, 'text', 'straat'),
    XS('woonplaats', 1, 'text', 'woonplaats'),
    XS('telefoon privé', 1, 'keuze', 'overslaan', TEL),
    XS('', 6, 'text', 'telefoon', TEL + ' HR koppelde hier op 9/11 Telefoon (vast).'),
    XS('telefoon werk', 1, 'keuze', 'overslaan', TEL),
    XS('', 7, 'text', 'telefoon', TEL + ' HR koppelde hier op 9/11 Telefoon (vast).'),
    XS('mobiel privé', 1, 'keuze', 'overslaan', TEL),
    XS('', 8, 'text', 'mobiel', TEL),
    XS('e mailadres privé', 1, 'text', 'emailPrive'),
    XS('e mailadres werk', 1, 'text', 'emailWerk'),
    XS('iban', 1, 'text', 'overslaan'),
    XS('bic', 1, 'text', 'overslaan'),
    XS('uren per week', 1, 'text', 'urenPerWeek'),
    XS('maandsalaris bruto', 1, 'text', 'maandloon'),
    { veld: { id: 'search', name: 'search', label: '', nr: 1, type: 'text' }, sleutel: 'overslaan' },
  ];

  const PORTALEN = {
    insurera: {
      naam: 'Insurer A',
      uitleg: 'Pensioen (inloggen via insurer-a.example, werkgever). Meerdere schermen: klik op elk scherm "Vul deze pagina".',
      hosts: ['insurer-a.example'],
      email: 'emailPrive',
      regels: [],
      // Faalpunt 9/11: of het salarisveld een maand- of jaarbedrag wil, is niet bekend (navragen bij HR of Insurer A).
      // Leeg = geen omrekening (zoals tot en met v0.5). In te stellen onder Meer, of hier vast te zetten op 'maand' of 'jaar'.
      salarisEenheid: '',
      getalNotatie: '',
      controle: ['Fulltime jaarsalaris is berekend (12 x maandloon + 8% vakantiegeld, eventueel 13e maand, omgerekend naar fulltime). Controleer het bedrag, en of Insurer A hier een jaar- of maandbedrag wil (instelling onder Meer).'],
      koppelingen: [],
    },
    insurerb: {
      naam: 'Insurer B',
      uitleg: 'Ongevallenverzekering.',
      hosts: [],
      email: 'emailWerk',
      regels: [],
      controle: [],
      koppelingen: [],
    },
    healthdesk: {
      naam: 'HealthDesk',
      uitleg: 'Werknemer toevoegen: één formulier. Afdeling en functie moeten al in de keuzelijst staan.',
      // Sinds v0.6: de site uit de test van 9/11 (apps.healthdesk.example) hoort bij dit portaal, met de vaste koppelingen hierboven.
      hosts: ['healthdesk.example'],
      email: 'emailWerk',
      regels: [],
      controle: [
        'De startdatum staat er twee keer in (Financiële gegevens en Dienstverband). Check of beide gevuld zijn.',
        'Telefoonnummers: staat het nummer in het vakje naast de landcode, niet in de landcode zelf?',
      ],
      koppelingen: HEALTHDESK,
    },
    travelcard: {
      naam: 'TravelCard',
      uitleg: 'Reiskaart per persoon. De kaart gaat naar het adres uit de overeenkomst met TravelCard.',
      hosts: ['travelcard.example'],
      email: 'emailWerk',
      // Bij TravelCard is de ingangsdatum die van de kaart, niet de datum in dienst.
      regels: [{ sleutel: 'ingangsdatumKaart', woorden: ['ingangsdatum', 'activatiedatum', 'gewenste ingangsdatum', 'startdatum'] }],
      controle: ['Kies bij de kaartdetails "per direct" of de eigen ingangsdatum.'],
      koppelingen: [],
    },
  };

  // Een site zonder vaste regels: eigen portaal op naam van de site, algemene regels.
  function algemeen(id) {
    return {
      naam: id, uitleg: 'Eigen portaal voor deze site. Eerste keer: lijst nakijken en Opslaan, daarna vult hij direct.',
      hosts: [id], email: 'emailWerk', regels: [], controle: [], koppelingen: [], eigen: true,
    };
  }

  // Het portaal bij een id: een van de vier bekende of een site ("healthservice.example").
  function portaal(id) {
    if (!id) return null;
    return PORTALEN[id] || algemeen(id);
  }

  // "www.voorbeeld.example" en "voorbeeld.example" zijn dezelfde site.
  function siteId(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '');
  }

  // Welk portaal hoort bij deze site: wat HR koppelde, dan de vaste lijst, anders de site zelf.
  // Geeft alleen null zonder site (bijvoorbeeld een nieuw tabblad van Edge).
  function portaalVoorHost(host, geleerd) {
    if (!host) return null;
    const g = geleerd || {};
    if (g[host]) return g[host];
    const kaal = siteId(host);
    if (g[kaal]) return g[kaal];
    return Object.keys(PORTALEN).find(id => PORTALEN[id].hosts.some(h => kaal === h || kaal.endsWith('.' + h))) || kaal;
  }

  const api = { PORTALEN, portaal, portaalVoorHost, siteId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AdressenboekjePortalen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
