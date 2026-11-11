"""Test van v0.6 in de echte extensie (Edge, headless) op de vier faalpunten van de test met HR op 9/11:
1. Dienstverband: keuzelijst, keuzerondjes en zelfgebouwde keuzelijst kiezen de optie van dezelfde soort (17), en een oude
   koppeling "niet invullen" op dienstverbandCode (AbsencePortal, export 9/11) wordt Dienstverband (omzetting schema 6).
2. Salaris: instelling per portaal (geen omrekening / per maand / per jaar) en decimaalteken (17).
3. HealthDesk: vaste koppelingen uit de export van 9/11 op een formulier dat daaruit is nagebouwd (18), met datumkiezers
   waarvan het id per keer laden verandert; tweede keer direct vullen.
4. HRSuite: lezen uit een live opgebouwd scherm, met paginagegevens in het script (15) en alleen het scherm (16), plus de diagnose.
5. Rapport per veld: ingevuld / niet gevonden / overgeslagen / mislukt met reden; een veld met een andere waarde wordt gemeld,
   een veld dat de waarde inkort blijft niet half staan.
Er wordt nooit iets verstuurd: elk formulier zet window.verstuurd bij een submit, en dat moet false blijven.
Draai: python -I -X utf8 test/v06test.py"""
import json
import pathlib
import shutil
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from playwright.sync_api import expect, sync_playwright  # noqa: E402

from extensietest import MAP, start_server  # noqa: E402

VUL = "async u => { const [t] = await chrome.tabs.query({ url: u }); await vulPagina(t); }"
LEES = "async u => { const [t] = await chrome.tabs.query({ url: u }); await haalUitHrSuite(t); }"
DIAGNOSE = "async u => { const [t] = await chrome.tabs.query({ url: u }); await toonDiagnose(t); }"
fouten = []
uitkomst = []


def meld(ok, tekst, extra=""):
    uitkomst.append(ok)
    print(("OK   " if ok else "FOUT ") + tekst, extra if not ok else "")


def popup_op(ctx, ext_id, pagina):
    popup = ctx.new_page()
    popup.on("pageerror", lambda e: fouten.append(str(e)))
    popup.goto(f"chrome-extension://{ext_id}/popup.html")
    popup.evaluate("gestart")
    pagina.bring_to_front()
    popup.evaluate("start()")
    return popup


def verschil(staat, verwacht):
    return {k: (staat.get(k), v) for k, v in verwacht.items() if staat.get(k) != v}


