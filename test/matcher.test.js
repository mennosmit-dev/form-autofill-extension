const test = require('node:test');
const assert = require('node:assert/strict');
const { herken, waardeVoor, afleiden, alternatieven, zoekKoppeling, formatDatum } = require('../extension/matcher.js');
const { PORTALEN, portaalVoorHost } = require('../extension/portalen.js');

// Verzonnen testpersoon, geen echte gegevens.
const profiel = {
  voornamen: 'Test Jan', roepnaam: 'Test', tussenvoegsel: 'van der', achternaam: 'Persoon', achternaamPartner: '',
  emailWerk: 'test@werk.example', emailPrive: 'test@prive.example', telefoon: '030-1234567', mobiel: '+31 6 12345678',
  straat: 'Teststraat', huisnummer: '12', toevoeging: 'A', postcode: '1234 ab', woonplaats: 'Utrecht',
  geboortedatum: '1995-03-07', datumInDienst: '2026-11-01', functie: 'Consultant', geslacht: 'V',
  urenPerWeek: '32', fulltimeUren: '40', maandloon: '3.500,00',
};

test('herkent velden op label, ook met hoofdletters en sterretje', () => {
  assert.equal(herken({ label: 'Voornaam*' }), 'roepnaam');
  assert.equal(herken({ label: 'Roepnaam' }), 'roepnaam');
  assert.equal(herken({ label: 'Voornamen' }), 'voornamen');
  assert.equal(herken({ label: 'Achternaam' }), 'achternaam');
  assert.equal(herken({ label: 'Functie' }), 'functie');
  assert.equal(herken({ label: 'BSN' }), 'bsn');
  assert.equal(herken({ label: 'Burgerservicenummer' }), 'bsn');
});

test('achternaam partner krijgt niet de eigen achternaam', () => {
  assert.equal(herken({ label: 'Achternaam partner' }), 'achternaamPartner');
  assert.equal(herken({ label: 'Naam partner' }), 'achternaamPartner');
  assert.equal(herken({ name: 'Achternaam_partner' }), 'achternaamPartner');
  assert.equal(herken({ label: 'Tussenvoegsel partner' }), 'tussenvoegselPartner');
  assert.equal(waardeVoor('achternaamPartner', profiel), '');
});

test('werk- en privé-e-mail apart, gewoon e-mailveld volgt het portaal', () => {
  assert.equal(herken({ label: 'E-mailadres privé' }), 'emailPrive');
  assert.equal(herken({ label: 'Privé e-mail' }), 'emailPrive');
  assert.equal(herken({ name: 'email_adres_thuis' }), 'emailPrive');
  assert.equal(herken({ label: 'E-mail werk' }), 'emailWerk');
  assert.equal(herken({ label: 'E-mailadres', type: 'email' }), 'email');
  assert.equal(waardeVoor('email', profiel, {}, PORTALEN.travelcard), 'test@werk.example');
  assert.equal(waardeVoor('email', profiel, {}, PORTALEN.insurera), 'test@prive.example');
});

test('telefoon en mobiel apart, zonder spaties en +31', () => {
  assert.equal(herken({ label: 'Telefoonnummer' }), 'telefoon');
  assert.equal(herken({ label: 'Mobiel telefoonnummer' }), 'mobiel');
  assert.equal(herken({ label: 'Telefoonnummer mobiel' }), 'mobiel');
  assert.equal(waardeVoor('mobiel', profiel), '0612345678');
  assert.equal(waardeVoor('telefoon', profiel), '0301234567');
});

test('postcode altijd zonder spatie', () => {
  assert.equal(waardeVoor('postcode', profiel), '1234AB');
});

test('huisnummer krijgt het nummer, niet de toevoeging', () => {
  assert.equal(herken({ label: 'Huisnummer' }), 'huisnummer');
  assert.equal(herken({ label: 'Toev.' }), 'toevoeging');
  assert.equal(herken({ label: 'Huisnummer toevoeging' }), 'toevoeging');
  assert.equal(waardeVoor('huisnummer', profiel), '12');
  assert.equal(waardeVoor('toevoeging', profiel), 'A');
  // Typt HR "12A" in het nummerveld, dan wordt het toch netjes gesplitst.
  assert.equal(waardeVoor('huisnummer', { huisnummer: '12A' }), '12');
  assert.equal(waardeVoor('toevoeging', { huisnummer: '12A' }), 'A');
  assert.equal(waardeVoor('toevoeging', { huisnummer: '12' }), '');
});

test('voorletters met punten, ook afgeleid uit de voornamen', () => {
  assert.equal(waardeVoor('voorletters', profiel), 'T.J.');
  assert.equal(waardeVoor('voorletters', { voorletters: 'GS' }), 'G.S.');
  assert.equal(waardeVoor('voorletters', { voorletters: 'g. s.' }), 'G.S.');
  assert.equal(waardeVoor('voorletters', { voorletters: 'Th.J.' }), 'Th.J.');
});

