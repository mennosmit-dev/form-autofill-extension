# Form autofill extension for HR onboarding

A Manifest V3 browser extension (Edge and Chrome) that takes a new employee's details once from the HR system and fills them into the other web portals that onboarding needs: pension, insurance, occupational health, travel card and so on. Prototype, version 0.6.

Internally the extension is called *Adressenboekje* ("little address book").

## The problem

When someone new joins, HR types the same data (name, initials, date of birth, address, email, start date, hours, salary, contract type) into about ten different portals. Every portal asks for it in its own way: initials with or without dots, postcode with or without a space, a date as one field or three dropdowns, gender as M/V, Man/Vrouw or a radio button, salary per month or per year. Retyping is slow and a typo in one portal is easy to miss.

Generic browser autofill does not help much here. It knows names and addresses, but not "hours per week", "contract type" or a field without a label next to a country code dropdown.

## What I built

- **Popup with two tabs.** Tab 1 reads the employee from the HR system ("Haal uit HRSuite"). Tab 2 is named after the site that is open and fills that page ("Vul deze pagina").
- **Every site is a portal.** A site the extension has not seen before gets its own portal with the general rules. A few known portals have their own rules in `extension/portalen.js` (for example: this one wants the private email, that one wants the travel card start date instead of the employment start date).
- **Learning mode.** The first time on a page, or when the page has changed, the popup shows a list of every field it found and what it plans to put in it. Red means "not recognised". HR fixes what is wrong and clicks Save. From then on the page fills directly.
- **Field matcher** (`extension/matcher.js`): pure logic without DOM, tested in Node.
- **Fill engine** (`extension/fill.js`): finds fields in the page, in open shadow DOM, in same-site iframes, in custom dropdowns (React-Select, MUI and others with `role=combobox` or `role=listbox`), in button groups that act as radio buttons and in `contenteditable` boxes. It fills, then reads every value back.
- **Report per field.** Filled and read back, not found, skipped, or failed with a reason ("value did not stick", "no matching option", "field is read-only", "too long for the field"). A field that already has a different value is not overwritten but flagged.
- **Never submits.** While filling, the extension blocks every submit event on the page. HR checks the form and submits it themselves.
- **Diagnose view.** For a page where something goes wrong: per label and field what the extension saw and why it did or did not match. "Copy without values" replaces every value by its kind (date, number with n digits, text with n characters), so the output can be shared without personal data.
- **Bookmarklet variant** (`bookmarklet/`) for a browser where installing an extension is not possible. General rules only.
- **Mapping page** (`koppelpagina/index.html`): a standalone page where you load a saved HTML copy of a portal page, map its fields and export the result as code for `portalen.js`.

## How matching works

For every input field the extension builds a fingerprint: `id`, `name`, normalised label, sequence number among fields with the same label, and field type. Then it decides what goes in, in this order:

1. **A learned or fixed mapping** for that fingerprint. Exact match first; then same `id`, then same `name`, then same label plus sequence number plus field type. IDs that change on every page load (jQuery UI date pickers like `dp1794240345411`, React `:r3:`, GUIDs, long numbers) are ignored, otherwise the page would look "changed" on every visit.
2. **The `autocomplete` attribute**, if the site sets a meaningful one.
3. **Keyword rules** on label, `aria-label`, placeholder, `name` and `id`, in that order of weight. Text is normalised first (`firstName` becomes `first name`, punctuation becomes spaces). Rules handle Dutch and English and the usual traps: "Startdatum dienstverband" is a start date, not a contract type; "Achternaam partner" is never the employee's own surname; a "Name" label above a field with placeholder "First Name" gets the first name.
4. **Field type** as a last resort (`type=email`, `type=tel`).

Then the value is formatted for that field: postcode without a space, initials with dots, house number and suffix split, dates as `DD-MM-YYYY` or in the pattern from the placeholder or split over day/month/year fields, gender and country mapped to whatever the dropdown offers (M/Man/Male, NL/Nederland/Netherlands). Contract type is matched by kind: "Vast", "Onbepaalde tijd" and "Contract voor onbepaalde tijd" are all permanent. If the options are ambiguous (codes like "01"), the extension picks nothing and reports the options it saw. Salary can be converted per portal (monthly or yearly amount, comma or dot as decimal separator).

Reading the HR system works from what is on screen (label/value pairs via `<label for>`, `aria-labelledby`, `aria-label`, a table with one row, or "Label: value" in one block, never via CSS classes) and, if present, from field definitions that the page already ships in an inline script. The extension waits until the page stops changing (1 second quiet, at most 6 seconds) before it reads.

## Privacy by design

- **Personal data lives in `chrome.storage.session` only.** That is in memory; it is gone when the browser closes.
- **`chrome.storage.local` holds no personal data**: only field mappings (field names, never values), which site belongs to which portal, and per-portal settings. The tests check this explicitly.
- **Nothing leaves the browser.** The extension makes no network requests, has no API keys and no backend. Search the code for `fetch`, `XMLHttpRequest` or `sendBeacon`: there are none.
- **Minimal permissions**: `storage`, `activeTab`, `scripting`. Host access is optional and asked per site, at the moment you click.
- **Mapping exports contain field names only**, so they can be shared to improve the fixed mappings.

## Load the unpacked extension

