"""Test van de route uit v0.3 in de echte extensie (Edge):
1. tabje HRSuite: "Haal uit HRSuite" leest het nagebouwde HRSuite-scherm in het profiel;
2. portaaltabje: HTML van een pagina plakken, velden zoeken, één onbekend veld goedzetten, opslaan;
3. "Vul deze pagina" vult daarna die pagina zonder onbekende velden, ook Insurer A scherm 1.
Zelfde testopzet als extensietest.py (lege service worker en toegang tot localhost)."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import shutil
import tempfile

from playwright.sync_api import sync_playwright

from extensietest import MAP, start_server


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
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]

        hrsuite = ctx.new_page()
        hrsuite.goto(basis + "8-hrsuite-medewerker.html")
        popup = ctx.new_page()
        popup.on("pageerror", lambda e: fouten.append(str(e)))
        popup.goto(f"chrome-extension://{ext_id}/popup.html")

        # 1. Haal uit HRSuite (de knop gebruikt het actieve tabblad; de test wijst het HRSuite-tabblad aan).
        popup.evaluate("async u => { const [t] = await chrome.tabs.query({ url: u }); await haalUitHrSuite(t); }", basis + "8-*")
        profiel = popup.evaluate("chrome.storage.session.get('profiel')")["profiel"]
        verwacht = {
            "voornamen": "Test Jan", "roepnaam": "Test", "tussenvoegsel": "van der", "achternaam": "Persoon", "geslacht": "M",
            "geboortedatum": "1995-03-07", "bsn": "111222333", "straat": "Teststraat", "huisnummer": "12", "toevoeging": "A",
            "postcode": "1234AB", "woonplaats": "Utrecht", "emailWerk": "test.persoon@werk.example",
            "emailPrive": "test.persoon@prive.example", "mobiel": "06-12345678", "datumInDienst": "2026-11-01",
            "functie": "Consultant", "urenPerWeek": "32", "maandloon": "3.500,00", "afdeling": "Voorbeeld BV",
        }
        mis = {k: (profiel.get(k), v) for k, v in verwacht.items() if profiel.get(k) != v}
        print("HRSuite-melding:", popup.inner_text("#hrsuitemelding"))
        print("Afwijkend na Haal uit HRSuite:", mis or "niets")
        assert not mis, mis
        print("Rijen in HRSuite-koppeltabel:", popup.locator("#hrsuitekoppel tr").count())

        # 2. Portaal Insurer B: plak de HTML van het nagebouwde ongevallenformulier.
        formulier = ctx.new_page()
        formulier.goto(basis + "7-ongevallen-onbekend.html")
        popup.evaluate("toonTab('insurerb')")
        html = (MAP / "testformulieren" / "7-ongevallen-onbekend.html").read_text("utf8")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.fill("#html", html)
        popup.locator("#koppelplak").evaluate("b => b.click()")
        print("Koppeltabel:", popup.inner_text("#koppeltabel .uitleg"))
        rood = popup.locator("#koppeltabel tr.onbekend select")
        for i in range(rood.count()):
            rood.nth(0).select_option("leeg")  # na elke keuze is hij niet meer rood
        popup.click("#koppeltabel .opslaan")
        popup.wait_for_timeout(200)
        print("Pagina's Insurer B:", popup.text_content("#paginas"))
        opgeslagen = popup.evaluate("chrome.storage.local.get(['koppelingen', 'paginas'])")
        assert "Persoon" not in json.dumps(opgeslagen), "koppelingen mogen geen persoonsgegevens bevatten"

        popup.evaluate("async u => { const [t] = await chrome.tabs.query({ url: u }); await vulPagina(t); }", basis + "7-*")
        rapport = popup.inner_text("#rapport")
        print(rapport)
        popup.set_viewport_size({"width": 464, "height": 600})
        popup.screenshot(path=str(MAP / "test" / "screenshot-popup-vul.png"))
        assert "Niet herkend" not in rapport, "na plakken en koppelen hoort niets meer onbekend te zijn"

        # 3. Insurer A scherm 1: zelfde route, dan invullen.
        insurera = ctx.new_page()
        insurera.goto(basis + "4-insurera-vier-schermen.html")
        popup.evaluate("toonTab('insurera')")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.fill("#html", (MAP / "testformulieren" / "4-insurera-vier-schermen.html").read_text("utf8"))
        popup.locator("#koppelplak").evaluate("b => b.click()")
        print("Insurer A:", popup.inner_text("#koppeltabel .uitleg"))
        popup.click("#koppeltabel .opslaan")
        popup.wait_for_timeout(200)
        popup.evaluate("async u => { const [t] = await chrome.tabs.query({ url: u }); await vulPagina(t); }", basis + "4-*")
        rapport = popup.inner_text("#rapport")
        print(rapport.splitlines()[0])
        assert insurera.input_value("#an") == "Persoon" and insurera.input_value("#vl") == "T.J."

        popup.set_viewport_size({"width": 464, "height": 900})
        popup.click("#tab-hrsuite")
        popup.screenshot(path=str(MAP / "test" / "screenshot-popup-hrsuite.png"), full_page=True)
        popup.evaluate("toonTab('insurerb')")
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.screenshot(path=str(MAP / "test" / "screenshot-popup-portaal.png"), full_page=True)
        assert not fouten, fouten
        print("PLAKTEST OK")
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