test('datums: DD-MM-JJJJ, of het patroon uit de placeholder, of verdeeld over drie velden', () => {
  assert.equal(waardeVoor('geboortedatum', profiel), '07-03-1995');
  assert.equal(waardeVoor('geboortedatum', profiel, { type: 'date' }), '1995-03-07');
  assert.equal(waardeVoor('geboortedatum', profiel, { placeholder: 'dd/mm/jjjj' }), '07/03/1995');
  assert.equal(waardeVoor('geboortedatum', profiel, { placeholder: 'DDMMYYYY' }), '07031995');
  assert.equal(formatDatum('1995-03-07', 'text', 'Kies een datum'), '07-03-1995');
  assert.equal(waardeVoor('geboortedatum.dag', profiel), '07');
  assert.equal(waardeVoor('geboortedatum.maand', profiel), '03');
  assert.equal(waardeVoor('geboortedatum.jaar', profiel), '1995');
});

test('indiensttreding, ingangsdatum, te gebruiken vanaf en startdatum arbeidsovereenkomst zijn de datum in dienst', () => {
  for (const label of ['Datum indiensttreding', 'Datum in dienst', 'Ingangsdatum', 'Te gebruiken vanaf', 'Startdatum arbeidsovereenkomst', 'Startdatum']) {
    assert.equal(herken({ label }), 'datumInDienst', label);
  }
  assert.equal(waardeVoor('datumInDienst', profiel), '01-11-2026');
});

test('bij TravelCard is de ingangsdatum die van de kaart, standaard gelijk aan in dienst', () => {
  assert.equal(herken({ label: 'Ingangsdatum' }, PORTALEN.travelcard), 'ingangsdatumKaart');
  assert.equal(waardeVoor('ingangsdatumKaart', profiel), '01-11-2026');
  assert.equal(waardeVoor('ingangsdatumKaart', { ...profiel, ingangsdatumKaart: '2026-11-15' }), '15-11-2026');
});

test('personeelsnummer, kostenplaats en einddatum blijven leeg', () => {
  assert.equal(herken({ label: 'Personeelsnummer' }), 'personeelsnummer');
  assert.equal(herken({ label: 'Kostenplaats' }), 'kostenplaats');
  assert.equal(waardeVoor('personeelsnummer', { personeelsnummer: '123' }), '');
  assert.equal(waardeVoor('kostenplaats', profiel), '');
});

test('geslacht: M en V passen op man/vrouw, heer/mevrouw en codes', () => {
  assert.equal(herken({ label: 'Geslacht' }), 'geslacht');
  assert.ok(alternatieven('geslacht', 'V').includes('vrouw'));
  assert.ok(alternatieven('geslacht', 'V').includes('mevrouw'));
  assert.ok(alternatieven('geslacht', 'M').includes('man'));
  assert.ok(!alternatieven('geslacht', 'M').includes('vrouw'));
});

test('salaris: maandloon, jaarsalaris en fulltime jaarsalaris zijn drie verschillende velden', () => {
  assert.equal(herken({ label: 'Fulltime jaarsalaris' }), 'fulltimeJaarsalaris');
  assert.equal(herken({ label: 'Jaarsalaris fulltime' }), 'fulltimeJaarsalaris');
  assert.equal(herken({ label: 'Jaarsalaris' }), 'jaarsalaris');
  assert.equal(herken({ label: 'Bruto maandloon' }), 'maandloon');
  assert.equal(herken({ label: 'Loonbedrag' }), 'maandloon');
  assert.equal(herken({ label: 'Loonbegrip' }), 'loonbegrip');
  assert.equal(herken({ label: 'Parttimepercentage' }), 'parttimePercentage');
  const a = afleiden(profiel);
  assert.equal(a.parttimePercentage, '80');
  assert.equal(a.jaarsalaris, '45360'); // 3500 x 12 x 1,08
  assert.equal(a.fulltimeJaarsalaris, '56700'); // 45360 / 0,8
  assert.equal(waardeVoor('maandloon', profiel), '3500');
  assert.equal(waardeVoor('parttimePercentage', { urenPerWeek: '36', fulltimeUren: '40' }), '90');
  assert.equal(waardeVoor('parttimePercentage', { parttimePercentage: '87.5' }), '87,5');
  assert.equal(waardeVoor('parttimePercentage', { parttimePercentage: '87,5' }, { type: 'number' }), '87.5');
});

