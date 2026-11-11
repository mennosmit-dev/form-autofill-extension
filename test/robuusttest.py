"""Test van v0.5 in de echte extensie (Edge), op nagebouwde formulieren met lastige techniek:
zelfgebouwde keuzelijsten en knoppen (9), webcomponenten met shadow DOM (10), contenteditable (11),
velden die later verschijnen (12) en een site die niet in portalen.js staat (13, via localhost).
Per formulier: popup openen op die site, Vul deze pagina (eerste keer: lijst, Opslaan, vullen), controleren wat
het formulier zelf zag (window.staat), dan pagina en popup opnieuw openen en direct vullen. Aan het eind alle
formulieren nog eens (pagina's op één site mogen elkaars koppelingen niet vervangen), lezen uit een HRSuite-scherm
met shadow DOM en iframe (14), en de omzetting van koppelingen uit v0.4.
Er wordt nooit iets verstuurd: elk formulier zet window.verstuurd bij een submit, en dat moet false blijven.
Draai: python -I test/robuusttest.py"""
import json
import pathlib
import shutil
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from playwright.sync_api import expect, sync_playwright  # noqa: E402

from extensietest import MAP, start_server  # noqa: E402

# (bestand, site, wat het formulier hoort te zien, wat in "Lukte niet" moet staan, welke velden de eerste keer rood (niet herkend) zijn)
GEVALLEN = [
    ("9-keuzelijsten.html", "127.0.0.1", {
        "achternaam": "Persoon", "voorletters": "TJ", "geboortedatum": "1995-03-07", "geslacht": "Man", "land": "Nederland",
        "afdeling": "Voorbeeld BV", "taal": "Nederlands", "aanhef": "De heer", "mobiel": "06-12345678"},
     ["Woonplaats: de waarde bleef niet staan", "BSN: het veld staat uit"], []),
    ("10-webcomponent.html", "127.0.0.1", {
        "voornaam": "Test", "achternaam": "Persoon", "geslacht": "Man", "straat": "Teststraat", "huisnummer": "12",
        "toevoeging": "A", "postcode": "1234AB", "email": "test.persoon@werk.example", "woonplaats": "Utrecht"}, [], []),
    ("11-contenteditable.html", "127.0.0.1", {
        "voornaam": "Test", "functie": "Consultant", "achternaam": "Persoon", "postcode": "1234AB"}, [], ["Opmerkingen"]),
    ("12-later-velden.html", "127.0.0.1", {
        "achternaam": "Persoon", "land": "NL", "gd_dag": "7", "gd_maand": "3", "gd_jaar": "1995",
        "postcode": "1234AB", "huisnummer": "12", "straat": "Teststraat"}, [], []),
    ("13-onbekende-site.html", "localhost", {
        "vn": "Test", "an": "Persoon", "em": "test.persoon@werk.example", "gd": "07-03-1995", "pc": "1234AB"}, [], []),
]

VUL = "async u => { const [t] = await chrome.tabs.query({ url: u }); await vulPagina(t); }"
fouten = []
resultaten = []


def popup_op(ctx, ext_id, formulier):
    """Zoals HR: de site staat voor, ze klikt het icoon. De popup kiest zelf het portaal van die site."""
    popup = ctx.new_page()
    popup.on("pageerror", lambda e: fouten.append(str(e)))
    popup.goto(f"chrome-extension://{ext_id}/popup.html")
    popup.evaluate("gestart")
    formulier.bring_to_front()
    popup.evaluate("start()")
    return popup


def controleer(naam, formulier, verwacht):
    staat = formulier.evaluate("window.staat")
    mis = {k: (staat.get(k), v) for k, v in verwacht.items() if staat.get(k) != v}
    assert not formulier.evaluate("window.verstuurd"), f"{naam}: het formulier is verstuurd!"
    return mis