def main():
    tmp = pathlib.Path(tempfile.mkdtemp())
    ext = tmp / "ext"
    shutil.copytree(MAP / "extension", ext)
    manifest = json.loads((ext / "manifest.json").read_text("utf8"))
    manifest["background"] = {"service_worker": "sw.js"}
    manifest["host_permissions"] = ["http://127.0.0.1/*", "http://localhost/*"]
    (ext / "manifest.json").write_text(json.dumps(manifest), "utf8")
    (ext / "sw.js").write_text("", "utf8")
    assert manifest["version"] == "0.6.0", manifest["version"]

    server = start_server()
    poort = server.server_port
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp / "profiel"), channel="msedge", headless=True,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"],
        )
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]

        # ---- 0. Omzetting: "niet invullen" op een dienstverbandveld (AbsencePortal, export 9/11) wordt Dienstverband ----
        eerste = ctx.new_page()
        eerste.goto(f"chrome-extension://{ext_id}/popup.html")
        eerste.evaluate("gestart")
        oud = {"schema": 5, "koppelingen": {"absence-portal.example": [
            {"pagina": "mw9gash7", "sleutel": "overslaan", "veld": {"id": "dienstverbandCode", "label": "", "name": "", "nr": 1, "type": "select"}},
            {"pagina": "mw9gash7", "sleutel": "overslaan", "veld": {"id": "BurgerlijkeStaatCode", "label": "burgelijke staat", "name": "", "nr": 1, "type": "select"}},
        ]}}
        eerste.evaluate("o => chrome.storage.local.clear().then(() => chrome.storage.local.set(o))", oud)
        eerste.reload()
        eerste.evaluate("gestart")
        lokaal = eerste.evaluate("chrome.storage.local.get(null)")
        k = lokaal["koppelingen"]["absence-portal.example"]
        meld(lokaal["schema"] == 6 and k[0]["sleutel"] == "dienstverband" and k[1]["sleutel"] == "overslaan",
             "omzetting schema 6: dienstverbandCode 'niet invullen' -> Dienstverband, burgerlijke staat blijft", k)
        eerste.evaluate("chrome.storage.local.clear()")
        eerste.close()

        # ---- 4a. HRSuite live, met paginagegevens in het script (15) ----
        hrsuite = ctx.new_page()
        hrsuite.on("pageerror", lambda e: fouten.append(str(e)))
        url = f"http://localhost:{poort}/15-hrsuite-live.html"
        hrsuite.goto(url)
        popup = popup_op(ctx, ext_id, hrsuite)
        popup.evaluate(LEES, url)
        profiel = popup.evaluate("chrome.storage.session.get('profiel')")["profiel"]
        verwacht = {"achternaam": "Persoon", "tussenvoegsel": "van der", "voornamen": "Test Jan", "roepnaam": "Test", "voorletters": "T.J.",
                    "geslacht": "M", "bsn": "111222333", "geboortedatum": "1995-03-07", "postcode": "1234AB", "huisnummer": "12", "toevoeging": "A",
                    "straat": "Teststraat", "woonplaats": "Utrecht", "emailWerk": "test.persoon@werk.example", "emailPrive": "test.persoon@prive.example",
                    "mobiel": "06-12345678", "datumInDienst": "2026-11-01", "dienstverband": "onbepaald", "urenPerWeek": "32,00"}
        mis = verschil(profiel, verwacht)
        melding = popup.inner_text("#hrsuitemelding")
        meld(not mis and "paginagegevens van HRSuite" in melding,
             "HRSuite 15: uit het script (ook BSN en verborgen geboortedatum), dienstverband 'Onbepaalde tijd' -> onbepaald", (mis, melding))
        meld(not profiel.get("maandloon"), "HRSuite 15: 'Soort salaris = Maandloon' wordt geen salarisbedrag", profiel.get("maandloon"))
        popup.close()
        hrsuite.close()

        # ---- 4b. HRSuite live, alleen het scherm, in twee golven (16) ----
        hrsuite = ctx.new_page()
        hrsuite.on("pageerror", lambda e: fouten.append(str(e)))
        url = f"http://localhost:{poort}/16-hrsuite-live-alleen-scherm.html"
        hrsuite.goto(url)
        popup = popup_op(ctx, ext_id, hrsuite)
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.locator("#wis").evaluate("b => b.click()")
        popup.evaluate(LEES, url)  # direct na laden: het scherm staat er nog niet
        profiel = popup.evaluate("chrome.storage.session.get('profiel')")["profiel"]
        verwacht = {"achternaam": "Persoon", "voornamen": "Test Jan", "geslacht": "M", "geboortedatum": "1995-03-07", "postcode": "1234AB",
                    "huisnummer": "12", "toevoeging": "A", "straat": "Teststraat", "woonplaats": "Utrecht", "emailWerk": "test.persoon@werk.example",
                    "mobiel": "06-12345678", "dienstverband": "onbepaald", "datumInDienst": "2026-11-01", "urenPerWeek": "32", "maandloon": "3.500,00"}
        mis = verschil(profiel, verwacht)
        meld(not mis, "HRSuite 16: wacht op beide golven; dt/dd in shadow DOM, tabel met kopregel, aria-labelledby, label for, aria-label, 'Label: waarde'", mis)

        # Diagnose op hetzelfde scherm (tabje HRSuite).
        hrsuite.reload()
        popup.evaluate(DIAGNOSE, url)
        frames = popup.evaluate("laatsteDiagnose")
        rijen = [r for f in frames for r in f["rijen"]]
        pasfoto = [r for r in rijen if r["label"].startswith("Pasfotonummer")]
        achternaam = [r for r in rijen if r["label"] == "Achternaam"]
        tekst = popup.evaluate("diagnoseTekst(laatsteDiagnose)")
        lekt = [w for w in ["Persoon", "Teststraat", "1234", "7781", "werk.example", "1995"] if w in tekst]
        tabel = popup.locator("#diagnosedoos tbody tr").count()
        meld(bool(pasfoto) and "niet herkend" in pasfoto[0]["reden"] and bool(achternaam) and achternaam[0]["gegeven"].startswith("Achternaam")
             and not lekt and tabel == len(rijen) and frames[0]["stil"],
             f"diagnose HRSuite: {len(rijen)} labels/waarden, onbekend label gemeld, kopie zonder waarden", (pasfoto, achternaam, lekt, tabel))
        print("     diagnosekop:", popup.locator("#diagnosedoos p").first.inner_text()[:200])
        popup.close()
        hrsuite.close()

        # ---- 1, 2, 5. Portaal met dienstverband en salaris (17) ----
        url = f"http://127.0.0.1:{poort}/17-dienstverband-salaris.html"
        formulier = ctx.new_page()
        formulier.on("pageerror", lambda e: fouten.append(str(e)))
        formulier.goto(url)
        popup = popup_op(ctx, ext_id, formulier)
        popup.locator("#meer").evaluate("d => d.open = true")
        popup.evaluate("zetFormulier(TESTPERSOON); bewaar()")
        popup.evaluate(VUL, url)
        assert "Eerste keer" in popup.inner_text("#rapport")
        popup.click("#koppeltabel .opslaan")
        expect(popup.locator("#rapport")).to_contain_text("Ingevuld", timeout=20000)
        rapport = popup.inner_text("#rapport")
        staat = formulier.evaluate("window.staat")
        verwacht = {"achternaam": "Persoon", "geboortedatum": "07-03-1995", "dienstverband": "Onbepaalde tijd", "typecontract": "Vast",
                    "contractvorm": "Vast contract", "fulltimeJaarsalaris": "56700", "maandsalaris": "3500", "parttime": "80",
                    "telefoon": "0612345678", "voorletters": ""}
        mis = verschil(staat, verwacht)
        meld(not mis, "17: dienstverband op drie manieren 'Onbepaalde tijd' (niet 'Bepaalde tijd'), salaris zonder omrekening", mis)
        meld("landcode" not in staat and formulier.input_value("#tel-lc") == "+31", "17: landcode niet aangeraakt, nummer in het vakje erna", staat)
        meld(formulier.input_value("#wp") == "Amsterdam" and 'had al een andere waarde ("Amsterdam")' in rapport,
             "17: veld met een andere waarde niet stil overschreven maar gemeld", rapport)
        meld(formulier.input_value("#vl") == "" and "veld weer leeg gemaakt" in rapport,
             "17: veld dat de waarde inkort blijft niet half staan (weer leeg, met reden)", (formulier.input_value("#vl"), rapport))
        velden = popup.evaluate("laatsteRapport")
        status = {v["naam"]: v["status"] for v in velden}
        zonder_reden = [v for v in velden if v["status"] != "ingevuld" and not v["reden"]]
        meld(status.get("Woonplaats") == "mislukt" and status.get("Voorletters") == "mislukt" and status.get("Telefoon privé") == "overgeslagen"
             and status.get("Soort dienstverband") == "ingevuld" and not zonder_reden and len(velden) >= 11,
             f"17: rapport per veld ({len(velden)} velden), elk niet-ingevuld veld met reden", (status, zonder_reden))
        print("     rapport:\n" + "\n".join("       " + r for r in rapport.splitlines()))

        # Salaris per maand: fulltime jaarsalaris / 12; maandsalaris blijft (maand -> maand). Tweede keer: direct, ondanks nieuw dp-id.
        popup.select_option("#salariseenheid", "maand")
        formulier.reload()
        popup.evaluate(VUL, url)
        rapport = popup.inner_text("#rapport")
        staat = formulier.evaluate("window.staat")
        mis = verschil(staat, {"fulltimeJaarsalaris": "4725", "maandsalaris": "3500", "geboortedatum": "07-03-1995"})
        meld(not mis and rapport.startswith("Ingevuld") and "gedeeld door 12" in rapport,
             "17: instelling 'maandbedrag' -> 56700 / 12 = 4725, staat in het rapport; direct gevuld (datumkiezer-id veranderde)", (mis, rapport[:300]))
        popup.select_option("#salariseenheid", "jaar")
        formulier.reload()
        popup.evaluate(VUL, url)
        staat = formulier.evaluate("window.staat")
        mis = verschil(staat, {"fulltimeJaarsalaris": "56700", "maandsalaris": "42000"})
        meld(not mis, "17: instelling 'jaarbedrag' -> maandsalaris 3500 x 12 = 42000", mis)
        popup.select_option("#salariseenheid", "")
        popup.select_option("#getalnotatie", "punt")
        popup.evaluate("zetFormulier(Object.assign(leesFormulier(), { maandloon: '3500,5' })); bewaar()")
        formulier.reload()
        popup.evaluate(VUL, url)
        staat = formulier.evaluate("window.staat")
        meld(staat.get("maandsalaris") == "3500.50", "17: decimaalteken punt -> 3500.50, geen euroteken", staat.get("maandsalaris"))
        popup.select_option("#getalnotatie", "")
        inst = popup.evaluate("chrome.storage.local.get('instellingen')")["instellingen"]
        meld(inst.get("127.0.0.1") == {"salarisEenheid": "", "getalNotatie": ""}, "17: instellingen per portaal in storage.local", inst)

        # Dienstverband bepaald.
        popup.evaluate("zetFormulier(Object.assign(leesFormulier(), { dienstverband: 'bepaald', maandloon: '3500' })); bewaar()")
        formulier.reload()
        popup.evaluate(VUL, url)
        staat = formulier.evaluate("window.staat")
        mis = verschil(staat, {"dienstverband": "Bepaalde tijd", "typecontract": "Tijdelijk", "contractvorm": "Tijdelijk contract"})
        meld(not mis, "17: dienstverband bepaald -> 'Bepaalde tijd', 'Tijdelijk', 'Tijdelijk contract'", mis)
        assert not formulier.evaluate("window.verstuurd"), "17 is verstuurd!"
        popup.evaluate("zetFormulier(TESTPERSOON); bewaar()")
        popup.close()
        formulier.close()

        # ---- 3. HealthDesk, nagebouwd uit de export van 9/11 (18), op localhost dat bij HealthDesk hoort ----
        url = f"http://localhost:{poort}/18-healthdesk-v3.html"
        formulier = ctx.new_page()
        formulier.on("pageerror", lambda e: fouten.append(str(e)))
        formulier.goto(url)
        hulp = ctx.new_page()
        hulp.goto(f"chrome-extension://{ext_id}/popup.html")
        hulp.evaluate("chrome.storage.local.get('hosts').then(({ hosts = {} }) => chrome.storage.local.set({ hosts: Object.assign(hosts, { localhost: 'healthdesk' }) }))")
        hulp.close()
        popup = popup_op(ctx, ext_id, formulier)
        tabje = popup.inner_text("#tab-portaal")
        popup.evaluate(VUL, url)
        eerst = popup.inner_text("#rapport")
        rood = popup.locator("#koppeltabel tr.onbekend td:first-child").all_inner_texts()
        meld(tabje == "HealthDesk" and "Nieuwe pagina" in eerst and len(rood) == 7 and '(keuzelijst zonder label, na "Voorletters") (2e)' in rood,
             "18: alleen de 7 velden zonder label zijn rood (de rest komt uit de vaste koppelingen), met houvast in de naam", (tabje, eerst, rood))
        popup.click("#koppeltabel .opslaan")
        expect(popup.locator("#rapport")).to_contain_text("Ingevuld", timeout=20000)
        rapport = popup.inner_text("#rapport")
        staat = formulier.evaluate("window.staat")
        verwacht = {"achternaam": "Persoon", "tussenvoegsel": "van der", "roepnaam": "Test", "voorletters": "T.J.", "postcode": "1234AB",
                    "huisnummer": "12", "toevoeging": "A", "straat": "Teststraat", "plaats": "Utrecht", "lc-tp": "+31", "lc-tw": "+31", "lc-mp": "+31",
                    "telPrive": "0301234567", "telWerk": "0301234567", "mobielPrive": "0612345678", "emailPrive": "test.persoon@prive.example",
                    "emailWerk": "test.persoon@werk.example", "uren": "32", "maandloon": "3500", "personeelsnummer": "", "iban": "", "extra": "",
                    "datum3": "", "keuze2": "0"}
        mis = verschil(staat, verwacht)
        meld(not mis and "landcode" in rapport, "18: HealthDesk gevuld volgens de vaste koppelingen; nummers naast de landcode", (mis, rapport))
        formulier.reload()
        popup.evaluate(VUL, url)
        rapport = popup.inner_text("#rapport")
        direct = rapport.startswith("Ingevuld") and popup.locator("#koppeltabel tr").count() == 0
        mis = verschil(formulier.evaluate("window.staat"), {"achternaam": "Persoon", "mobielPrive": "0612345678"})
        meld(direct and not mis, "18: tweede keer direct gevuld, ook al kregen de datumkiezers een nieuw id", rapport[:300])

        # Diagnose op het portaal: vaste koppelingen en wat nog gecontroleerd moet worden.
        popup.evaluate(DIAGNOSE, url)
        frames = popup.evaluate("laatsteDiagnose")
        rijen = [r for f in frames for r in f["rijen"]]
        vast = [r for r in rijen if "vaste koppeling" in r["reden"]]
        controle = [r for r in rijen if "nog te controleren" in r["reden"]]
        meld(len(vast) >= 15 and len(controle) >= 3 and frames[0]["modus"] == "portaal",
             f"18: diagnose portaal: {len(vast)} vaste koppelingen, {len(controle)} met 'nog te controleren'", (len(vast), len(controle)))
        assert not formulier.evaluate("window.verstuurd"), "18 is verstuurd!"

        opslag = popup.evaluate("chrome.storage.local.get(null)")
        eigen = opslag["koppelingen"].get("healthdesk", [])
        meld(len(eigen) == 7, "18: alleen de 7 zelf gekoppelde velden bewaard; de vaste koppelingen niet dubbel", len(eigen))
        meld("Persoon" not in json.dumps(opslag) and "1234AB" not in json.dumps(opslag), "geen persoonsgegevens in storage.local")
        popup.close()
        formulier.close()

        meld(not fouten, "geen JavaScript-fouten in popup of formulieren", fouten)
        ctx.close()
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    alles = all(uitkomst)
    print(f"\n{sum(uitkomst)} van {len(uitkomst)} OK")
    print("V06TEST OK" if alles else "ER GING IETS MIS")
    if not alles:
        sys.exit(1)


if __name__ == "__main__":
    main()
