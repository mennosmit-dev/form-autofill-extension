// Leerstand: zet naast elk veld een keuzelijst met welk gegeven erin hoort.
// HR past aan wat niet klopt en klikt Opslaan. De koppeling (alleen veldnamen, geen
// persoonsgegevens) gaat naar chrome.storage.local en geldt daarna elke keer voor dit portaal.
(function (root) {
  'use strict';

  function keuzes() {
    const m = root.AdressenboekjeMatcher;
    const lijst = [['overslaan', '– niet invullen –'], ['leeg', '– leeg laten –']];
    for (const v of m.VELDEN) {
      lijst.push([v.sleutel, v.label]);
      if (m.DATUMS.includes(v.sleutel)) for (const d of ['dag', 'maand', 'jaar']) lijst.push([v.sleutel + '.' + d, v.label + ': ' + d]);
    }
    for (const v of m.AFGELEID) lijst.push([v.sleutel, v.label]);
    return lijst;
  }

  function start(portaalId) {
    if (document.querySelector('[data-adressenboekje]')) return { velden: 0, al: true };
    const Ps = root.AdressenboekjePortalen;
    const portaal = Ps.portaal ? Ps.portaal(portaalId) : Ps.PORTALEN[portaalId];

    return chrome.storage.local.get('koppelingen').then(({ koppelingen }) => {
      const geleerd = (koppelingen && koppelingen[portaalId]) || [];
      const items = root.AdressenboekjeAnalyse({ portaal, koppelingen: geleerd.concat(portaal.koppelingen) });
      if (!items.length) return { velden: 0 };

      const host = document.createElement('div');
      host.setAttribute('data-adressenboekje', '');
      host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;';
      document.body.appendChild(host);
      const schaduw = host.attachShadow({ mode: 'open' });
      schaduw.innerHTML = `<style>
        select { position:absolute; font:11px system-ui,sans-serif; background:#fff3c4; border:1px solid #d9a400; border-radius:3px; max-width:220px; padding:1px; }
        select.onbekend { background:#ffd9d9; border-color:#c0392b; }
        .balk { position:fixed; top:10px; right:10px; background:#1c1c1c; color:#fff; font:13px system-ui,sans-serif; padding:10px 12px; border-radius:6px; box-shadow:0 2px 10px #0005; max-width:300px; }
        .balk button { font:inherit; margin:8px 6px 0 0; padding:4px 10px; border-radius:4px; border:0; cursor:pointer; }
        .balk .opslaan { background:#f5b400; }
      </style>
      <div class="balk"><b>Velden koppelen: ${portaal.naam}</b><br>
      Kies per veld wat erin hoort. Rood = niet herkend. Alleen veldnamen worden bewaard, geen gegevens.<br>
      <button class="opslaan">Opslaan</button><button class="stop">Annuleren</button></div>`;

      const opties = keuzes();
      const lijsten = items.map(item => {
        const s = document.createElement('select');
        for (const [waarde, tekst] of opties) s.add(new Option(tekst, waarde));
        let huidig = item.sleutel === 'telefoonOfMobiel' ? 'mobiel' : item.sleutel;
        if (huidig === 'bedrijf') huidig = 'overslaan';
        // Personeelsnummer, kostenplaats en einddatum blijven leeg (afspraak 20-10): niet als "niet herkend" tonen.
        if (root.AdressenboekjeMatcher.LEEG.includes(huidig)) huidig = 'leeg';
        if (huidig && opties.some(o => o[0] === huidig)) s.value = huidig;
        else { s.value = 'overslaan'; s.classList.add('onbekend'); }
        s.addEventListener('change', () => s.classList.remove('onbekend'));
        schaduw.appendChild(s);
        return { item, s };
      });

      function plaats() {
        for (const { item, s } of lijsten) {
          const r = item.el.getBoundingClientRect();
          s.style.left = (r.left + scrollX) + 'px';
          s.style.top = Math.max(0, r.top + scrollY - 20) + 'px';
        }
      }
      plaats();
      addEventListener('scroll', plaats, true);
      addEventListener('resize', plaats);
      function stop() {
        removeEventListener('scroll', plaats, true);
        removeEventListener('resize', plaats);
        host.remove();
      }

      schaduw.querySelector('.stop').addEventListener('click', stop);
      schaduw.querySelector('.opslaan').addEventListener('click', async () => {
        const { koppelingen: alle = {}, hosts = {} } = await chrome.storage.local.get(['koppelingen', 'hosts']);
        const nieuw = lijsten.map(({ item, s }) => ({ veld: item.vingerafdruk, sleutel: s.value }));
        const zelfde = (a, b) => a.id === b.id && a.name === b.name && a.label === b.label && a.nr === b.nr;
        const oud = (alle[portaalId] || []).filter(k => !nieuw.some(n => zelfde(n.veld, k.veld)));
        alle[portaalId] = oud.concat(nieuw);
        const site = Ps.siteId ? Ps.siteId(location.hostname) : location.hostname;
        if (site !== portaalId) hosts[site] = portaalId;
        await chrome.storage.local.set({ koppelingen: alle, hosts });
        stop();
        const melding = document.createElement('div');
        melding.setAttribute('data-adressenboekje', '');
        melding.textContent = `Opgeslagen: ${nieuw.length} velden voor ${portaal.naam}. Klik nu op "Vul deze pagina".`;
        melding.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;background:#1c1c1c;color:#fff;font:13px system-ui,sans-serif;padding:10px 12px;border-radius:6px;';
        document.body.appendChild(melding);
        setTimeout(() => melding.remove(), 4000);
      });
      return { velden: items.length };
    });
  }

  root.AdressenboekjeLeer = start;
  root.AdressenboekjeKeuzes = keuzes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
