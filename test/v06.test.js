// v0.6: de faalpunten uit de test met HR op 9/11, zonder browser. Draai: node --test test/matcher.test.js test/v06.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/matcher.js');
const P = require('../extension/portalen.js');
const { herken, waardeVoor, alternatieven, zoekKoppeling } = M;

// Verzonnen testpersoon, geen echte gegevens.
const profiel = { maandloon: '3.500,00', urenPerWeek: '32', fulltimeUren: '40', dienstverband: 'onbepaald' };

test('dienstverband: synoniemen worden een soort, twijfel wordt niets', () => {
  const s = M.dienstverbandSoort;
  for (const t of ['Vast', 'vast contract', 'Onbepaalde tijd', 'Contract voor onbepaalde tijd', 'OBT', 'Permanent', 'onbepaald']) assert.equal(s(t), 'onbepaald', t);
  for (const t of ['Tijdelijk', 'Bepaalde tijd', 'Contract voor bepaalde tijd', 'BT', 'Jaarcontract', 'tijdelijk contract', 'Fixed term']) assert.equal(s(t), 'bepaald', t);
  for (const t of ['Oproepkracht', 'Nulurencontract', 'min-max contract']) assert.equal(s(t), 'oproep', t);
  // "onbepaald" bevat "bepaald": nooit verwarren.
  assert.notEqual(s('Onbepaalde tijd'), 'bepaald');
  assert.notEqual(s('Bepaalde tijd'), 'onbepaald');
  // Twijfel of onbekend (codes, uitzendkracht): niet gokken.
  for (const t of ['Tijdelijk, daarna vast', 'O', 'B', '01', 'Uitzendkracht', '']) assert.equal(s(t), '', t);
});

test('dienstverband: herkend aan label en id, niet bij start, einde of uren', () => {
  assert.equal(herken({ label: 'Dienstverband' }), 'dienstverband');
  assert.equal(herken({ label: 'Soort dienstverband' }), 'dienstverband');
  assert.equal(herken({ label: 'Type contract' }), 'dienstverband');
  assert.equal(herken({ id: 'dienstverbandCode' }), 'dienstverband'); // AbsencePortal, export 9/11
  assert.equal(herken({ label: 'Startdatum dienstverband' }), 'datumInDienst');
  assert.equal(herken({ label: 'Einde dienstverband' }), 'einddatum');
  assert.equal(herken({ label: 'Uren dienstverband' }), 'urenPerWeek');
  assert.equal(herken({ label: 'Soort salaris' }), 'loonbegrip');
});

test('dienstverband: waarde voor een tekstveld, opties en HRSuite', () => {
  assert.equal(waardeVoor('dienstverband', { dienstverband: 'onbepaald' }), 'Onbepaalde tijd');
  assert.equal(waardeVoor('dienstverband', { dienstverband: 'bepaald' }), 'Bepaalde tijd');
  assert.equal(waardeVoor('dienstverband', { dienstverband: 'bepaald' }, {}, { dienstverbandTekst: { bepaald: 'Tijdelijk' } }), 'Tijdelijk');
  assert.equal(waardeVoor('dienstverband', { dienstverband: 'onzin' }), '');
  assert.ok(alternatieven('dienstverband', 'Onbepaalde tijd').includes('vast'));
  assert.equal(M.naarProfiel([{ sleutel: 'dienstverband', waarde: 'Contract voor onbepaalde tijd' }]).dienstverband, 'onbepaald');
  assert.equal(M.naarProfiel([{ sleutel: 'dienstverband', waarde: 'X1' }]).dienstverband, undefined);
  assert.equal(M.ontbreektReden('dienstverband', { dienstverband: 'X1' }), 'dienstverband "X1" niet herkend');
});

test('salaris: standaard geen omrekening (zoals v0.5)', () => {
  assert.equal(waardeVoor('maandloon', profiel), '3500');
  assert.equal(waardeVoor('fulltimeJaarsalaris', profiel, {}, P.PORTALEN.insurera), waardeVoor('fulltimeJaarsalaris', profiel));
  assert.equal(P.PORTALEN.insurera.salarisEenheid, '');
});

test('salaris: per portaal maand of jaar, x 12 of gedeeld door 12', () => {
  const maand = { salarisEenheid: 'maand' }, jaar = { salarisEenheid: 'jaar' };
  assert.equal(waardeVoor('fulltimeJaarsalaris', profiel), '56700'); // 3500 x 12 x 1,08 / 0,8
  assert.equal(waardeVoor('fulltimeJaarsalaris', profiel, {}, maand), '4725');
  assert.equal(waardeVoor('maandloon', profiel, {}, jaar), '42000');
  assert.equal(waardeVoor('maandloon', profiel, {}, maand), '3500');
  assert.equal(waardeVoor('jaarsalaris', profiel, {}, jaar), '45360');
  assert.equal(M.salarisOmrekening('maandloon', jaar).uitleg, 'x 12, per jaar');
  assert.equal(M.salarisOmrekening('maandloon', {}).uitleg, '');
  assert.equal(M.salarisOmrekening('achternaam', jaar), null);
});

test('salaris: getalnotatie komma of punt, nooit euroteken of duizendtallen', () => {
  const p = Object.assign({}, profiel, { maandloon: '€ 3.500,50' });
  assert.equal(waardeVoor('maandloon', p), '3500,50');
  assert.equal(waardeVoor('maandloon', p, {}, { getalNotatie: 'punt' }), '3500.50');
  assert.equal(waardeVoor('maandloon', p, { type: 'number' }), '3500.50');
  assert.equal(waardeVoor('fulltimeJaarsalaris', p, {}, { salarisEenheid: 'maand' }), '4725,67'); // 56708 / 12
  assert.ok(!/[€.]/.test(waardeVoor('fulltimeJaarsalaris', p)));
  assert.equal(waardeVoor('parttimePercentage', p, {}, { getalNotatie: 'punt' }), '80');
});

