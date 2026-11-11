// Vult de velden op de huidige pagina met het profiel uit het adressenboekje.
// Gebruikt door de extensie (via chrome.scripting), de leerstand (leer.js), de koppelpagina en de bookmarklet.
// v0.6: rapport per veld (ingevuld / niet gevonden / overgeslagen / mislukt, met reden), nooit een foute waarde laten staan,
// HRSuite lezen uit het live scherm en uit het script van de pagina, en een diagnose per label/waarde.
// v0.5: ook zelfgebouwde keuzelijsten (role=combobox/listbox), knoppen als keuzerondjes, velden in open shadow roots,
// contenteditable, velden die later verschijnen, en na het vullen een controle per veld.
(function (root) {
  'use strict';

  const M = () => root.AdressenboekjeMatcher;
  const wacht = ms => new Promise(r => setTimeout(r, ms));

  // ---- De pagina doorlopen, ook binnen webcomponenten (open shadow roots) ----
  // Volgorde zoals op het scherm: de inhoud van een webcomponent staat op de plek van de component,
  // en wat in een <slot> terechtkomt op de plek van die slot. Dat telt voor buren als dag/maand/jaar.
  function doorloop(wortel, bezoek) {
    const kinderen = n => { for (let c = n.firstElementChild; c; c = c.nextElementSibling) stap(c); };
    const stap = el => {
      bezoek(el);
      if (el.shadowRoot) { kinderen(el.shadowRoot); return; }
      if (el.tagName === 'SLOT' && el.assignedElements) {
        const toegewezen = el.assignedElements({ flatten: true });
        if (toegewezen.length) { toegewezen.forEach(stap); return; }
      }
      if (el.tagName === 'TEMPLATE') return;
      kinderen(el);
    };
    if (wortel.nodeType === 1) stap(wortel); else kinderen(wortel);
  }

  function alle(wortel, test) {
    const uit = [];
    doorloop(wortel, el => { if (test(el)) uit.push(el); });
    return uit;
  }

  // closest() dat ook uit een webcomponent naar buiten kijkt.
  function dichtbij(el, sel) {
    for (let e = el; e;) {
      const c = e.closest(sel);
      if (c) return c;
      const r = e.getRootNode();
      e = r && r.host;
    }
    return null;
  }

  function zoekId(el, id) {
    const r = el.getRootNode();
    return (r && r.getElementById && r.getElementById(id)) || el.ownerDocument.getElementById(id);
  }

  // Tekst van een element, zonder wat in `zonder` staat (de keuzelijst zelf, of de gekozen waarde).
  function tekstZonder(el, zonder) {
    let t = '';
    const loop = n => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) t += c.textContent;
        else if (c.nodeType === 1 && !(zonder && zonder(c))) loop(c);
      }
    };
    loop(el);
    return t;
  }

  const NATIVE = 'input, select, textarea';
  const KEUZE_ROL = /^(combobox|listbox)$/;
  const isNative = el => el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';

  function labelVan(el) {
    const doc = el.ownerDocument;
    const r = el.getRootNode();
    const q = r && r.querySelector ? r : doc;
    // Bij een zelfgebouwde keuzelijst niet de gekozen waarde meenemen, anders verandert het label na het vullen.
    const eigen = isNative(el) ? null : c => c === el || el.contains(c) && c.matches('[role=listbox], [role=option]');
    const tekstVan = l => isNative(el) ? l.textContent : tekstZonder(l, c => c === el || eigen(c));
    if (el.id) {
      const l = q.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return tekstVan(l);
    }
    const omhullend = el.closest('label');
    if (omhullend) return tekstVan(omhullend);
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      // Select2 en MUI verwijzen ook naar hun eigen waardevak: dat is de gekozen waarde, geen label.
      const t = ids.split(/\s+/).filter(id => id && id !== el.id).map(id => zoekId(el, id))
        .filter(x => x && !(eigen && el.contains(x))).map(x => x.textContent).join(' ').trim();
      if (t) return t;
    }
    const sel = !isNative(el) && verborgenSelect(el);
    if (sel) return labelVan(sel);
    // Veel portalen zetten de tekst in een losse <span> of <div> vlak voor het veld.
    // Bij een zelfgebouwde keuzelijst vanaf de buitenkant van de lijst kijken, niet vanaf het vak met de gekozen waarde.
    const keuze = !isNative(el) || isKeuzeInvoer(el);
    const velden = keuze ? NATIVE + ', [role=combobox], [role=listbox], [contenteditable]' : NATIVE;
    const w = keuze ? widgetWortel(el) : el;
    let vorige = w.previousElementSibling;
    // Een <br> of leeg blokje ertussen overslaan ("Geboortedatum<br><select>").
    for (let i = 0; i < 2 && vorige && !vorige.textContent.trim() && !vorige.matches(velden) && !vorige.querySelector(velden); i++) vorige = vorige.previousElementSibling;
    if (vorige && !vorige.matches(velden) && vorige.textContent.trim().length < 60) return vorige.textContent;
    // Alleen voor het eerste veld in een blok: anders krijgt het tweede vakje het label van het blok erboven.
    const ouder = w.parentElement && w.parentElement.previousElementSibling;
    const eerste = w.parentElement && w.parentElement.querySelector(velden);
    const eersteInBlok = !!eerste && (eerste === el || w.contains(eerste));
    if (ouder && eersteInBlok && ouder.textContent.trim().length < 60) return ouder.textContent;
    // Een veld in een webcomponent zonder eigen label: het label van de component zelf (<mijn-veld label="Voornaam">).
    if (r && r.host) {
      const h = r.host;
      return h.getAttribute('label') || h.getAttribute('aria-label') || labelVan(h);
    }
    return '';
  }

  // De buitenkant van een zelfgebouwde keuzelijst (React-Select: container > control > waarde > invoer).
  function widgetWortel(el) {
    let w = el;
    for (let e = el.parentElement, i = 0; e && i < 6; e = e.parentElement, i++) {
      if (e.matches('label, form, fieldset, body') || e.querySelectorAll(NATIVE + ', [role=combobox]').length > 2) break;
      const c = typeof e.className === 'string' ? e.className : '';
      if (/container|control|select|combobox|autocomplete|dropdown|picker/i.test(c) || e.getAttribute('role') === 'combobox') w = e;
    }
    return w;
  }

  // Het label van een groep keuzerondjes of knoppen ("Geslacht"), niet dat van één rondje ("Man").
  function groepLabel(rondjes) {
    const eerste = rondjes[0];
    const fs = eerste.closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    if (legend) return legend.textContent;
    const groep = eerste.closest('[role=radiogroup], [role=group]');
    if (groep) {
      if (groep.getAttribute('aria-label')) return groep.getAttribute('aria-label');
      const ids = groep.getAttribute('aria-labelledby');
      if (ids) return ids.split(/\s+/).map(id => (zoekId(eerste, id) || {}).textContent || '').join(' ');
    }
    // Zoek omhoog naar de eerste tekst vóór de groep.
    let blok = eerste.closest('label') || eerste;
    for (let i = 0; i < 4 && blok; i++, blok = blok.parentElement) {
      const vorige = blok.previousElementSibling;
      if (vorige && vorige.textContent.trim() && vorige.textContent.trim().length < 60 && !vorige.querySelector('input') && !rondjes.includes(vorige)) return vorige.textContent;
    }
    return '';
  }

  // Wat voor veld is dit? native (input/select/textarea), keuze (zelfgebouwde keuzelijst),
  // tekstvak (contenteditable) of knop (een knop in een groep die als keuzerondjes werkt).
  function soortVan(el) {
    if (isNative(el)) {
      if (el.tagName === 'INPUT' && isKeuzeInvoer(el)) return 'keuze';
      return 'native';
    }
    const ce = el.getAttribute('contenteditable');
    if (ce !== null && ce !== 'false' && !(el.parentElement && el.parentElement.closest('[contenteditable]:not([contenteditable=false])'))) return 'tekstvak';
    const rol = (el.getAttribute('role') || '').toLowerCase();
    if (rol === 'listbox' && isUitklapLijst(el)) return null;
    if (KEUZE_ROL.test(rol) || el.getAttribute('aria-haspopup') === 'listbox' || el.tagName === 'MAT-SELECT') return 'keuze';
    if (rol === 'radio') return 'knop';
    if (el.hasAttribute('aria-pressed') && (el.tagName === 'BUTTON' || rol === 'button') && el.closest('form, fieldset, [role=group]')) return 'knop';
    return null;
  }

  // De uitgeklapte lijst van een andere keuzelijst is zelf geen veld.
  function isUitklapLijst(el) {
    const r = el.getRootNode();
    if (el.id && r.querySelector && r.querySelector('[aria-controls~="' + CSS.escape(el.id) + '"], [aria-owns~="' + CSS.escape(el.id) + '"]')) return true;
    return !!el.closest('[role=presentation], [role=dialog], [class*=menu], [class*=popover], [class*=overlay], [class*=dropdown], .select2-results');
  }

  // Een tekstvak dat eigenlijk een keuzelijst is (React-Select, MUI Autocomplete, Downshift).
  function isKeuzeInvoer(el) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!['text', 'search', ''].includes(type)) return false;
    const ac = el.getAttribute('aria-autocomplete');
    return el.getAttribute('role') === 'combobox' || ac === 'list' || ac === 'both' || el.getAttribute('aria-haspopup') === 'listbox';
  }

  function beschrijf(el, soort) {
    const r = el.getRootNode();
    const host = r && r.host;
    // Eén veld in de component: dan mag het de naam en het id van de component dragen.
    const enig = !!host && r.querySelectorAll(NATIVE + ', [role=combobox], [contenteditable]').length === 1;
    let type;
    if (soort === 'keuze') type = 'keuze';
    else if (soort === 'tekstvak') type = 'text';
    else if (soort === 'knop') type = 'knoppen';
    else type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    // v0.6: id's die per keer laden veranderen (dp1794240345411) tellen niet mee, anders herkent hij het veld de volgende keer niet.
    const stabiel = M().stabielId || (x => x);
    const eigenId = stabiel(el.id);
    const hostId = host ? stabiel(host.id) : '';
    return {
      type,
      autocomplete: el.getAttribute('autocomplete') || (host && host.getAttribute('autocomplete')),
      label: labelVan(el),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('title'),
      name: el.getAttribute('name') || (enig ? host.getAttribute('name') : ''),
      // In een webcomponent heet het binnenste veld vaak gewoon "input": dan telt (ook) het id van de component.
      id: host ? (hostId ? (eigenId ? hostId + '/' + eigenId : enig ? hostId : '') : '') : eigenId,
    };
  }

  function isZichtbaar(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // Geplakte HTML heeft geen opmaak en dus geen afmetingen: kijk dan naar wat de HTML zelf verbergt.
  function nietVerborgen(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden || e.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute('style') || '')) return false;
    }
    return true;
  }

  const NIET = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search', 'checkbox'];

  function isGeblokkeerd(el) {
    return !!(el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true');
  }

  // Alle invulbare velden op de pagina, keuzerondjes en knoppengroepen per groep samengenomen,
  // met per veld een vingerafdruk (voor geleerde koppelingen) en het herkende gegeven.
  // opties: { doc, portaal, koppelingen, ookAlleenLezen (HRSuite), metGeblokkeerd (vul: meld velden die uit staan) }
  function analyse(opties) {
    const m = M();
    const o = opties || {};
    const portaal = o.portaal || null;
    const koppelingen = o.koppelingen || [];
    // doc: geplakte HTML (popup) of een geladen HTML-bestand (koppelpagina). Zonder opmaak tellen alle niet-verborgen velden.
    const zichtbaar = o.doc && !o.doc.defaultView ? nietVerborgen : isZichtbaar;

    const kandidaten = [];
    doorloop(o.doc || document, el => {
      const soort = soortVan(el);
      if (soort) kandidaten.push({ el, soort });
    });
    // Een keuzelijst met een invoerveld erin (ARIA 1.1-patroon): het invoerveld is het veld.
    const binnen = new Set();
    for (const k of kandidaten) if (k.soort === 'keuze' && !isNative(k.el) && kandidaten.some(x => x !== k && k.el.contains(x.el))) binnen.add(k);

    const items = [];
    const groepen = new Map();
    for (const k of kandidaten) {
      const el = k.el;
      if (binnen.has(k) || !zichtbaar(el) || dichtbij(el, '[data-adressenboekje]')) continue;
      // Hulpvelden van keuzelijsten (MUI, Select2) zijn verborgen voor schermlezers; de zichtbare lijst telt.
      if (isNative(el) && el.getAttribute('aria-hidden') === 'true' && el.type !== 'radio') continue;
      // Zelfgebouwde keuzelijsten zijn vaak readonly (je kiest, je typt niet): alleen uitgeschakeld telt.
      const geblokkeerd = k.soort === 'keuze' ? !!(el.disabled || el.getAttribute('aria-disabled') === 'true') : isGeblokkeerd(el);
      if (geblokkeerd && !o.ookAlleenLezen && !o.metGeblokkeerd) continue;
      const info = beschrijf(el, k.soort);
      if (k.soort === 'native' && NIET.includes(info.type)) continue;
      if (info.type === 'radio' || k.soort === 'knop') {
        const sleutel = info.type === 'radio'
          ? (info.name ? 'r:' + info.name : el.closest('fieldset'))
          : (el.closest('[role=radiogroup]') || el.parentElement);
        if (!sleutel) continue;
        if (groepen.has(sleutel)) { groepen.get(sleutel).rondjes.push(el); continue; }
        const item = { soort: info.type === 'radio' ? 'radio' : 'knoppen', el, rondjes: [el], info: Object.assign({}, info, { type: info.type === 'radio' ? 'radio' : 'knoppen' }) };
        groepen.set(sleutel, item);
        items.push(item);
        continue;
      }
      items.push({ soort: k.soort === 'native' ? 'veld' : k.soort, el, info, geblokkeerd });
    }
    // Eén losse knop met aria-pressed is een aan/uit-knop, geen keuze.
    const lijst = items.filter(it => it.soort !== 'knoppen' || it.rondjes.length > 1);

    const tellers = {};
    for (const item of lijst) {
      if (item.soort === 'radio' || item.soort === 'knoppen') item.info.label = groepLabel(item.rondjes);
      const label = m.normaliseer(item.info.label || item.info.ariaLabel || item.info.placeholder).slice(0, 60);
      tellers[label] = (tellers[label] || 0) + 1;
      item.vingerafdruk = { id: item.info.id || '', name: item.info.name || '', label, nr: tellers[label], type: item.info.type };
      const geleerd = m.zoekKoppeling(koppelingen, item.vingerafdruk);
      if (geleerd) { item.sleutel = geleerd.sleutel; item.bron = 'geleerd'; item.koppeling = geleerd; continue; }
      // Rondjes en knoppen herkennen we op hun groepslabel; herken() zou "radio" anders als tekst zien.
      const alsTekst = ['radio', 'knoppen'].includes(item.soort);
      item.sleutel = m.herken(Object.assign({}, item.info, { type: alsTekst ? 'text' : item.info.type }), portaal);
      item.bron = item.sleutel ? 'regel' : null;
    }
    corrigeer(lijst);
    // Velden zonder label krijgen voor het rapport en de lijst het label van het veld ervoor als houvast.
    let vorigeLabel = '';
    for (const item of lijst) {
      const l = String(item.info.label || item.info.ariaLabel || item.info.placeholder || '').replace(/\s+/g, ' ').trim();
      if (l) vorigeLabel = l; else item.info.na = vorigeLabel;
    }
    return lijst;
  }

  function isKort(item) {
    const el = item.el;
    return (item.soort === 'veld' && (el.tagName === 'SELECT' || (el.maxLength > 0 && el.maxLength <= 4) || !!deelHint(item)))
      || (item.soort === 'keuze' && !!deelHint(item));
  }

  function deelHint(item) {
    const t = ' ' + M().normaliseer([item.info.label, item.info.placeholder, item.info.name, item.info.id, item.info.ariaLabel].join(' ')) + ' ';
    if (/\s(dag|day|dd)\s/.test(t)) return 'dag';
    if (/\s(maand|month|mm)\s/.test(t)) return 'maand';
    if (/\s(jaar|year|jjjj|yyyy)\s/.test(t)) return 'jaar';
    return null;
  }

  function deelUitOpties(el) {
    if (el.tagName !== 'SELECT') return null;
    const n = Array.from(el.options).filter(o => o.value).length;
    if (n >= 12 && n <= 13) return 'maand';
    if (n >= 28 && n <= 32) return 'dag';
    if (n > 32) return 'jaar';
    return null;
  }

  // Lost op wat per veld niet te zien is, alleen in samenhang met de buren.
  function corrigeer(items) {
    const m = M();
    const auto = i => items[i] && items[i].bron !== 'geleerd';
    for (let i = 0; i < items.length; i++) {
      const a = items[i], b = items[i + 1];
      // "Huisnummer + toevoeging" boven twee vakjes: het eerste is het nummer, het tweede de toevoeging.
      // Eén label "Huisnummer + toevoeging": met een tweede vakje erachter gesplitst, anders samen in één veld.
      // "Toevoeging huisnummer" direct na een huisnummerveld is gewoon de toevoeging.
      const naNummer = i > 0 && items[i - 1].sleutel === 'huisnummer';
      if (auto(i) && !naNummer && a.sleutel === 'toevoeging' && /(^|\s)(huisnummer|huisnr)(\s|$)/.test(m.normaliseer(a.info.label))) {
        if (b && auto(i + 1) && (b.sleutel == null || b.sleutel === 'toevoeging')) { a.sleutel = 'huisnummer'; b.sleutel = 'toevoeging'; b.bron = 'regel'; i++; continue; }
        a.sleutel = 'huisnummerCompleet';
        continue;
      }
      // Een keuzelijst "Telefoon privé" met direct erachter een vakje zonder label (HealthDesk, export 9/11):
      // de keuzelijst is de landcode, het vakje is het nummer. [aanname, zie portalen.js]
      if (b && auto(i) && auto(i + 1) && ['telefoon', 'mobiel'].includes(a.sleutel) && (a.soort === 'keuze' || a.el.tagName === 'SELECT')
        && b.soort === 'veld' && b.el.tagName === 'INPUT' && !String(b.info.label || '').trim() && (b.sleutel == null || b.sleutel === a.sleutel)) {
        b.sleutel = a.sleutel; b.bron = 'regel';
        a.sleutel = 'overslaan'; a.reden = 'landcode van het telefoonnummer; het nummer gaat in het vakje erna';
        i++;
        continue;
      }
      if (b && auto(i) && auto(i + 1)) {
        if (a.sleutel === 'huisnummer' && (b.sleutel === 'huisnummer' || (b.sleutel == null && b.el.maxLength > 0 && b.el.maxLength <= 6))) b.sleutel = 'toevoeging';
        else if (a.sleutel === 'toevoeging' && b.sleutel === 'toevoeging') a.sleutel = 'huisnummer';
      }
      // Een datum verdeeld over drie vakjes of keuzelijsten (dag, maand, jaar).
      if (auto(i) && m.DATUMS.includes(a.sleutel) && isKort(a)) {
        const groep = [a];
        for (let j = i + 1; j < items.length && groep.length < 3; j++) {
          const c = items[j];
          if (!auto(j) || !isKort(c) || (c.sleutel != null && c.sleutel !== a.sleutel)) break;
          groep.push(c);
        }
        if (groep.length === 3) {
          let delen = groep.map(g => deelHint(g) || deelUitOpties(g.el));
          if (new Set(delen).size !== 3 || delen.includes(null)) delen = ['dag', 'maand', 'jaar'];
          const basis = a.sleutel;
          groep.forEach((g, k) => { g.sleutel = basis + '.' + delen[k]; g.bron = 'regel'; });
          i += 2;
        }
      }
    }
    // Staat er alleen een telefoonveld en geen mobiel veld, dan komt het mobiele nummer daar.
    if (!items.some(it => it.sleutel === 'mobiel')) {
      items.forEach(it => { if (it.sleutel === 'telefoon' && it.bron !== 'geleerd') it.sleutel = 'telefoonOfMobiel'; });
    }
  }

  // ---- Invullen: de bouwstenen ----

  // React, Angular en Vue luisteren niet naar el.value = ...; via de native setter
  // plus input- en change-events zien ze de nieuwe waarde wel.
  function zetWaarde(el, waarde) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, waarde);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Typen zoals een mens: teken voor teken. Voor velden met een invoermasker (inputmask, imask, ngx-mask)
  // die een in één keer gezette waarde weggooien.
  async function typ(el, waarde) {
    el.focus();
    if (el.select) { try { el.select(); } catch (e) { /* sommige typen kennen geen selectie */ } }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const zetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (!(document.execCommand && document.execCommand('delete'))) { zetter.call(el, ''); el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' })); }
    for (const teken of String(waarde)) {
      const toets = { key: teken, bubbles: true, cancelable: true, composed: true };
      el.dispatchEvent(new KeyboardEvent('keydown', toets));
      el.dispatchEvent(new KeyboardEvent('keypress', toets));
      const voor = el.value;
      if (!(document.execCommand && document.execCommand('insertText', false, teken)) || el.value === voor) {
        zetter.call(el, voor + teken);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: teken }));
      }
      el.dispatchEvent(new KeyboardEvent('keyup', toets));
    }
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await wacht(30);
  }

  function plat(tekst) {
    return M().normaliseer(tekst).replace(/[^a-z0-9à-ÿ ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Alleen letters en cijfers: "06-12345678" en "0612345678" zijn hetzelfde, net als "07/03/1995" en "07-03-1995".
  const kern = t => String(t || '').toLowerCase().replace(/[^a-z0-9à-ÿ]/g, '');

  function klopt(gelezen, bedoeld) {
    return String(gelezen) === String(bedoeld) || (kern(gelezen) !== '' && kern(gelezen) === kern(bedoeld));
  }

  // Varianten van een waarde voor een veld met maxlength: eerst zonder spaties, dan ook zonder punten en streepjes.
  function varianten(waarde) {
    const w = String(waarde);
    return [w, w.replace(/\s+/g, ''), w.replace(/[\s.\-/]+/g, '')];
  }

  // Past de optietekst bij een van de kandidaten? Eerst exact, dan een heel woord aan het begin ("Nederland (NL)").
  function pastOptie(tekst, waarde, k) {
    const t = plat(tekst), w = plat(waarde);
    if (k.some(x => x === t || (w && x === w))) return 2;
    const getal = (x, y) => /^\d+$/.test(x) && /^\d+$/.test(y) && Number(x) === Number(y);
    if (k.some(x => getal(x, t) || getal(x, w))) return 2;
    if (k.some(x => x.length > 3 && (t.startsWith(x + ' ') || t.endsWith(' ' + x) || t.includes(' ' + x + ' ')))) return 1;
    if (k.some(x => x.length > 4 && t.includes(x))) return 0.5;
    return 0;
  }

  // Hoe goed past een optie (tekst, waarde) bij wat we zoeken? Gewoon: op tekst en synoniemen (pastOptie).
  // Dienstverband: alleen een optie van dezelfde soort ("Vast" bij onbepaald), zodat "Onbepaalde tijd" nooit
  // half past bij "Bepaalde tijd" of andersom.
  function scoorder(s, waarde) {
    const m = M();
    if (String(s).split('.')[0] === 'dienstverband' && m.dienstverbandSoort) {
      const doel = m.dienstverbandSoort(waarde);
      return (tekst, w) => doel && (m.dienstverbandSoort(tekst) === doel || m.dienstverbandSoort(w) === doel) ? 2 : 0;
    }
    const k = m.alternatieven(s, waarde).map(plat).filter(Boolean);
    return (tekst, w) => pastOptie(tekst, w, k);
  }

  function kiesOptie(select, score) {
    const opties = Array.from(select.options).filter(o => o.value !== '' && !o.disabled);
    const best = beste(opties, o => score(o.text, o.value));
    return best ? best.value : null;
  }

  // Voor het rapport: welke opties er wel waren (zodat de beheerder ziet waarom niets paste).
  function optieLijst(teksten) {
    const t = [...new Set(teksten.map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
    return t.length ? '; de lijst heeft: ' + t.slice(0, 6).join(', ') + (t.length > 6 ? ' en ' + (t.length - 6) + ' meer' : '') : '';
  }

  function beste(lijst, score) {
    let top = null, s = 0;
    for (const x of lijst) { const n = score(x); if (n > s) { s = n; top = x; } }
    return top;
  }

  function knopTekst(knop) {
    return knop.tagName === 'INPUT' ? (labelVan(knop) || knop.value) : (knop.getAttribute('aria-label') || knop.textContent);
  }

  function kiesRondje(rondjes, score) {
    return beste(rondjes, r => score(knopTekst(r), r.value || r.getAttribute('data-value') || '')) || null;
  }

  function isGekozen(knop) {
    if (knop.tagName === 'INPUT') return knop.checked;
    return knop.getAttribute('aria-checked') === 'true' || knop.getAttribute('aria-pressed') === 'true' || knop.getAttribute('aria-selected') === 'true'
      || /(^|[\s_-])(selected|active|checked|is-checked|is-selected)($|[\s_-])/i.test(knop.className && knop.className.baseVal != null ? knop.className.baseVal : knop.className || '')
      || !!(knop.querySelector && knop.querySelector('input:checked'));
  }

  // Wat staat er nu in een zelfgebouwde keuzelijst? Plaatshouders ("Select...", "Kies") tellen als leeg.
  const PLAATSHOUDER = /^(onbekend|kies|selecteer|select|maak een keuze|geen|choose|pick|maak uw keuze)\b|^$/;
  const isPlaatshouder = c => /placeholder/i.test(typeof c.className === 'string' ? c.className : '') || c.matches('[role=listbox], [role=option], input, [aria-hidden=true]');
  function huidigeKeuze(item) {
    const el = item.el;
    if (el.tagName === 'INPUT') {
      if (el.value) return el.value;
      // React-Select en dergelijke tonen de gekozen waarde naast het invoerveld.
      for (let e = el.parentElement, i = 0; e && i < 4; e = e.parentElement, i++) {
        const v = e.querySelector('[class*=singleValue], [class*=single-value], [class*=selected-value], [class*=chip]');
        if (v) return v.textContent.trim();
      }
      return '';
    }
    const t = tekstZonder(el, isPlaatshouder).replace(/[\s​]+/g, ' ').trim();
    return PLAATSHOUDER.test(plat(t)) ? '' : t;
  }

  // Een keuzelijst op "Onbekend" of "Maak een keuze" telt als leeg.
  function heeftWaarde(item) {
    const el = item.el;
    if (item.soort === 'radio' || item.soort === 'knoppen') return item.rondjes.some(isGekozen);
    if (item.soort === 'tekstvak') return !!el.textContent.trim();
    if (item.soort === 'keuze') return !!huidigeKeuze(item);
    if (el.tagName === 'SELECT') {
      const t = plat(el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '');
      return !!el.value && !/^(onbekend|kies|selecteer|select|maak een keuze|geen)/.test(t) && t !== '';
    }
    return !!el.value;
  }

  function markeer(el) {
    if (!el || !el.style) return;
    el.style.outline = '2px solid #f5b400';
    el.style.backgroundColor = '#fff8e1';
  }

  function naamVan(item) {
    const n = String(item.info.label || item.info.ariaLabel || item.info.placeholder || item.info.name || item.info.id || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (n) return n;
    // Geen label, naam of id: zeg wat voor veld het is en waar het staat, zodat HR het op de pagina terugvindt.
    const soort = { select: 'keuzelijst', keuze: 'keuzelijst', textarea: 'tekstvak', radio: 'keuzerondjes', knoppen: 'knoppen', date: 'datumveld' }[item.info.type] || 'vakje';
    return '(' + soort + ' zonder label' + (item.info.na ? ', na "' + String(item.info.na).slice(0, 25) + '"' : '') + ')';
  }

  // ---- Klikken en toetsen zonder iets te versturen ----

  // Een <button> zonder type in een formulier is een verzendknop. Tijdens onze klik zetten we hem even op type=button.
  function veiligKlik(el) {
    const knop = el.closest && el.closest('button');
    const wasType = knop && knop.form && knop.type === 'submit' ? knop.getAttribute('type') : undefined;
    if (wasType !== undefined) knop.setAttribute('type', 'button');
    try {
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    } finally {
      if (wasType !== undefined) { if (wasType === null) knop.removeAttribute('type'); else knop.setAttribute('type', wasType); }
    }
  }

  function muis(el, metKlik) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const pointer = Object.assign({ pointerType: 'mouse', isPrimary: true, pointerId: 1 }, opt);
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    // Zoals de browser: alleen focus als de pagina de mousedown niet tegenhoudt (React-Select houdt zo de lijst open).
    if (el.dispatchEvent(new MouseEvent('mousedown', opt)) && el.focus) el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, pointer, { buttons: 0 })));
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opt, { buttons: 0 })));
    if (metKlik) veiligKlik(el);
  }

  // Nagemaakte toetsen hebben geen standaardactie: een Enter verstuurt dus nooit een formulier.
  function toets(el, key, extra) {
    const opt = Object.assign({ key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, composed: true }, extra || {});
    el.dispatchEvent(new KeyboardEvent('keydown', opt));
    el.dispatchEvent(new KeyboardEvent('keyup', opt));
  }

  // Tijdens het vullen wordt elk verzendverzoek op de pagina tegengehouden (vangnet naast veiligKlik).
  function blokkeerVersturen() {
    const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
    root.addEventListener('submit', stop, true);
    return () => root.removeEventListener('submit', stop, true);
  }

  // ---- Zelfgebouwde keuzelijsten ----

  const OPTIE = '[role=option], [role=menuitem], [role=menuitemradio], mat-option, .select2-results__option, [id*="-option-"], [class*="__option"], li[class*=option], [class*="-option"]';

  // De zichtbare opties op de pagina, alleen de binnenste (geen lijst die zelf weer opties bevat).
  // Echte ARIA-opties gaan voor op een gok op klassenaam; opties zonder tekst (een ripple-effect in een optie) tellen niet.
  const OPTIE_STERK = '[role=option], [role=menuitem], [role=menuitemradio], mat-option, .select2-results__option';
  function kiesOpties(lijst) {
    lijst = lijst.filter(o => o.textContent.trim() || o.getAttribute('aria-label'));
    const sterk = lijst.filter(o => o.matches(OPTIE_STERK));
    if (sterk.length) lijst = sterk;
    return lijst.filter(o => !lijst.some(x => x !== o && o.contains(x)));
  }

  function zichtbareOpties() {
    return kiesOpties(alle(document, el => el.matches(OPTIE) && isZichtbaar(el) && !dichtbij(el, '[data-adressenboekje]')));
  }

  // Opties die bij deze keuzelijst horen: nieuw zichtbaar sinds het openen, of in de lijst waar hij naar verwijst.
  function optiesVan(el, voor) {
    const nieuw = zichtbareOpties().filter(o => !voor.has(o));
    if (nieuw.length) return nieuw;
    const ids = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    const lijsten = ids.map(id => zoekId(el, id)).filter(Boolean);
    if (el.getAttribute('role') === 'listbox') lijsten.push(el);
    return kiesOpties(lijsten.flatMap(l => alle(l, x => x.matches(OPTIE) && isZichtbaar(x))));
  }

  async function wachtTot(fn, ms) {
    const eind = Date.now() + ms;
    let uit = fn();
    while (!(uit && (uit.length === undefined || uit.length)) && Date.now() < eind) { await wacht(50); uit = fn(); }
    return uit;
  }

  // Openen: eerst muis omlaag/omhoog (React-Select, MUI, Select2), dan een klik (Angular Material, Headless UI),
  // dan het toetsenbord. Na elke poging kijken of er opties verschenen; nooit twee keer hetzelfde, anders klapt hij weer dicht.
  async function openLijst(el, voor) {
    if (el.getAttribute('role') === 'listbox') { const o = optiesVan(el, voor); if (o.length) return o; }
    const pogingen = [
      () => muis(el, false),
      () => veiligKlik(el),
      () => toets(el, 'ArrowDown'),
      () => toets(el, 'ArrowDown', { altKey: true }),
      () => { if (el.tagName !== 'INPUT') toets(el, ' '); },
    ];
    for (const poging of pogingen) {
      if (el.getAttribute('aria-expanded') === 'true') { const o = await wachtTot(() => optiesVan(el, voor), 300); if (o.length) return o; }
      poging();
      const o = await wachtTot(() => optiesVan(el, voor), 600);
      if (o.length) return o;
    }
    return [];
  }

  function sluitLijst(el) {
    if (el.getAttribute('aria-expanded') === 'true') toets(el, 'Escape');
    const actief = document.activeElement;
    if (actief && actief !== document.body && actief.getAttribute && actief.getAttribute('aria-expanded') === 'true') toets(actief, 'Escape');
  }

  // Select2, Chosen en dergelijke houden een verborgen <select> bij; die zetten is het betrouwbaarst.
  function verborgenSelect(el) {
    const c = el.closest('.select2-container, .chosen-container');
    const s = c && c.previousElementSibling;
    return s && s.tagName === 'SELECT' ? s : null;
  }

  // Een invoerveld om in te typen: het veld zelf, of een zoekvak dat bij het openen verscheen (Select2).
  function zoekvak(el) {
    if (el.tagName === 'INPUT') return el;
    const binnen = el.querySelector && el.querySelector('input:not([type=hidden])');
    if (binnen) return binnen;
    const a = document.activeElement;
    return a && a.tagName === 'INPUT' && a !== el && isZichtbaar(a) ? a : null;
  }

  // Laat de keuzelijst nu zien wat we kozen? Kijkt naar het veld en tot drie lagen erboven.
  function toontKeuze(item, optieTekst) {
    const doel = plat(optieTekst);
    if (!doel) return false;
    const el = item.el;
    if (el.tagName === 'INPUT' && plat(el.value) === doel) return true;
    const s = verborgenSelect(el);
    if (s && s.options[s.selectedIndex] && plat(s.options[s.selectedIndex].text) === doel) return true;
    for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) {
      const t = plat(tekstZonder(e, c => c.matches('[role=listbox], [role=option], [aria-hidden=true]') && !c.contains(el)));
      if (t.length > 200) break;
      if ((' ' + t + ' ').includes(' ' + doel + ' ')) return true;
    }
    return false;
  }

  // Vult een zelfgebouwde keuzelijst. Geeft { ok, optieTekst } of { reden }.
  async function vulKeuze(item, score, waarde) {
    const el = item.el;
    const oud = el.tagName === 'INPUT' ? el.value : null;
    const sel = verborgenSelect(el);
    if (sel) {
      const v = kiesOptie(sel, score);
      if (v != null) {
        zetWaarde(sel, v);
        await wacht(80);
        const tekst = sel.options[sel.selectedIndex].text;
        if (toontKeuze(item, tekst)) return { ok: true, optieTekst: tekst };
      }
    }
    const voor = new Set(zichtbareOpties());
    let opties = await openLijst(el, voor);
    const optieScore = o => o.getAttribute('aria-disabled') === 'true' ? 0 : score(o.getAttribute('aria-label') || o.textContent, o.getAttribute('data-value') || '');
    let optie = beste(opties, optieScore);
    const eerder = opties.map(o => o.getAttribute('aria-label') || o.textContent);
    // Lange lijsten (landen) laden pas de juiste optie na typen; een vrij tekstveld met suggesties ook.
    const vak = !optie && zoekvak(el);
    if (vak) {
      await typ(vak, waarde);
      opties = await wachtTot(() => optiesVan(el, voor), 800);
      optie = beste(opties, optieScore);
    }
    if (!optie) {
      sluitLijst(el);
      // Een invoerveld zonder passende suggestie mag de getypte tekst houden (bijvoorbeeld plaats met suggesties).
      // Behalve bij dienstverband: daar telt alleen een echte keuze.
      if (el.tagName === 'INPUT') {
        await wacht(150);
        if (klopt(el.value, waarde) && String(item.sleutel).split('.')[0] !== 'dienstverband') return { ok: true, optieTekst: waarde };
        // Nooit getypte zoektekst laten staan: terug naar wat er stond.
        if (el.value !== oud) zetWaarde(el, oud);
      }
      return { reden: opties.length || eerder.length ? `geen passende keuze in de lijst (gezocht: ${waarde}${optieLijst(eerder.length ? eerder : opties.map(o => o.textContent))})` : 'de keuzelijst ging niet open' };
    }
    const tekst = (optie.getAttribute('aria-label') || optie.textContent).trim();
    muis(optie, true);
    await wacht(120);
    sluitLijst(el);
    return { ok: true, optieTekst: tekst };
  }

  // ---- contenteditable ----

  async function vulTekstvak(el, waarde) {
    el.focus();
    const r = el.getRootNode();
    const sel = (r.getSelection && r.getSelection()) || document.getSelection();
    try { sel.selectAllChildren(el); } catch (e) { /* geen selectie mogelijk */ }
    const gelukt = document.execCommand && document.execCommand('insertText', false, waarde);
    if (!gelukt || plat(el.textContent) !== plat(waarde)) {
      el.textContent = waarde;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: waarde }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.blur();
  }

  // ---- Velden die later verschijnen ----

  // Wacht tot er velden staan (formulier laadt nog), hooguit `ms`. In iframes niet wachten: daar staat vaak niets.
  async function wachtOpVelden(fn, ms) {
    const binnenFrame = root.top !== root;
    let uit = fn();
    if (uit.length || binnenFrame) return uit;
    const eind = Date.now() + ms;
    while (!uit.length && Date.now() < eind) { await wacht(150); uit = fn(); }
    if (uit.length) { await wacht(200); uit = fn(); }
    return uit;
  }

  // Wacht tot de pagina klaar is met opbouwen (HRSuite bouwt het scherm pas na laden op met JavaScript):
  // klaar = er is iets gevonden én er is `rust` ms niets meer veranderd (MutationObserver, plus tellen voor shadow DOM,
  // dat de observer niet ziet). Hooguit `max` ms. tel() geeft een getal (hoeveel bruikbaars er nu staat).
  function wachtOpStabiel(tel, opties) {
    const o = Object.assign({ max: 5000, rust: 600, stap: 250 }, opties || {});
    return new Promise(klaar => {
      const begin = Date.now();
      let laatste = begin, n = tel(), stop = false;
      const obs = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { laatste = Date.now(); }) : null;
      if (obs) obs.observe(document, { subtree: true, childList: true, characterData: true });
      const t = setInterval(() => {
        if (stop) return;
        const nu = tel();
        if (nu !== n) { n = nu; laatste = Date.now(); }
        const stil = Date.now() - laatste >= o.rust;
        if ((n > 0 && stil) || Date.now() - begin >= o.max) {
          stop = true;
          clearInterval(t);
          if (obs) obs.disconnect();
          klaar({ gewacht: Date.now() - begin, stil, aantal: n });
        }
      }, o.stap);
    });
  }

  // ---- Vullen ----

  // Vult één veld. Geeft { ok, verwacht, optieTekst, rondje } of { reden } (in gewoon Nederlands).
  async function vulItem(item, s, waarde) {
    const el = item.el;
    const score = scoorder(s, waarde);
    if (item.soort === 'radio' || item.soort === 'knoppen') {
      const rondje = kiesRondje(item.rondjes, score);
      if (!rondje) return { reden: `geen passende keuze (gezocht: ${waarde}${optieLijst(item.rondjes.map(knopTekst))})` };
      if (!isGekozen(rondje)) veiligKlik(rondje);
      markeer(rondje.tagName === 'INPUT' ? rondje.closest('label') || rondje : rondje);
      return { ok: true, rondje };
    }
    if (item.soort === 'tekstvak') {
      await vulTekstvak(el, waarde);
      markeer(el);
      return plat(el.textContent) === plat(waarde) ? { ok: true, verwacht: waarde } : { reden: 'het tekstvak nam de tekst niet aan' };
    }
    if (item.soort === 'keuze') {
      const uit = await vulKeuze(item, score, waarde);
      if (uit.ok) markeer(el);
      return uit;
    }
    if (el.tagName === 'SELECT') {
      const v = kiesOptie(el, score);
      if (v == null) return { reden: `geen passende keuze in de lijst (gezocht: ${waarde}${optieLijst(Array.from(el.options).filter(o => o.value !== '').map(o => o.text))})` };
      zetWaarde(el, v);
      markeer(el);
      return { ok: true, verwacht: v };
    }
    let w = waarde;
    const max = el.maxLength;
    if (max > 0 && w.length > max) {
      const kort = varianten(w).find(v => v.length <= max);
      if (!kort) return { reden: `past niet: het veld neemt maximaal ${max} tekens (nodig: ${w.length})` };
      w = kort;
    }
    const oud = el.value;
    zetWaarde(el, w);
    // Een invoermasker gooit een in één keer gezette waarde soms weg: dan typen we hem.
    if (!klopt(el.value, w)) await typ(el, w);
    if (!klopt(el.value, w)) {
      const nu = el.value;
      // Nooit een halve of veranderde waarde laten staan: terug naar wat er stond (meestal leeg).
      if (nu !== oud) { zetWaarde(el, oud); if (!klopt(el.value, oud) && oud === '') { try { await typ(el, ''); } catch (e) { /* laat zo */ } } }
      el.blur();
      const terug = el.value === oud ? (oud ? ' (oude waarde teruggezet)' : ' (veld weer leeg gemaakt)') : ' (terugzetten lukte niet: controleer dit veld)';
      return { reden: (nu ? `het veld veranderde de waarde in "${nu}"` : 'het veld nam de waarde niet aan') + (nu && nu !== oud ? terug : '') };
    }
    if (el.ownerDocument.activeElement === el || (el.getRootNode().activeElement === el)) el.blur();
    markeer(el);
    return { ok: true, verwacht: w };
  }

  // Staat het er na het vullen nog? Frameworks zetten een waarde soms terug als hun eigen toestand niet meeveranderde.
  function nogGoed(item, uit) {
    const el = item.el;
    if (uit.rondje) return isGekozen(uit.rondje);
    if (item.soort === 'tekstvak') return plat(el.textContent) === plat(uit.verwacht);
    if (item.soort === 'keuze') return toontKeuze(item, uit.optieTekst);
    if (el.tagName === 'SELECT') return el.value === uit.verwacht;
    return klopt(el.value, uit.verwacht);
  }

  // Staat de juiste waarde er al? (Dan hoeft er niets te gebeuren; staat er iets anders, dan melden we dat.)
  function staatErAl(item, s, waarde) {
    const el = item.el;
    const score = scoorder(s, waarde);
    if (item.soort === 'radio' || item.soort === 'knoppen') { const r = kiesRondje(item.rondjes, score); return !!r && isGekozen(r); }
    if (item.soort === 'tekstvak') return plat(el.textContent) === plat(waarde);
    if (item.soort === 'keuze') { const nu = huidigeKeuze(item); return !!nu && (score(nu, '') >= 1 || klopt(nu, waarde)); }
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return !!o && score(o.text, o.value) >= 1; }
    return klopt(el.value, waarde);
  }

  function markeerFout(el) {
    if (!el || !el.style) return;
    el.style.outline = '2px solid #c0392b';
    el.style.backgroundColor = '#fdecea';
  }

  // Het portaal met de instellingen die HR of de beheerder per portaal koos (salaris per maand/jaar, decimaalteken).
  function portaalMetInstellingen(id, instellingen) {
    const portalen = root.AdressenboekjePortalen;
    const basis = id && portalen ? (portalen.portaal ? portalen.portaal(id) : portalen.PORTALEN[id]) : null;
    if (!basis) return null;
    const extra = {};
    for (const [k, v] of Object.entries(instellingen || {})) if (v) extra[k] = v;
    return Object.assign({}, basis, extra);
  }

  // opties: { portaal: id, koppelingen: [...geleerd], overschrijven, wachten (standaard aan), instellingen: { salarisEenheid, getalNotatie } }
  // Rapport per veld (v0.6): rapport.velden = [{ naam, status: ingevuld | mislukt | niet gevonden | overgeslagen | leeg | niet herkend, reden, sleutel }].
  // De oude lijsten (ingevuld, mislukt, ...) blijven voor de popup en de bookmarklet.
  async function vul(profiel, opties) {
    const m = M();
    const o = opties || {};
    const portaal = portaalMetInstellingen(o.portaal, o.instellingen);
    const vast = portaal ? portaal.koppelingen || [] : [];
    const koppelingen = (o.koppelingen || []).concat(vast);
    const rapport = { ingevuld: [], leeg: [], ontbreekt: [], overgeslagen: [], onbekend: [], controle: [], mislukt: [], velden: [] };
    const veld = (naam, status, reden, sleutel) => rapport.velden.push({ naam, status, reden: reden || '', sleutel: sleutel || '' });
    const zoek = () => analyse({ portaal, koppelingen, metGeblokkeerd: true });
    const behandeld = new Set();
    const gebruikt = new Set();
    const vrij = blokkeerVersturen();
    try {
      let items = o.wachten === false ? zoek() : await wachtOpVelden(zoek, 3000);
      // Een keuze kan nieuwe velden tonen ("Partner: ja"): daarom tot drie rondes, elke keer alleen de nieuwe velden.
      for (let ronde = 0; ronde < 3 && items.length; ronde++) {
        const gedaan = [];
        for (const item of items) {
          behandeld.add(item.el);
          (item.rondjes || []).forEach(r => behandeld.add(r));
          for (const k of vast) if (!gebruikt.has(k) && m.zoekKoppeling([k], item.vingerafdruk)) gebruikt.add(k);
          // Na de eerste ronde alleen echt nieuwe, lege velden (een opnieuw getekend veld met waarde laten we staan).
          if (ronde > 0 && heeftWaarde(item)) continue;
          const naam = naamVan(item);
          const s = item.sleutel;
          if (!s) { rapport.onbekend.push(naam); veld(naam, 'niet herkend', 'de extensie weet niet wat hierin hoort; vul zelf in of koppel het veld'); continue; }
          if (s === 'overslaan') {
            const reden = item.reden || (item.bron === 'geleerd' ? 'bij het koppelen op "niet invullen" gezet' : 'niet invullen');
            rapport.overgeslagen.push(naam + ' (' + reden + ')');
            veld(naam, 'overgeslagen', reden, s);
            continue;
          }
          const basis = s.split('.')[0];
          if (s === 'leeg' || m.LEEG.includes(basis)) { rapport.leeg.push(naam); veld(naam, 'leeg', 'afspraak: leeg laten', s); continue; }
          if (s === 'bedrijf') { rapport.overgeslagen.push(naam + ' (bedrijfsnaam)'); veld(naam, 'overgeslagen', 'bedrijfsnaam', s); continue; }

          const waarde = s === 'telefoonOfMobiel'
            ? m.waardeVoor('mobiel', profiel, item.info, portaal) || m.waardeVoor('telefoon', profiel, item.info, portaal)
            : m.waardeVoor(s, profiel, item.info, portaal);
          if (!waarde) {
            const reden = m.ontbreektReden ? m.ontbreektReden(s, profiel) : 'geen gegeven op het tabje HRSuite';
            rapport.ontbreekt.push(naam + (reden === 'geen gegeven op het tabje HRSuite' ? '' : ' (' + reden + ')'));
            veld(naam, 'niet gevonden', reden, s);
            continue;
          }
          if (item.geblokkeerd) {
            const nu = item.el.value != null ? item.el.value : item.el.textContent;
            if (!klopt(nu, waarde)) {
              rapport.mislukt.push(naam + ': het veld staat uit of is alleen-lezen, de pagina laat invullen niet toe');
              veld(naam, 'mislukt', 'het veld staat uit of is alleen-lezen', s);
            } else veld(naam, 'ingevuld', 'stond er al (veld is alleen-lezen)', s);
            continue;
          }
          if (heeftWaarde(item) && !o.overschrijven) {
            if (staatErAl(item, s, waarde)) {
              rapport.overgeslagen.push(naam + ' (had al een waarde, die klopt)');
              veld(naam, 'ingevuld', 'stond er al goed', s);
            } else {
              // Nooit stil een andere waarde laten staan: melden en rood markeren.
              const nu = String(waardeVan(item) || '').trim().slice(0, 40);
              rapport.mislukt.push(naam + `: had al een andere waarde ("${nu}"), niet overschreven. Controleer, of vink onder Meer overschrijven aan`);
              veld(naam, 'mislukt', `had al een andere waarde ("${nu}")`, s);
              markeerFout(item.rondjes ? item.rondjes[0] : item.el);
            }
            continue;
          }

          let uit;
          try { uit = await vulItem(item, s, waarde); } catch (e) { uit = { reden: 'onverwachte fout (' + String(e && e.message || e).slice(0, 60) + ')' }; }
          if (!uit.ok) {
            rapport.mislukt.push(naam + ': ' + uit.reden);
            veld(naam, 'mislukt', uit.reden, s);
            markeerFout(item.rondjes ? item.rondjes[0] : item.el);
            continue;
          }
          const om = m.salarisOmrekening ? m.salarisOmrekening(s, portaal) : null;
          const regel = naam + ' ← ' + (m.labelVoor ? m.labelVoor(s) : s) + (om && om.uitleg ? ' (' + om.uitleg + ')' : '') + (item.bron === 'geleerd' ? ' (gekoppeld)' : '');
          rapport.ingevuld.push(regel);
          const v = { naam, status: 'ingevuld', reden: om && om.uitleg ? om.uitleg : '', sleutel: s };
          rapport.velden.push(v);
          gedaan.push({ item, uit, naam, regel, v });
        }
        if (!gedaan.length) break;
        // Controle: elke waarde teruglezen, even na het vullen.
        await wacht(o.wachten === false ? 50 : 250);
        for (const g of gedaan) {
          if (nogGoed(g.item, g.uit)) continue;
          rapport.ingevuld.splice(rapport.ingevuld.indexOf(g.regel), 1);
          const reden = g.item.soort === 'keuze' ? 'de keuze bleef niet staan' : 'de waarde bleef niet staan (de pagina zette hem terug)';
          rapport.mislukt.push(g.naam + ': ' + reden);
          g.v.status = 'mislukt';
          g.v.reden = reden;
          markeerFout(g.item.el);
        }
        if (o.wachten === false) break;
        await wacht(300);
        items = zoek().filter(it => !behandeld.has(it.el));
      }
    } finally {
      vrij();
    }
    // Vaste koppelingen (portalen.js) die op deze pagina niet terugkwamen: de pagina is mogelijk veranderd.
    // Alleen als minstens één vaste koppeling wel paste (anders is dit gewoon een andere pagina van het portaal).
    if (vast.some(k => gebruikt.has(k))) {
      for (const k of vast) {
        if (gebruikt.has(k) || ['overslaan', 'leeg'].includes(k.sleutel)) continue;
        const naam = (k.veld.label || '(zonder label, ' + k.veld.nr + 'e)') + ' ← ' + (m.labelVoor ? m.labelVoor(k.sleutel) : k.sleutel);
        rapport.ontbreekt.push(naam + ' (veld niet gevonden op de pagina)');
        veld(naam, 'niet gevonden', 'vaste koppeling: dit veld staat niet (meer) op de pagina', k.sleutel);
      }
    }
    if (portaal && rapport.ingevuld.length) rapport.controle.push(...portaal.controle);
    return rapport;
  }

  // ---- Lezen (tabje HRSuite) ----

  function waardeVan(item) {
    const el = item.el;
    if (item.soort === 'radio' || item.soort === 'knoppen') {
      const r = item.rondjes.find(x => isGekozen(x) || x.hasAttribute('checked'));
      return r ? (knopTekst(r) || r.value || '') : '';
    }
    if (item.soort === 'keuze') return huidigeKeuze(item);
    if (item.soort === 'tekstvak') return el.textContent || '';
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      return o && o.value !== '' ? o.text : '';
    }
    return el.value || el.getAttribute('value') || el.textContent || '';
  }

  function tekst(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Schermen die alleen tonen: "Achternaam  Persoon" als label met een waarde ernaast,
  // in een tabelrij, een <dt>/<dd> of twee blokjes naast elkaar. Alleen paren waarvan het label iets zegt.
  // Zoekt ook in webcomponenten.
  // v0.6: ook label/waarde via aria-labelledby en aria-label, <label for> naar een tekst, een tabel met kopregel
  // en één rij, en "Label: waarde" in één blokje. Nooit via CSS-klassen (die maakt HRSuite per keer opnieuw).
  // Geeft [{ label, el, waarde, hoe }]; `hoe` zegt in de diagnose hoe het paar gevonden is.
  function tekstParen(doc, zichtbaar) {
    const paren = [];
    const gezien = new Set();
    const voeg = (labelBron, waardeEl, hoe, waardeTekst) => {
      if (!waardeEl || gezien.has(waardeEl) || waardeEl.matches('input, select, textarea, button, option, script, style') || waardeEl.querySelector('input, select, textarea, button')) return;
      if (dichtbij(waardeEl, '[data-adressenboekje]')) return;
      const label = typeof labelBron === 'string' ? labelBron.replace(/\s+/g, ' ').trim() : tekst(labelBron);
      const waarde = waardeTekst != null ? waardeTekst.trim() : tekst(waardeEl);
      if (!label || !waarde || label.length > 50 || waarde.length > 120 || !zichtbaar(waardeEl)) return;
      if (M().normaliseer(label) === M().normaliseer(waarde)) return;
      gezien.add(waardeEl);
      paren.push({ el: waardeEl, label, waarde, hoe });
    };
    const els = alle(doc, () => true);
    const isVeld = el => isNative(el) || !!soortVan(el);
    els.forEach(dt => { if (dt.tagName === 'DT' && dt.nextElementSibling && dt.nextElementSibling.tagName === 'DD') voeg(dt, dt.nextElementSibling, 'dt/dd'); });
    els.forEach(tr => { if (tr.tagName === 'TR' && tr.children.length === 2) voeg(tr.children[0], tr.children[1], 'tabelrij'); });
    // Tabel met een kopregel en precies één gegevensrij: de kop is het label van de cel eronder.
    els.forEach(tabel => {
      if (tabel.tagName !== 'TABLE') return;
      const kopRij = tabel.querySelector('thead tr') || tabel.querySelector('tr');
      const koppen = kopRij ? Array.from(kopRij.children).filter(c => c.tagName === 'TH') : [];
      if (koppen.length < 2) return;
      const rijen = Array.from(tabel.querySelectorAll('tr')).filter(tr => tr !== kopRij && !tr.querySelector('th'));
      if (rijen.length !== 1) return;
      Array.from(rijen[0].children).forEach((td, i) => { if (koppen[i]) voeg(koppen[i], td, 'tabelkop'); });
    });
    // aria-labelledby op iets dat geen invoerveld is (<div role="textbox" aria-readonly="true" aria-labelledby="l1">).
    els.forEach(el => {
      const ids = el.getAttribute('aria-labelledby');
      if (!ids || isVeld(el)) return;
      const l = ids.split(/\s+/).map(id => id && zoekId(el, id)).find(x => x && x !== el && !x.contains(el) && !el.contains(x));
      if (l) voeg(l, el, 'aria-labelledby');
    });
    // <label for="x"> bij een tekst in plaats van een veld.
    els.forEach(l => {
      if (l.tagName !== 'LABEL' || !l.htmlFor) return;
      const doel = zoekId(l, l.htmlFor);
      if (doel && !isVeld(doel)) voeg(l, doel, 'label for');
    });
    // aria-label op een blokje met tekst (<span aria-label="Achternaam">Persoon</span>).
    els.forEach(el => {
      const a = el.getAttribute('aria-label');
      if (!a || isVeld(el) || el.children.length > 1 || /^(BUTTON|A|NAV|SECTION|FORM|MAIN|HEADER|FOOTER|DIALOG)$/.test(el.tagName)) return;
      voeg(a, el, 'aria-label');
    });
    // "Achternaam: Persoon" in één blokje.
    els.forEach(el => {
      if (el.children.length || !/^(SPAN|DIV|P|LI|TD|DD)$/.test(el.tagName)) return;
      const m = tekst(el).match(/^([^:]{2,40}):\s+(.{1,120})$/);
      if (m) voeg(m[1], el, 'label: waarde', m[2]);
    });
    els.forEach(el => {
      if (!/^(LABEL|SPAN|DIV|P|STRONG|B|TH|TD|DT)$/.test(el.tagName) || el.children.length > 1 || dichtbij(el, '[data-adressenboekje]')) return;
      // Een blokje dat al als waarde of als "Label: waarde" gebruikt is, is geen label voor het volgende.
      if (gezien.has(el)) return;
      const t = tekst(el);
      if (!t || t.length > 50) return;
      // Twee kopjes naast elkaar in een tabel zijn geen label en waarde.
      if (el.nextElementSibling && el.nextElementSibling.tagName === 'TH') return;
      voeg(el, el.nextElementSibling, 'naast elkaar');
    });
    return paren;
  }

  // ---- HRSuite: gegevens uit het script van de pagina (zie matcher.leesHrSuiteScript) ----
  let scriptCache = { sleutel: '', kolommen: [] };
  function scriptKolommen(doc) {
    const m = M();
    if (!m.leesHrSuiteScript) return [];
    const teksten = Array.from((doc || document).querySelectorAll('script')).map(s => s.textContent || '').filter(t => t.includes('DefineDataField'));
    const sleutel = teksten.length + ':' + teksten.reduce((n, t) => n + t.length, 0);
    if (sleutel !== scriptCache.sleutel || doc !== scriptCache.doc) scriptCache = { sleutel, doc, kolommen: teksten.length ? m.leesHrSuiteScript(teksten.join('\n')) : [] };
    return scriptCache.kolommen;
  }

  // Rijen uit het script: eerst de bekende HRSuite-Id's (vaste volgorde, zodat bijvoorbeeld mobiel werk voor mobiel privé gaat),
  // dan wat aan het label herkend wordt. alles = ook kolommen zonder herkend gegeven (diagnose).
  function scriptRijen(doc, koppelingen, alles) {
    const m = M();
    const ids = Object.keys(m.HRSUITE_IDS || {});
    const rijen = [];
    for (const k of scriptKolommen(doc)) {
      if (!k.waarde && !alles) continue;
      const vingerafdruk = { id: 'hrsuite:' + k.id, name: k.id, label: m.normaliseer(k.label).slice(0, 60), nr: 1, type: 'hrsuitedata' };
      const geleerd = m.zoekKoppeling(koppelingen, vingerafdruk);
      const vast = m.HRSUITE_IDS[k.id];
      const sleutel = geleerd ? geleerd.sleutel : vast || m.herken({ label: k.label });
      if (!sleutel && !alles) continue;
      rijen.push({
        vingerafdruk, naam: (k.label || '(geen label)').slice(0, 30) + ' [' + k.id + ']', sleutel: sleutel || null,
        bron: geleerd ? 'geleerd' : vast ? 'hrsuite-id' : sleutel ? 'regel' : null, waarde: k.waarde, waar: 'script', zichtbaar: k.zichtbaar,
        volgorde: geleerd || vast ? (vast ? ids.indexOf(k.id) : -1) : 1000,
      });
    }
    return rijen.sort((a, b) => a.volgorde - b.volgorde);
  }

  // Leest een scherm (live of geplakt) en geeft per veld wat er staat en welk gegeven het is.
  // opties: { doc, koppelingen, alles (diagnose: ook wat niet herkend is) }.
  // Geeft [{ vingerafdruk, naam, sleutel, bron, waarde, waar }]. Volgorde = voorrang (de eerste waarde per gegeven wint):
  // gekoppelde en bekende HRSuite-Id's uit het script, dan het scherm, dan script-velden die alleen aan hun label herkend zijn.
  function lees(opties) {
    const m = M();
    const o = opties || {};
    const doc = o.doc || document;
    const koppelingen = o.koppelingen || [];
    const zichtbaar = o.doc && !o.doc.defaultView ? nietVerborgen : isZichtbaar;
    const script = scriptRijen(doc, koppelingen, o.alles);
    const scherm = analyse({ doc: o.doc, koppelingen, ookAlleenLezen: true }).map(item => ({
      vingerafdruk: item.vingerafdruk, naam: naamVan(item), sleutel: item.sleutel, bron: item.bron, waarde: waardeVan(item).trim(), waar: 'veld',
    }));
    const tellers = {};
    for (const paar of tekstParen(doc, zichtbaar)) {
      const label = m.normaliseer(paar.label).slice(0, 60);
      tellers[label] = (tellers[label] || 0) + 1;
      const vingerafdruk = { id: (m.stabielId ? m.stabielId(paar.el.id) : paar.el.id) || '', name: '', label, nr: tellers[label], type: 'tekst' };
      const geleerd = m.zoekKoppeling(koppelingen, vingerafdruk);
      const sleutel = geleerd ? geleerd.sleutel : m.herken({ label: paar.label });
      // Een tekstpaar zonder herkenbaar label is meestal kopje of uitleg: alleen tonen als het gekoppeld is (of in de diagnose).
      if (!sleutel && !o.alles) continue;
      scherm.push({ vingerafdruk, naam: paar.label.replace(/:\s*$/, '').slice(0, 40), sleutel: sleutel || null, bron: geleerd ? 'geleerd' : sleutel ? 'regel' : null, waarde: paar.waarde, waar: 'tekst (' + paar.hoe + ')' });
    }
    return script.filter(r => r.volgorde < 1000).concat(scherm, script.filter(r => r.volgorde >= 1000)).map(r => { delete r.volgorde; return r; });
  }

  // Live lezen: wacht tot het scherm klaar is met opbouwen. In een iframe korter als daar niets staat.
  async function leesLive(opties) {
    const tel = () => lees(opties).filter(r => r.sleutel && r.waarde).length;
    const binnenFrame = root.top !== root;
    // rust 1 s: HRSuite bouwt het scherm in golven op; tussen twee golven zit vaak een halve seconde of meer.
    const w = await wachtOpStabiel(tel, { max: binnenFrame && !tel() ? 1500 : 6000, rust: 1000 });
    const rijen = lees(opties);
    if (rijen.length) rijen[0].wacht = w;
    return rijen;
  }

  // ---- Diagnose: per gevonden label/waarde wat de extensie herkende en waarom (niet) ----
  // modus 'hrsuite': alles wat lezen ziet, ook wat niet herkend is. modus 'portaal': elk invulveld met wat erin zou komen.
  // Er gaat niets de deur uit: dit leest alleen de pagina die al open staat.
  async function diagnose(opties) {
    const m = M();
    const o = opties || {};
    const binnenFrame = root.top !== root;
    const telVelden = () => alle(document, el => isNative(el) || !!soortVan(el)).length + tekstParen(document, isZichtbaar).length + scriptKolommen(document).length;
    const w = await wachtOpStabiel(telVelden, { max: binnenFrame && !telVelden() ? 1000 : (o.max || 4000), rust: 500 });
    let shadow = 0, verborgen = 0;
    const iframes = [];
    doorloop(document, el => {
      if (el.shadowRoot) shadow++;
      if (isNative(el) && (el.type === 'hidden' || !isZichtbaar(el))) verborgen++;
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let ander = true;
        try { ander = !el.contentDocument; } catch (e) { ander = true; }
        iframes.push(ander ? 'andere site of nog niet geladen' : 'zelfde site');
      }
    });
    const kolommen = scriptKolommen(document);
    const info = {
      frame: location.host + location.pathname.slice(0, 60), hoofdframe: !binnenFrame, modus: o.modus || 'hrsuite',
      gewacht: w.gewacht, stil: w.stil,
      tellingen: {
        invoervelden: alle(document, el => isNative(el)).length, zichtbareVelden: analyse({ ookAlleenLezen: true, metGeblokkeerd: true }).length,
        verborgenVelden: verborgen, shadowRoots: shadow, iframes: iframes.length, iframesAndereSite: iframes.filter(x => x !== 'zelfde site').length,
        scriptsMetHrSuiteData: Array.from(document.querySelectorAll('script')).filter(s => (s.textContent || '').includes('DefineDataField')).length,
        scriptVelden: kolommen.length, scriptVeldenMetWaarde: kolommen.filter(k => k.waarde).length,
      },
      rijen: [],
    };
    if (o.modus === 'portaal') {
      const portaal = portaalMetInstellingen(o.portaal, o.instellingen);
      const koppelingen = (o.koppelingen || []).concat(portaal ? portaal.koppelingen || [] : []);
      for (const item of analyse({ portaal, koppelingen, metGeblokkeerd: true })) {
        const s = item.sleutel;
        let invullen = '', reden;
        if (!s) reden = 'niet herkend: label zegt de extensie niets';
        else if (s === 'overslaan') reden = item.reden || 'niet invullen (zo gekoppeld)';
        else if (s === 'leeg' || m.LEEG.includes(s.split('.')[0])) reden = 'leeg laten (afspraak)';
        else {
          invullen = s === 'telefoonOfMobiel' ? m.waardeVoor('mobiel', o.profiel || {}, item.info, portaal) || m.waardeVoor('telefoon', o.profiel || {}, item.info, portaal) : m.waardeVoor(s, o.profiel || {}, item.info, portaal);
          reden = (item.bron === 'geleerd' ? (item.koppeling && portaal && (portaal.koppelingen || []).includes(item.koppeling) ? 'vaste koppeling (portalen.js)' : 'gekoppeld door HR') : 'herkend aan ' + (item.info.label ? 'het label' : 'naam/id/placeholder'))
            + (invullen ? '' : '; ' + (m.ontbreektReden ? m.ontbreektReden(s, o.profiel || {}) : 'geen gegeven'))
            + (item.geblokkeerd ? '; veld staat uit of is alleen-lezen' : '')
            + (item.koppeling && item.koppeling.controleer ? '; nog te controleren: ' + item.koppeling.controleer : '');
        }
        info.rijen.push({ waar: 'veld (' + item.info.type + ')', label: naamVan(item), id: item.vingerafdruk.id || item.vingerafdruk.name || '', waarde: String(waardeVan(item) || '').trim(), sleutel: s || '', gegeven: s ? m.labelVoor(s) : '', invullen, reden });
      }
      return info;
    }
    for (const r of lees({ koppelingen: o.koppelingen || [], alles: true })) {
      let reden;
      if (!r.sleutel) reden = r.waar === 'script' ? 'HRSuite-veld niet gebruikt (Id en label onbekend)' : 'label niet herkend';
      else if (r.sleutel === 'overslaan') reden = 'niet invullen (zo gekoppeld)';
      else {
        reden = r.bron === 'geleerd' ? 'gekoppeld door HR' : r.bron === 'hrsuite-id' ? 'bekend HRSuite-veld-Id' : 'herkend aan het label';
        if (!r.waarde) reden += '; leeg';
        else if (!m.NIET_LEZEN.includes(r.sleutel.split('.')[0])) {
          const p = m.naarProfiel([{ sleutel: r.sleutel, waarde: r.waarde, bron: r.bron }]);
          if (!Object.keys(p).length) reden += r.sleutel === 'afdeling' ? '; afdeling niet overgenomen (portalen willen Voorbeeld BV)' : '; waarde niet om te zetten (formaat onbekend)';
        } else reden += '; wordt niet overgenomen (afspraak of samengesteld)';
      }
      if (r.waar === 'script' && r.zichtbaar === false) reden += '; verborgen veld op het scherm';
      info.rijen.push({ waar: r.waar, label: r.naam, id: r.vingerafdruk.id || r.vingerafdruk.name || '', waarde: r.waarde, sleutel: r.sleutel || '', gegeven: r.sleutel ? m.labelVoor(r.sleutel) : '', reden });
    }
    return info;
  }

  // Koppelen vanaf een scherm: welke velden staan er en wat denkt de extensie dat erin hoort.
  // koppeling: plek in opties.koppelingen van de koppeling die bij dit veld hoort (-1 = geen), zodat de popup ziet of de pagina veranderd is.
  function velden(opties) {
    const lijst = (opties && opties.koppelingen) || [];
    const vast = (opties && opties.portaal && opties.portaal.koppelingen) || [];
    return analyse(opties).map(item => ({
      vingerafdruk: item.vingerafdruk, naam: naamVan(item), sleutel: item.sleutel, bron: item.bron, koppeling: lijst.indexOf(item.koppeling),
      // Komt uit de vaste koppelingen (portalen.js): bij Opslaan niet als eigen koppeling bewaren, tenzij HR hem verandert.
      vastSleutel: item.koppeling && vast.some(v => zelfdeKoppeling(v, item.koppeling)) ? item.sleutel : null,
    }));
  }

  // De koppelingen komen via de popup als kopie binnen: vergelijk op inhoud, niet op object.
  function zelfdeKoppeling(a, b) {
    const x = a.veld || {}, y = b.veld || {};
    return a.sleutel === b.sleutel && (x.id || '') === (y.id || '') && (x.name || '') === (y.name || '') && x.label === y.label && x.nr === y.nr;
  }

  function veldenLive(opties) {
    return wachtOpVelden(() => velden(opties), 3000);
  }

  // Herkomst van de zichtbare iframes, zodat de popup in één keer toegang kan vragen voor een scherm in een iframe.
  function frameHerkomst() {
    const uit = new Set();
    for (const f of alle(document, el => el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
      const r = f.getBoundingClientRect();
      if (r.width < 200 || r.height < 100) continue;
      try { const u = new URL(f.src, location.href); if (/^https?:$/.test(u.protocol) && u.origin !== location.origin) uit.add(u.origin); } catch (e) { /* geen geldige src */ }
    }
    return [...uit];
  }

  root.AdressenboekjeLees = lees;
  root.AdressenboekjeLeesLive = leesLive;
  root.AdressenboekjeVelden = velden;
  root.AdressenboekjeVeldenLive = veldenLive;
  root.AdressenboekjeAnalyse = analyse;
  root.AdressenboekjeVul = vul;
  root.AdressenboekjeNaamVan = naamVan;
  root.AdressenboekjeFrames = frameHerkomst;
  root.AdressenboekjeAlle = alle;
  root.AdressenboekjeDiagnose = diagnose;
})(typeof globalThis !== 'undefined' ? globalThis : this);