test('standaardwaarden: afdeling Voorbeeld BV, taal Nederlands, land Nederland', () => {
  assert.equal(waardeVoor('afdeling', {}), 'Voorbeeld BV');
  assert.equal(herken({ label: 'Agenda afdeling' }), 'afdeling');
  assert.equal(waardeVoor('taal', {}), 'Nederlands');
  assert.equal(herken({ label: 'Taalvoorkeur' }), 'taal');
  assert.ok(alternatieven('taal', 'Nederlands').includes('nl'));
  assert.equal(waardeVoor('land', {}), 'Nederland');
});

test('HR kan alles zelf overschrijven, ook berekende velden', () => {
  assert.equal(waardeVoor('afdeling', { afdeling: 'Data & AI' }), 'Data & AI');
  assert.equal(waardeVoor('fulltimeJaarsalaris', { ...profiel, fulltimeJaarsalaris: '60000' }), '60000');
});

test('geleerde koppeling: op id, op name, en niet als het label iets anders zegt', () => {
  const k = [
    { veld: { id: 'input-3', name: '', label: 'achternaam', nr: 1 }, sleutel: 'achternaam' },
    { veld: { id: '', name: 'f7', label: 'veld zonder label', nr: 1 }, sleutel: 'postcode' },
    { veld: { id: '', name: '', label: 'nummer', nr: 2 }, sleutel: 'toevoeging' },
  ];
  assert.equal(zoekKoppeling(k, { id: 'input-3', name: '', label: 'achternaam', nr: 1 }).sleutel, 'achternaam');
  assert.equal(zoekKoppeling(k, { id: 'input-3', name: '', label: 'iban', nr: 1 }), null);
  assert.equal(zoekKoppeling(k, { id: 'x', name: 'f7', label: '', nr: 1 }).sleutel, 'postcode');
  assert.equal(zoekKoppeling(k, { id: '', name: '', label: 'nummer', nr: 2 }).sleutel, 'toevoeging');
  assert.equal(zoekKoppeling(k, { id: '', name: '', label: 'nummer', nr: 1 }), null);
});

test('v0.5: precies dezelfde vingerafdruk gaat voor, alleen-label eist hetzelfde soort veld', () => {
  const k = [
    { veld: { id: 'an', name: 'achternaam', label: 'achternaam', nr: 1, type: 'text' }, sleutel: 'achternaam' },
    { veld: { id: '', name: 'achternaam', label: 'achternaam', nr: 1, type: 'text' }, sleutel: 'naam' },
    { veld: { id: 'gd', name: 'geboortedatum', label: 'geboortedatum', nr: 1, type: 'date' }, sleutel: 'geboortedatum' },
  ];
  assert.equal(zoekKoppeling(k, { id: '', name: 'achternaam', label: 'achternaam', nr: 1, type: 'text' }).sleutel, 'naam');
  assert.equal(zoekKoppeling(k, { id: '', name: 'gd_dag', label: 'geboortedatum', nr: 1, type: 'select' }), null);
  assert.equal(zoekKoppeling(k, { id: '', name: 'x', label: 'geboortedatum', nr: 1, type: 'date' }).sleutel, 'geboortedatum');
});

test('v0.5: label "Name" met placeholder "First Name" is de voornaam, niet de volledige naam', () => {
  assert.equal(herken({ label: 'Name', placeholder: 'First Name' }), 'roepnaam');
  assert.equal(herken({ label: 'Name', placeholder: 'Last Name' }), 'achternaam');
  assert.equal(herken({ label: 'Naam', placeholder: 'Jan Jansen' }), 'naam');
});

test('portaal wordt herkend aan de site, geleerde sites gaan voor', () => {
  assert.equal(portaalVoorHost('www.travelcard.example', {}), 'travelcard');
  assert.equal(portaalVoorHost('pension.insurer-a.example', {}), 'insurera');
  assert.equal(portaalVoorHost('werkgever.voorbeeld.example', { 'werkgever.voorbeeld.example': 'healthdesk' }), 'healthdesk');
  // v0.5: elke site is een portaal; zonder site (nieuw tabblad) geen portaal.
  assert.equal(portaalVoorHost('elders.example', {}), 'elders.example');
  assert.equal(portaalVoorHost('www.elders.example', {}), 'elders.example');
  assert.equal(portaalVoorHost('', {}), null);
});

test('v0.5: een onbekende site krijgt een eigen portaal met de algemene regels', () => {
  const { portaal } = require('../extension/portalen.js');
  const p = portaal('healthservice.example');
  assert.equal(p.naam, 'healthservice.example');
  assert.equal(p.email, 'emailWerk');
  assert.deepEqual(p.koppelingen, []);
  assert.equal(portaal('insurera').email, 'emailPrive');
  assert.equal(portaal(null), null);
  assert.equal(waardeVoor('email', profiel, {}, p), 'test@werk.example');
});