def main():
    tmp = pathlib.Path(tempfile.mkdtemp())
    ext = tmp / "ext"
    shutil.copytree(MAP / "extension", ext)
    manifest = json.loads((ext / "manifest.json").read_text("utf8"))
    manifest["background"] = {"service_worker": "sw.js"}
    manifest["host_permissions"] = ["http://127.0.0.1/*", "http://localhost/*"]
    (ext / "manifest.json").write_text(json.dumps(manifest), "utf8")
    (ext / "sw.js").write_text("", "utf8")

    server = start_server()
    poort = server.server_port
    alles_ok = True
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profiel"), channel="msedge", headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]

        # 0. Koppelingen uit v0.4 (vier vaste tabjes, hosts met www.) worden omgezet en blijven werken.
        eerste = ctx.new_page()
        eerste.goto(f"chrome-extension://{ext_id}/popup.html")
        eerste.evaluate("gestart")
        oud = {
            "koppelingen": {"insurerb": [{"veld": {"id": "iban", "name": "iban", "label": "iban", "nr": 1}, "sleutel": "leeg", "pagina": "p1"}]},
            "paginas": {"insurerb": [{"id": "p1", "titel": "Oud", "velden": 1, "datum": "22-10-2026"}]},
            "hosts": {"www.oud-portaal.example": "insurerb", "employer.insurer-a.example": "insurera", "eigen.example": "eigen.example"}, "laatstePortaal": "insurerb",
        }
        eerste.evaluate("o => chrome.storage.local.clear().then(() => chrome.storage.local.set(o))", oud)
        eerste.reload()
        eerste.evaluate("gestart")
        lokaal = eerste.evaluate("chrome.storage.local.get(null)")
        assert lokaal["schema"] == 6 and lokaal["hosts"] == {"oud-portaal.example": "insurerb", "employer.insurer-a.example": "insurera"}, lokaal["hosts"]
        assert lokaal["koppelingen"]["insurerb"] == oud["koppelingen"]["insurerb"]
        assert eerste.evaluate("portaalVoorHost('www.oud-portaal.example', " + json.dumps(lokaal["hosts"]) + ")") == "insurerb"
        print("OK   omzetting v0.4: hosts", lokaal["hosts"], "koppelingen Insurer B behouden")
        eerste.locator("#meer").evaluate("d => d.open = true")
        eerste.click("#test")  # verzonnen testpersoon in het profiel (storage.session)
        eerste.close()

        # 1. Per formulier: koppelen, vullen, controleren, opnieuw openen en direct vullen.
        for bestand, site, verwacht, mislukt, onbekend in GEVALLEN:
            url = f"http://{site}:{poort}/{bestand}"
            formulier = ctx.new_page()
            formulier.goto(url)
            popup = popup_op(ctx, ext_id, formulier)
            tabje = popup.inner_text("#tab-portaal")
            assert tabje == site, f"{bestand}: tabje heet {tabje}, verwacht {site}"
            popup.evaluate(VUL, url)
            eerst = popup.inner_text("#rapport")
            assert "Eerste keer" in eerst or "Nieuwe pagina" in eerst, eerst
            rijen = popup.locator("#koppeltabel tr").count()
            rood_namen = popup.locator("#koppeltabel tr.onbekend td:first-child").all_inner_texts()
            assert all(o in rood_namen for o in onbekend), (bestand, rood_namen)
            rood = popup.locator("#koppeltabel tr.onbekend select")
            for _ in range(rood.count()):
                rood.nth(0).select_option("overslaan")
            popup.click("#koppeltabel .opslaan")
            expect(popup.locator("#rapport")).to_contain_text("Ingevuld", timeout=20000)
            rapport = popup.inner_text("#rapport")
            mis = controleer(bestand, formulier, verwacht)
            ontbreekt = [m for m in mislukt if m not in rapport]
            ok = not mis and not ontbreekt
            print(("OK   " if ok else "FOUT ") + f"{bestand} koppelen + vullen ({rijen} velden in de lijst)", mis or "", ontbreekt or "")
            if not ok:
                print(rapport)
            alles_ok &= ok

            # Opnieuw openen: geen lijst, direct vullen.
            formulier.reload()
            popup.close()
            popup = popup_op(ctx, ext_id, formulier)
            popup.evaluate(VUL, url)
            rapport = popup.inner_text("#rapport")
            direct = rapport.startswith("Ingevuld") and popup.locator("#koppeltabel tr").count() == 0
            mis = controleer(bestand, formulier, verwacht)
            ok = direct and not mis
            print(("OK   " if ok else "FOUT ") + f"{bestand} opnieuw: direct gevuld", "" if direct else rapport[:200], mis or "")
            alles_ok &= ok
            resultaten.append((bestand, rapport))
            popup.close()
            formulier.close()

        # 2. Alle formulieren nog eens: pagina's op één site delen velden (Achternaam) maar blijven elk bekend.
        for bestand, site, verwacht, mislukt, onbekend in GEVALLEN:
            url = f"http://{site}:{poort}/{bestand}"
            formulier = ctx.new_page()
            formulier.goto(url)
            popup = popup_op(ctx, ext_id, formulier)
            popup.evaluate(VUL, url)
            rapport = popup.inner_text("#rapport")
            mis = controleer(bestand, formulier, verwacht)
            ok = rapport.startswith("Ingevuld") and not mis
            print(("OK   " if ok else "FOUT ") + f"{bestand} na alle andere pagina's: nog steeds direct", "" if ok else rapport[:200], mis or "")
            alles_ok &= ok
            popup.close()
            formulier.close()

        lokaal = ctx.new_page()
        lokaal.goto(f"chrome-extension://{ext_id}/popup.html")
        opslag = lokaal.evaluate("chrome.storage.local.get(null)")
        assert "Persoon" not in json.dumps(opslag) and "1234AB" not in json.dumps(opslag), "geen persoonsgegevens in storage.local"
        paginas = {k: len(v) for k, v in opslag["paginas"].items()}
        print("OK   storage.local zonder persoonsgegevens; pagina's per portaal:", paginas)
        assert paginas.get("127.0.0.1") == 4 and paginas.get("localhost") == 1, paginas

        # 3. "Deze site hoort bij": localhost toewijzen aan Insurer B.
        formulier = ctx.new_page()
        formulier.goto(f"http://localhost:{poort}/13-onbekende-site.html")
        popup = popup_op(ctx, ext_id, formulier)
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.select_option("#hoortbij", "insurerb")
        expect(popup.locator("#tab-portaal")).to_have_text("Insurer B")
        hosts = popup.evaluate("chrome.storage.local.get('hosts')")["hosts"]
        assert hosts.get("localhost") == "insurerb", hosts
        popup.select_option("#hoortbij", "localhost")
        hosts = popup.evaluate("chrome.storage.local.get('hosts')")["hosts"]
        assert "localhost" not in hosts, hosts
        print("OK   Deze site hoort bij: localhost naar Insurer B en weer terug")
        popup.close()
        formulier.close()

        # 4. HRSuite-kant: gegevens in een webcomponent (shadow DOM) en in een iframe.
        hrsuite = ctx.new_page()
        hrsuite.goto(f"http://127.0.0.1:{poort}/14-hrsuite-shadow-iframe.html")
        hrsuite.wait_for_timeout(300)
        popup = popup_op(ctx, ext_id, hrsuite)
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.locator("#wis").evaluate("b => b.click()")
        popup.evaluate("async u => { const [t] = await chrome.tabs.query({ url: u }); await haalUitHrSuite(t); }", f"http://127.0.0.1:{poort}/14-*")
        profiel = popup.evaluate("chrome.storage.session.get('profiel')")["profiel"]
        verwacht = {"achternaam": "Persoon", "voornamen": "Test Jan", "geslacht": "M", "geboortedatum": "1995-03-07",
                    "emailWerk": "test.persoon@werk.example", "straat": "Teststraat", "huisnummer": "12", "postcode": "1234AB", "woonplaats": "Utrecht"}
        mis = {k: (profiel.get(k), v) for k, v in verwacht.items() if profiel.get(k) != v}
        print(("OK   " if not mis else "FOUT ") + "HRSuite met shadow DOM en iframe", mis or "")
        alles_ok &= not mis

        assert not fouten, fouten
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print("\nROBUUSTTEST OK" if alles_ok else "\nER GING IETS MIS")
    if not alles_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
