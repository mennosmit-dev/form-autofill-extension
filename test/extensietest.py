"""Laadt de extensie in Edge en test opslag + invullen via chrome.scripting, zoals de popup het doet.
Een testkopie krijgt een lege service worker (om het extensie-ID te vinden) en toegang tot localhost,
omdat een geautomatiseerde test niet op het extensie-icoon kan klikken (activeTab)."""
import json
import pathlib
import shutil
import tempfile
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from playwright.sync_api import sync_playwright

MAP = pathlib.Path(__file__).resolve().parent.parent


def start_server():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(MAP / "testformulieren"))
    handler.log_message = lambda *a: None
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


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
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profiel"), channel="msedge", headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        print("Extensie geladen, id", ext_id)

        formulier = ctx.new_page()
        formulier.goto(basis + "7-ongevallen-onbekend.html")

        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup.html")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.click("#test")  # testpersoon op het tabje HRSuite
        opgeslagen = popup.evaluate("chrome.storage.session.get('profiel')")
        print("Tabje HRSuite in storage.session:", opgeslagen["profiel"]["achternaam"], "/ maandloon", opgeslagen["profiel"]["maandloon"])
        print("Berekend fulltime jaarsalaris (placeholder):", popup.get_attribute("input[name=fulltimeJaarsalaris]", "placeholder"))
        popup.evaluate("toonTab('insurerb')")
        print("Gekozen portaal onthouden:", popup.evaluate("chrome.storage.local.get('laatstePortaal')"))

        # Leerstand: zelfde aanroepen als de knop "Velden koppelen", maar op het formuliertabblad.
        popup.evaluate("""async (url) => {
            const [tab] = await chrome.tabs.query({ url: url + '*' });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['matcher.js', 'portalen.js', 'fill.js', 'leer.js'] });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: id => globalThis.AdressenboekjeLeer(id), args: ['insurerb'] });
        }""", basis + "7-")
        lijsten = formulier.locator("[data-adressenboekje] select")
        print("Keuzelijsten op de pagina:", lijsten.count())
        # HR zet IBAN (rood, niet herkend) op "leeg laten" en slaat op.
        iban = formulier.locator("[data-adressenboekje] select.onbekend").first
        iban.select_option("leeg")
        formulier.locator("[data-adressenboekje] button.opslaan").click()
        formulier.wait_for_timeout(300)
        geleerd = popup.evaluate("chrome.storage.local.get(['koppelingen', 'hosts'])")
        print("Geleerd voor insurerb:", len(geleerd["koppelingen"]["insurerb"]), "velden; IBAN →",
              [k["sleutel"] for k in geleerd["koppelingen"]["insurerb"] if k["veld"]["name"] == "iban"], "; hosts:", geleerd["hosts"])
        assert all(k.keys() == {"veld", "sleutel"} for k in geleerd["koppelingen"]["insurerb"])
        assert "Persoon" not in json.dumps(geleerd), "koppelingen mogen geen persoonsgegevens bevatten"

        # Invullen met de geleerde koppeling, zoals de knop "Vul deze pagina".
        rapport = popup.evaluate("""async (url) => {
            const [tab] = await chrome.tabs.query({ url: url + '*' });
            const { koppelingen } = await chrome.storage.local.get('koppelingen');
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['matcher.js', 'portalen.js', 'fill.js'] });
            const [r] = await chrome.scripting.executeScript({
              target: { tabId: tab.id }, func: (p, o) => globalThis.AdressenboekjeVul(p, o),
              args: [(await chrome.storage.session.get('profiel')).profiel, { portaal: 'insurerb', koppelingen: koppelingen.insurerb }] });
            return r.result;
        }""", basis + "7-")
        print("Rapport:", json.dumps(rapport, ensure_ascii=False))
        assert not rapport["onbekend"], "na koppelen hoort niets meer onbekend te zijn"

        formulier.locator("button").last.click()
        print("Portaal ontving:", formulier.inner_text("#uit"))
        formulier.screenshot(path=str(MAP / "test" / "screenshot-extensie.png"), full_page=True)
        popup.set_viewport_size({"width": 404, "height": 900})
        popup.click("#tab-hrsuite")
        popup.screenshot(path=str(MAP / "test" / "screenshot-popup.png"), full_page=True)
        print("EXTENSIETEST OK")
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