test('bedrijfsnaam wordt niet als naam van de collega gezien', () => {
  assert.equal(herken({ label: 'Bedrijfsnaam' }), 'bedrijf');
  assert.equal(herken({ label: 'Naam' }), 'naam');
  assert.equal(waardeVoor('naam', profiel), 'Test van der Persoon');
});

test('slaat wachtwoord, zoekveld, vinkjes en knoppen over', () => {
  assert.equal(herken({ type: 'password', label: 'Naam' }), null);
  assert.equal(herken({ type: 'search', label: 'Zoek op naam' }), null);
  assert.equal(herken({ type: 'checkbox', label: 'Partner naam opgeven' }), null);
  assert.equal(herken({ type: 'hidden', name: 'email' }), null);
  assert.equal(herken({ label: 'Opmerkingen' }), null);
});

const { naarProfiel, leesDatum } = require('../extension/matcher.js');

test('HRSuite-waarden worden profielwaarden: datums, geslacht, postcode', () => {
  assert.equal(leesDatum('07-03-1995'), '1995-03-07');
  assert.equal(leesDatum('7-3-1995'), '1995-03-07');
  assert.equal(leesDatum('1995-03-07'), '1995-03-07');
  assert.equal(leesDatum('7 maart 1995'), '1995-03-07');
  assert.equal(leesDatum('onzin'), '');
  const p = naarProfiel([
    { sleutel: 'geboortedatum', waarde: '07-03-1995' },
    { sleutel: 'geslacht', waarde: 'Vrouw' },
    { sleutel: 'postcode', waarde: '1234 ab' },
    { sleutel: 'achternaam', waarde: '  Persoon ' },
    { sleutel: 'maandloon', waarde: '€ 3.500,00' },
  ]);
  assert.deepEqual(p, { geboortedatum: '1995-03-07', geslacht: 'V', postcode: '1234AB', achternaam: 'Persoon', maandloon: '3.500,00' });
});

test('HRSuite: adres in één regel wordt straat, huisnummer en toevoeging', () => {
  assert.deepEqual(naarProfiel([{ sleutel: 'adres', waarde: 'Lange Teststraat 12 A' }]), { straat: 'Lange Teststraat', huisnummer: '12', toevoeging: 'A' });
  assert.deepEqual(naarProfiel([{ sleutel: 'adres', waarde: 'Teststraat 5' }]), { straat: 'Teststraat', huisnummer: '5' });
});

test('HRSuite: datum in drie delen, eerste waarde wint, onzin en afspraken blijven eruit', () => {
  const p = naarProfiel([
    { sleutel: 'datumInDienst.dag', waarde: '1' }, { sleutel: 'datumInDienst.maand', waarde: '11' }, { sleutel: 'datumInDienst.jaar', waarde: '2026' },
    { sleutel: 'mobiel', waarde: '0612345678' }, { sleutel: 'mobiel', waarde: '0687654321' },
    { sleutel: 'email', waarde: 'a@werk.example' }, { sleutel: 'telefoonOfMobiel', waarde: '0301234567' },
    { sleutel: 'personeelsnummer', waarde: '123' }, { sleutel: 'naam', waarde: 'Test Persoon' }, { sleutel: 'overslaan', waarde: 'x' },
    { sleutel: 'afdeling', waarde: 'Data & AI' }, { sleutel: 'functie', waarde: '' }, { sleutel: 'dertiendeMaand', waarde: 'Ja' },
  ]);
  assert.deepEqual(p, { datumInDienst: '2026-11-01', mobiel: '0612345678', emailWerk: 'a@werk.example', telefoon: '0301234567', dertiendeMaand: 'ja' });
  // Afdeling alleen als HR hem zelf koppelde: de portalen willen standaard Voorbeeld BV.
  assert.deepEqual(naarProfiel([{ sleutel: 'afdeling', waarde: 'Data & AI', bron: 'geleerd' }]), { afdeling: 'Data & AI' });
});

test('v0.4.1: leesbare namen in het rapport en huisnummer + toevoeging in één veld', () => {
  const { labelVoor, naarProfiel, AFGELEID } = require('../extension/matcher.js');
  assert.equal(labelVoor('geboortedatum.dag'), 'Geboortedatum: dag');
  assert.equal(labelVoor('telefoonOfMobiel'), 'Mobiel');
  assert.equal(labelVoor('emailPrive'), 'E-mail privé');
  // Staat in de keuzelijst, anders wordt het veld rood en na Opslaan overgeslagen.
  assert.ok(AFGELEID.some(v => v.sleutel === 'huisnummerCompleet'));
  assert.deepEqual(naarProfiel([{ sleutel: 'huisnummerCompleet', waarde: '12-2' }]), { huisnummer: '12', toevoeging: '2' });
  assert.equal(waardeVoor('huisnummerCompleet', profiel), '12 A');
});