1. Open `edge://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder.
3. Pin the icon. After a code change, click **Reload** on the extensions page; mappings are kept.

To try it without an HR system: open the popup, go to **Meer** and click the test person button. That fills in an invented person. Then open one of the mock forms in `testformulieren/` (serve the folder over HTTP, for example `python -m http.server` inside `testformulieren`) and click **Vul deze pagina**.

`test/testomgeving.py` starts a local server on `http://localhost:8765` with all mock forms and opens Edge.

## Run the tests

Unit tests (Node 18 or newer, no dependencies):

```
npm test
```

which runs `node --test test/matcher.test.js test/v06.test.js`.

Browser tests load the real extension in headless Edge through Playwright, against the mock forms in `testformulieren/`. They need Python, `pip install playwright` and Microsoft Edge installed (they use `channel="msedge"`, so no Playwright browser download is needed):

```
python -I -X utf8 test/extensietest.py
python -I -X utf8 test/v06test.py
python -I -X utf8 test/robuusttest.py
python -I -X utf8 test/plaktest.py
python -I -X utf8 test/browsertest.py
python -I -X utf8 test/wijzigtest.py
python -I -X utf8 test/koppelpaginatest.py
```

`-X utf8` is only needed on Windows for the arrows in the output. Some tests write screenshots to `test/`.

## Measured test results

Run on 11 November 2026, Windows 11, Node 24, Edge headless via Playwright, on this repository.

| Test | What it covers | Result |
| --- | --- | --- |
| `npm test` | matcher rules, formats, HR system conversion, portal per site, contract type, salary units, unstable IDs, script parsing, fixed mappings | 36 of 36 pass |
| `extensietest.py` | storage, learning mode, fill with learned mapping | OK |
| `v06test.py` | migration, reading a live HR screen, diagnose, contract type, salary, overwrite protection, a portal with unlabeled fields and changing IDs | 22 of 22 checks OK |
| `robuusttest.py` | custom dropdowns, input masks, shadow DOM, contenteditable, late-loading fields, unknown site, iframe | 19 of 19 checks OK |
| `plaktest.py` | read HR screen, paste HTML, map and fill | OK |
| `browsertest.py` | seven mock forms including a four-step wizard, plus the bookmarklet | 12 of 12 checks OK |
| `wijzigtest.py` | first visit, direct fill, changed page, paste fallback | OK |
| `koppelpaginatest.py` | mapping page: load, correct, export, fill | OK |

These are results on mock forms. The mock forms imitate the behaviour of common UI libraries and of the portals' public manuals; they are not copies of real portal HTML.

## Limitations

- **Closed shadow roots** (`mode: 'closed'`) cannot be seen from outside. Fields inside them are not found.
- **Cross-site iframes**: access is requested for iframes that are visible when the popup opens and larger than 200 by 100 pixels. An iframe that appears later needs a second click.
- **Calendar-only date pickers** (read-only input) are reported as read-only, not filled.
- **Dropdowns that load options from a server** and take longer than about a second can return "no matching option". Clicking again usually works.
- **Multi-select lists**, and options that do not exist in the list (a department with a different name), are reported, not guessed.
- **Rich text editors** with their own state (Lexical, ProseMirror) get text through the standard input command. That works for most, not all.
- **Multi-step forms**: fields behind a "Next" button are not filled automatically. Click "Vul deze pagina" on each step.
- **Not yet validated on the real portals** with version 0.6. All automated tests run on mock forms.
- It is a prototype: no store listing, no auto-update, no central management of mappings.

## What was replaced for this public version

This code comes from an internship project. Before publishing I replaced everything that points to a real organisation, product or person:

- Real HR, insurance, health and travel card products are renamed to invented ones: **HRSuite** (the HR system), **Insurer A**, **Insurer B**, **HealthDesk** (occupational health portal) and **TravelCard**. File names of the mock forms follow the same names.
- All portal URLs are replaced by addresses under the reserved `.example` domain. Tests run on `localhost` and `127.0.0.1` only.
- The field IDs that the HR system ships in its page script are replaced by invented IDs (`p_last_name`, `e_contract_type`, and so on), and the script function name is invented.
- The fixed field mapping for HealthDesk and its mock form use changed labels.
- The real exported mappings are left out. `voorbeeld/voorbeeld-koppelingen.json` is a small invented example of the export format.
- The default department is "Voorbeeld BV". Names of colleagues are replaced by roles ("HR", "de beheerder").
- Left out entirely: a script that ran the fill logic against real public websites, screenshots of real sites, and the packed `.zip`.
- The test person is invented and uses `.example` email addresses.

## Code comments and UI are in Dutch

The users were Dutch, so the UI text, code comments, identifiers and test output are in Dutch. A few words that help when reading the code: *veld* = field, *koppeling* = mapping, *portaal* = portal, *gegeven* = data item, *invullen/vullen* = fill, *lezen* = read, *rapport* = report, *leeg* = empty, *overslaan* = skip, *dienstverband* = contract type, *in dienst* = start date.

## Layout

```
extension/        the Manifest V3 extension (popup, matcher, fill engine, learning mode, portal rules)
bookmarklet/      bookmarklet build (node bookmarklet/build.js) and the generated page
koppelpagina/     standalone mapping page
testformulieren/  invented mock forms used by the tests
test/             Node unit tests and Playwright browser tests
voorbeeld/        invented example of a mapping export
```

## License

MIT, see `LICENSE`.
