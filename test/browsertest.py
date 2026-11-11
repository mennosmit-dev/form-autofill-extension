"""Test de invullogica in echte Edge op de nagebouwde formulieren, per portaal, plus de gebouwde bookmarklet.
Draai: python test/browsertest.py  (vereist: pip install playwright; gebruikt de geïnstalleerde Edge)."""
import json
import pathlib
import re
import urllib.parse

from playwright.sync_api import sync_playwright

MAP = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ["matcher.js", "portalen.js", "fill.js"]

# Verzonnen testpersoon, geen echte gegevens. Zelfde sleutels als het tabje HRSuite.
TESTPERSOON = {
    "bsn": "111222333", "voorletters": "TJ", "voornamen": "Test Jan", "roepnaam": "Test", "tussenvoegsel": "van der",
    "achternaam": "Persoon", "tussenvoegselPartner": "de", "achternaamPartner": "Partner", "geslacht": "V",
    "geboortedatum": "1995-03-07", "straat": "Teststraat", "huisnummer": "12", "toevoeging": "A", "postcode": "1234 ab",
    "woonplaats": "Utrecht", "land": "Nederland", "emailWerk": "test.persoon@werk.example", "emailPrive": "test.persoon@prive.example",
    "telefoon": "030-1234567", "mobiel": "06 12345678", "datumInDienst": "2026-11-01", "functie": "Consultant",
    "afdeling": "Voorbeeld BV", "urenPerWeek": "32", "fulltimeUren": "40", "maandloon": "3500", "dertiendeMaand": "nee",
    "taal": "Nederlands",
}

# (bestand, portaal, aantal schermen, wat het portaal na "verstuur" hoort te ontvangen)
GEVALLEN = [
    ("1-klassiek-nl.html", None, 1, {"f1": "T.J.", "f2": "van der", "f3": "Persoon", "f4": "07-03-1995", "f5": "Teststraat",
                                      "f6": "12", "f7": "1234AB", "f8": "Utrecht", "f9": "Consultant", "f10": "Voorbeeld BV", "f11": ""}),
    ("2-engels-zonder-labels.html", None, 1, {"firstName": "Test", "lastName": "Persoon", "emailAddress": "test.persoon@werk.example",
                                               "streetAddress": "Teststraat 12 A", "zipCode": "1234AB", "city": "Utrecht",
                                               "country": "NL", "dateOfBirth": "1995-03-07", "password": ""}),
    ("3-framework-achtig.html", None, 1, {"Roepnaam": "Test", "Achternaam": "Persoon", "E-mailadres": "test.persoon@werk.example",
                                           "Telefoonnummer": "0612345678", "Datum in dienst": "01-11-2026", "Afdeling": "Voorbeeld BV",
                                           "Bruto maandsalaris": "3500"}),
    ("4-insurera-vier-schermen.html", "insurera", 4, {
        "bsn": "111222333", "voorletters": "T.J.", "voornamen": "Test Jan", "tussenvoegsel": "van der", "achternaam": "Persoon",
        "geslacht": "female", "gebdag": "7", "gebmaand": "3", "gebjaar": "1995", "postcode": "1234AB", "huisnummer": "12",
        "toevoeging": "A", "straat": "Teststraat", "woonplaats": "Utrecht", "email": "test.persoon@prive.example",
        "telefoon": "0612345678", "indienst": "01-11-2026", "fulltimejaarsalaris": "56700", "parttime": "80", "burgerlijkestaat": ""}),
    ("5-healthdesk.html", "healthdesk", 1, {
        "personeelsnummer": "", "achternaam": "Persoon", "tussenvoegsels": "van der", "roepnaam": "Test", "voorletters": "T.J.",
        "geslacht": "1", "geboortedatum": "07-03-1995", "tussenvoegselpartner": "de", "achternaampartner": "Partner", "land": "NL",
        "postcode": "1234AB", "huisnummer": "12", "toevoeging": "A", "extra": "", "straat": "Teststraat", "plaats": "Utrecht",
        "email_werk": "test.persoon@werk.example", "email_thuis": "test.persoon@prive.example", "telefoon_werk": "0301234567",
        "mobiel": "0612345678", "taal": "nl-NL", "startfin": "01-11-2026", "kostenplaats": "", "werkgever": "1", "afdeling": "11",
        "startdienst": "01-11-2026", "functie": "1", "uren": "32", "loonbegrip": "m", "loonbedrag": "3500"}),
    ("6-travelcard-kaarthouder.html", "travelcard", 1, {
        "aanhef": "mevr", "voorletters": "T.J.", "tussenvoegsel": "van der", "achternaam": "Persoon", "geboortedatum": "07-03-1995",
        "email": "test.persoon@werk.example", "telzakelijk": "0301234567", "telmobiel": "0612345678", "straat": "Teststraat",
        "huisnummer": "12", "toevoeging": "A", "postcode": "1234AB", "woonplaats": "Utrecht", "afdeling": "a1",
        "kostenplaats": "", "personeelsnummer": "", "ingangsdatum": "2026-11-01"}),
    ("7-ongevallen-onbekend.html", "insurerb", 1, {
        "naam": "Test van der Persoon", "gd_d": "07", "gd_m": "03", "gd_j": "1995", "geslacht": "V", "hnr": "12", "htv": "A",
        "postcode": "1234AB", "telefoon": "0612345678", "start": "01/11/2026", "maandloon": "3500", "iban": ""}),
]

