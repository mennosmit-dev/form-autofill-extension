"""Test de koppelpagina: open een opgeslagen portaalscherm, zet een veld goed, exporteer,
en vul daarna het echte formulier met dat koppelbestand. Draai: python test/koppelpaginatest.py"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import tempfile

from playwright.sync_api import sync_playwright

MAP = pathlib.Path(__file__).resolve().parent.parent
from browsertest import TESTPERSOON, laad  # noqa: E402


def main():
    # Zoals Edge het bij Ctrl+S opslaat: met de bron-url als commentaar bovenaan.
    tmp = pathlib.Path(tempfile.mkdtemp())
    opgeslagen = tmp / "scherm.html"
    opgeslagen.write_text("<!-- saved from url=(0037)https://intake.verzekeraar-b.example/ -->\n"
                          + (MAP / "testformulieren" / "7-ongevallen-onbekend.html").read_text("utf8"), "utf8")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        pagina = browser.new_page(accept_downloads=True)
        pagina.goto((MAP / "koppelpagina" / "index.html").as_uri())
        pagina.select_option("#portaal", "insurerb")
        pagina.set_input_files("#bestand", str(opgeslagen))
        pagina.wait_for_selector("#tabel:not([hidden])")
        print(pagina.inner_text("#melding"))
        print("Site uit het bestand:", pagina.input_value("#host"))
        # IBAN staat rood (niet herkend): zet op "leeg laten".
        pagina.locator("tr.onbekend select").first.select_option("leeg")
        with pagina.expect_download() as dl:
            pagina.click("#exporteer")
        data = json.loads(pathlib.Path(dl.value.path()).read_text("utf8"))
        print("Export:", len(data["koppelingen"]["insurerb"]), "velden, hosts", data["hosts"])
        assert "Persoon" not in json.dumps(data)
        pagina.click("#code")
        assert pagina.input_value("#uitvoer").strip().startswith("koppelingen: [")

        # Het koppelbestand op het echte (nagebouwde) formulier.
        formulier = browser.new_page()
        formulier.goto((MAP / "testformulieren" / "7-ongevallen-onbekend.html").as_uri())
        laad(formulier)
        r = formulier.evaluate("([p, o]) => AdressenboekjeVul(p, o)",
                               [TESTPERSOON, {"portaal": "insurerb", "koppelingen": data["koppelingen"]["insurerb"]}])
        gekoppeld = [x for x in r["ingevuld"] if "(gekoppeld)" in x]
        print("Gekoppeld ingevuld:", len(gekoppeld), "/ leeg:", r["leeg"], "/ onbekend:", r["onbekend"])
        assert len(gekoppeld) == len(r["ingevuld"]) and r["leeg"] == ["IBAN"] and not r["onbekend"]
        pagina.set_viewport_size({"width": 1300, "height": 760})
        pagina.screenshot(path=str(MAP / "test" / "screenshot-koppelpagina.png"))
        browser.close()
    print("KOPPELPAGINATEST OK")


if __name__ == "__main__":
    main()
