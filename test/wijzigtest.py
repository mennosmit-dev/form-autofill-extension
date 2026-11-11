"""Test van de één-knop-route (v0.4) in de echte extensie (Edge):
1. "Vul deze pagina" op een nieuwe pagina toont eerst de lijst; na Opslaan wordt meteen gevuld;
2. de tweede keer vult hij direct, zonder lijst;
3. verandert de pagina (veld erbij, veld weg), dan eerst weer de lijst, en de oude koppeling wordt vervangen;
4. noodroute: Ctrl+A/Ctrl+C op de pagina en plakken onder Meer geeft dezelfde velden.
Zelfde testopzet als plaktest.py."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import shutil
import tempfile

from playwright.sync_api import expect, sync_playwright

from extensietest import MAP, start_server

VUL = "async u => { const [t] = await chrome.tabs.query({ url: u }); await vulPagina(t); }"


def main():
    tmp = pathlib.Path(tempfile.mkdtemp())
    ext = tmp / "ext"
    shutil.copytree(MAP / "extension", ext)
    manifest = json.loads((ext / "manifest.json").read_text("utf8"))
    manifest["background"] = {"service_worker": "sw.js"}
    manifest["host_permissions"] = ["http://127.0.0.1/*"]
    (ext / "manifest.json").write_text(json.dumps(manifest), "utf8")
    (ext / "sw.js").write_text("", "utf8")

    server = start_server()
    basis = f"http://127.0.0.1:{server.server_port}/"
    fouten = []
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profiel"), channel="msedge", headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=basis.rstrip("/"))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]

        popup = ctx.new_page()
        popup.on("pageerror", lambda e: fouten.append(str(e)))
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.click("#test")  # testpersoon in het profiel
        popup.locator("#meer").evaluate("d => d.open = false")

        formulier = ctx.new_page()
        formulier.goto(basis + "7-ongevallen-onbekend.html")
        popup.evaluate("toonTab('insurerb')")

        # 1. Eerste keer: lijst, nog niets gevuld; na Opslaan gevuld.
        popup.evaluate(VUL, basis + "7-*")
        print("Eerste keer:", popup.inner_text("#rapport"))
        assert "Eerste keer" in popup.inner_text("#rapport")
        assert formulier.input_value("input >> nth=0") == "", "voor Opslaan hoort er nog niets ingevuld te zijn"
        eerste = popup.locator("#koppeltabel tr").count()
        rood = popup.locator("#koppeltabel tr.onbekend select")
        for _ in range(rood.count()):
            rood.nth(0).select_option("leeg")
        popup.click("#koppeltabel .opslaan")
        expect(popup.locator("#rapport")).to_contain_text("Ingevuld")
        print("Na Opslaan:", popup.inner_text("#rapport").splitlines()[0])

        # 2. Tweede keer: direct vullen, geen lijst.
        formulier.reload()
        popup.evaluate(VUL, basis + "7-*")
        assert popup.inner_text("#rapport").startswith("Ingevuld") and popup.locator("#koppeltabel tr").count() == 0
        print("Tweede keer: direct gevuld")

        # 3. Pagina verandert: een veld erbij, het eerste veld weg.
        formulier.evaluate("""() => {
            document.querySelector('input:not([type=hidden])').remove();
            const l = document.createElement('label'); l.textContent = 'Nieuw veld ';
            const i = document.createElement('input'); i.name = 'nieuwveld'; l.appendChild(i);
            document.querySelector('form, body').appendChild(l);
        }""")
        popup.evaluate(VUL, basis + "7-*")
        rapport = popup.inner_text("#rapport")
        print("Na wijziging:", rapport)
        assert "veranderd" in rapport and "Nieuw veld" in rapport, rapport
        rood = popup.locator("#koppeltabel tr.onbekend select")
        for _ in range(rood.count()):
            rood.nth(0).select_option("overslaan")
        popup.click("#koppeltabel .opslaan")
        # De velden waren al gevuld (stap 2): sinds v0.4.1 "Niets ingevuld" met uitleg over overschrijven.
        expect(popup.locator("#rapport")).to_contain_text("had al een waarde")
        paginas = popup.evaluate("chrome.storage.local.get('paginas')")["paginas"]["insurerb"]
        print("Pagina's Insurer B na opnieuw koppelen:", len(paginas))
        assert len(paginas) == 1, paginas

        # 4. Noodroute: Ctrl+A/Ctrl+C en plakken onder Meer.
        nieuw = ctx.new_page()
        nieuw.goto(basis + "7-ongevallen-onbekend.html")
        nieuw.click("body")
        nieuw.keyboard.press("Control+a")
        nieuw.keyboard.press("Control+c")
        klembord = nieuw.evaluate("""async () => {
            const [item] = await navigator.clipboard.read();
            return item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
        }""")
        popup.evaluate("toonTab('healthdesk')")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.evaluate("""h => { const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'tekst');
            document.getElementById('html').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", klembord)
        popup.wait_for_selector("#koppeltabel .uitleg")
        geplakt = popup.locator("#koppeltabel tr").count()
        print("Plakken met Ctrl+A:", geplakt, "velden; via Vul deze pagina:", eerste)
        assert geplakt == eerste, (geplakt, eerste)

        assert not fouten, fouten
        print("WIJZIGTEST OK")
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