test('salaris: geen getal wordt geen salaris, en het rapport zegt waarom', () => {
  assert.equal(waardeVoor('maandloon', { maandloon: 'Maandloon' }), '');
  assert.equal(M.naarProfiel([{ sleutel: 'maandloon', waarde: 'Maandloon' }]).maandloon, undefined);
  assert.equal(M.naarProfiel([{ sleutel: 'maandloon', waarde: '€ 3.500,00' }]).maandloon, '3.500,00');
  assert.match(M.ontbreektReden('fulltimeJaarsalaris', { maandloon: '3500' }), /uren per week/);
  assert.match(M.ontbreektReden('fulltimeJaarsalaris', {}), /bruto maandloon ontbreekt/);
  assert.match(M.ontbreektReden('maandloon', { maandloon: 'Maandloon' }), /geen bedrag/);
  assert.equal(M.ontbreektReden('achternaam', {}), 'geen gegeven op het tabje HRSuite');
});

test('id dat per keer laden verandert telt niet mee', () => {
  const s = M.stabielId;
  assert.equal(s('dp1794240345411'), ''); // jQuery UI-datumkiezer, HealthDesk 9/11
  assert.equal(s(':r3:'), '');
  assert.equal(s('Window_0_9F0BEFFA5E5C43E68C8E5078A7D7B4D0_filter_U001'), '');
  assert.equal(s('3f2a9c1e-12ab-4cde-9f00-123456789abc'), '');
  assert.equal(s('input-174'), 'input-174'); // Insurer A: blijft, bestaande koppelingen werken door
  assert.equal(s('newLoginname'), 'newLoginname');
  assert.equal(s('dp1'), 'dp1');
});

test('HRSuite: velddefinities en rij uit het script, ook met haakjes in teksten en zonder strikte JSON', () => {
  const tekst = [
    'var a = {',
    '  "p_last_name":data.DefineDataField({"Id":"p_last_name","Label":"Geboortenaam","Visible":true}),',
    '  "p_ssn":data.DefineDataField({"Id":"p_ssn","Label":"Burgerservicenummer","Visible":false}),',
    '  "a_house_number":data.DefineDataField({"Id":"a_house_number","Label":"","Visible":true}),',
    '  "Xx":data.DefineDataField({"Id":"Xx","Label":"Opmerking {intern}",onClick:function(){return 1;}})',
    '};',
    'var rij = {"1":{"p_last_name":"Persoon","p_ssn":"111222333","a_house_number":12,"Xx":"a } b { c","Onbekend":"weg"}};',
    'var tweede = {"1":{"p_last_name":"Anders"}};',
  ].join('\n');
  const per = Object.fromEntries(M.leesHrSuiteScript(tekst).map(x => [x.id, x]));
  assert.deepEqual(Object.keys(per), ['p_last_name', 'p_ssn', 'a_house_number', 'Xx']);
  assert.equal(per.p_last_name.waarde, 'Persoon'); // eerste rij wint
  assert.equal(per.p_ssn.waarde, '111222333');
  assert.equal(per.p_ssn.zichtbaar, false);
  assert.equal(per.a_house_number.waarde, '12');
  assert.equal(per.Xx.label, 'Opmerking {intern}');
  assert.equal(per.Xx.waarde, 'a } b { c');
  assert.deepEqual(M.leesHrSuiteScript('geen hrsuite hier'), []);
  // Bekende Id's uit de bron van 9/11.
  assert.equal(M.HRSUITE_IDS.e_contract_type, 'dienstverband');
  assert.equal(M.HRSUITE_IDS.p_ssn, 'bsn');
  assert.equal(M.HRSUITE_IDS.p_birth_date, 'geboortedatum');
});

test('HealthDesk: site uit de test hoort bij het portaal, vaste koppelingen zijn geldig', () => {
  assert.equal(P.portaalVoorHost('apps.healthdesk.example', {}), 'healthdesk');
  const geldig = new Set(['overslaan', 'leeg'].concat(M.VELDEN.map(v => v.sleutel), M.AFGELEID.map(v => v.sleutel)));
  const lijst = P.PORTALEN.healthdesk.koppelingen;
  assert.ok(lijst.length >= 20);
  for (const k of lijst) {
    assert.ok(geldig.has(k.sleutel), k.sleutel);
    assert.equal(typeof k.veld.label, 'string');
    assert.ok(k.veld.nr >= 1);
  }
  // Telefoon: de keuzelijst met label (landcode) niet, het vakje zonder label erna wel.
  const tel = lijst.filter(k => k.veld.label === 'telefoon privé' || (k.veld.label === '' && k.veld.nr === 6));
  assert.deepEqual(tel.map(k => k.sleutel), ['overslaan', 'telefoon']);
  assert.ok(tel.every(k => k.controleer));
  // Een vaste koppeling zonder label vindt alleen precies hetzelfde veld (label leeg, zelfde volgnummer).
  assert.equal(zoekKoppeling(lijst, { id: '', name: '', label: '', nr: 8, type: 'text' }).sleutel, 'mobiel');
  assert.equal(zoekKoppeling(lijst, { id: '', name: '', label: '', nr: 2, type: 'select' }), null);
});
