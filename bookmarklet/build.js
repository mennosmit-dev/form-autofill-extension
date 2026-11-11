// Bouwt adressenboekje.html: het invulformulier plus een bookmarklet waarin
// matcher.js en fill.js zijn ingebakken. Draai: node bookmarklet/build.js
const fs = require('fs');
const path = require('path');

const ext = path.join(__dirname, '..', 'extension');
const code = [
  fs.readFileSync(path.join(ext, 'matcher.js'), 'utf8'),
  fs.readFileSync(path.join(ext, 'portalen.js'), 'utf8'),
  fs.readFileSync(path.join(ext, 'fill.js'), 'utf8'),
  `(function(){
    var tekst = prompt('Plak hier de gegevens uit het adressenboekje (Ctrl+V):');
    if (!tekst) return;
    var profiel;
    try { profiel = JSON.parse(tekst); } catch (e) { alert('Dit zijn geen gegevens uit het adressenboekje.'); return; }
    Promise.resolve(AdressenboekjeVul(profiel, {})).then(function (r) {
      alert('Ingevuld: ' + r.ingevuld.length + '\\n' + r.ingevuld.join('\\n') +
        (r.mislukt && r.mislukt.length ? '\\n\\nLukte niet (zelf invullen):\\n' + r.mislukt.join('\\n') : '') +
        (r.onbekend.length ? '\\n\\nNiet herkend (zelf invullen):\\n' + r.onbekend.join('\\n') : ''));
    });
  })();`,
].join('\n')
  // Regelcommentaar weg, anders breekt de bookmarklet op één regel.
  .split('\n').filter(r => !/^\s*\/\//.test(r)).map(r => r.replace(/\s+\/\/ .*$/, '')).join('\n');

const bookmarklet = 'javascript:' + encodeURIComponent('(function(){' + code + '})()');
const sjabloon = fs.readFileSync(path.join(__dirname, 'sjabloon.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'adressenboekje.html'), sjabloon.replace('__BOOKMARKLET__', bookmarklet));
console.log('adressenboekje.html gebouwd, bookmarklet', bookmarklet.length, 'tekens');