# Een geleerde koppeling gaat voor de regels: HR koppelt "Naam verzekerde" aan alleen de achternaam en IBAN aan "leeg laten".
KOPPELINGEN = [
    {"veld": {"id": "nv", "name": "naam", "label": "naam verzekerde", "nr": 1}, "sleutel": "achternaam"},
    {"veld": {"id": "iban", "name": "iban", "label": "iban", "nr": 1}, "sleutel": "leeg"},
]


def verstuur_en_lees(pagina):
    pagina.locator("button").last.click()
    return json.loads(pagina.inner_text("#uit"))


def vergelijk(naam, ontvangen, verwacht):
    fouten = {k: (ontvangen.get(k), v) for k, v in verwacht.items() if ontvangen.get(k) != v}
    print(("OK   " if not fouten else "FOUT ") + naam, "" if not fouten else fouten)
    return not fouten


def laad(pagina):
    for s in SCRIPTS:
        pagina.add_script_tag(path=str(MAP / "extension" / s))


def main():
    subprocess_build()
    bookmarklet = re.search(r'href="(javascript:[^"]+)"', (MAP / "bookmarklet" / "adressenboekje.html").read_text("utf8")).group(1)
    bm_code = urllib.parse.unquote(bookmarklet[len("javascript:"):])
    alles_ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        for bestand, portaal, schermen, verwacht in GEVALLEN:
            url = (MAP / "testformulieren" / bestand).as_uri()
            pagina = browser.new_page()
            pagina.goto(url)
            laad(pagina)
            rapporten = []
            for scherm in range(schermen):
                rapporten.append(pagina.evaluate("([p, o]) => AdressenboekjeVul(p, o)", [TESTPERSOON, {"portaal": portaal}]))
                if scherm < schermen - 1:
                    pagina.locator(".stap:not([hidden]) .volgende").click()
            alles_ok &= vergelijk(f"{portaal or 'algemeen':10} {bestand}", verstuur_en_lees(pagina), verwacht)
            for r in rapporten:
                if r["onbekend"]:
                    print("       niet herkend:", r["onbekend"])
                if r["controle"]:
                    print("       controle:", r["controle"])
            pagina.close()

        # Geleerde koppelingen.
        pagina = browser.new_page()
        pagina.goto((MAP / "testformulieren" / "7-ongevallen-onbekend.html").as_uri())
        laad(pagina)
        r = pagina.evaluate("([p, o]) => AdressenboekjeVul(p, o)", [TESTPERSOON, {"portaal": "insurerb", "koppelingen": KOPPELINGEN}])
        ontvangen = verstuur_en_lees(pagina)
        alles_ok &= vergelijk("koppeling  naam verzekerde → achternaam, IBAN leeg", ontvangen, {"naam": "Persoon", "iban": ""})
        alles_ok &= vergelijk("koppeling  IBAN staat bij leeg gelaten", {"leeg": "IBAN" in " ".join(r["leeg"])}, {"leeg": True})
        pagina.close()

        # De gebouwde bookmarklet (algemene regels, plakken in de prompt), op de eerste drie formulieren.
        for bestand, portaal, schermen, verwacht in GEVALLEN[:3]:
            pagina = browser.new_page()
            meldingen = []
            pagina.on("dialog", lambda d: (meldingen.append(d.type), d.accept(json.dumps(TESTPERSOON)) if d.type == "prompt" else d.accept()))
            pagina.goto((MAP / "testformulieren" / bestand).as_uri())
            pagina.evaluate(bm_code)
            # Sinds v0.5 vult de bookmarklet asynchroon (controle na invullen): wacht op de eindmelding.
            for _ in range(100):
                if "alert" in meldingen:
                    break
                pagina.wait_for_timeout(100)
            alles_ok &= vergelijk("bookmarklet " + bestand, verstuur_en_lees(pagina), verwacht)
            pagina.close()
        browser.close()
    print("\nALLES OK" if alles_ok else "\nER GING IETS MIS")


def subprocess_build():
    import subprocess
    subprocess.run(["node", str(MAP / "bookmarklet" / "build.js")], check=True, capture_output=True)


if __name__ == "__main__":
    main()
