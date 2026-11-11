"""Zelf de route van v0.3 testen zonder HRSuite: start een webservertje op http://localhost:8765
met de nagebouwde schermen (testformulieren/) en opent het nagebouwde HRSuite-scherm in Edge.
De extensie werkt hier gewoon via het icoon (activeTab), net als op een echte site. Stoppen: Ctrl+C."""
import functools
import pathlib
import subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

MAP = pathlib.Path(__file__).resolve().parent.parent / "testformulieren"
POORT = 8765


def main():
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(MAP))
    handler.log_message = lambda *a: None
    server = ThreadingHTTPServer(("127.0.0.1", POORT), handler)
    basis = f"http://localhost:{POORT}/"
    print("Nagebouwd HRSuite-scherm:", basis + "8-hrsuite-medewerker.html")
    print("Nagebouwde portalen:  ", basis + "4-insurera-vier-schermen.html", "|", basis + "5-healthdesk.html", "|", basis + "6-travelcard-kaarthouder.html")
    print("Stoppen met Ctrl+C.")
    subprocess.Popen(["cmd", "/c", "start", "msedge", basis + "8-hrsuite-medewerker.html"])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
