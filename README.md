# Thermotolerance Explorer (JavaScript)

> **DRAFT, local branch `js-viewer`. Not published.** No data are bundled. Any public data release needs
> co-author approval of scope and timing first. The previous Shinylive version is preserved at tag `shinylive-final`.

A browser-only viewer for *C. elegans* acute-thermotolerance survival data. Everything is computed in the
browser; nothing is uploaded. No framework and no build step: `dist/` is the site.

## Using it

Open the published page (URL to be added) in any current browser, or run it locally:

```sh
python3 tools/preview.py --open
```

Data come from one of three places, all through the same CSV loader:

1. **Bundled data**, if the site ships any: listed in `dist/data/manifest.json`; the first entry marked `default`
   opens on load and other entries are chosen from a menu. Each file is checked against its SHA-256.
2. **Your own CSV** (SKKU CSV, optional JHU legacy CSV, optional glossary CSVs) with the file pickers.
3. **Project data folder**, only when started with `tools/preview.py` next to a `data/` folder.

With no bundled data (the current state) the viewer asks for your CSV, as the Shinylive version did.

## Bundled data (not yet used)

`dist/data/manifest.json`:

```json
{ "manifest_version": 1,
  "datasets": [ { "id": "ms", "label": "Manuscript-related SKKU data", "source": "SKKU",
                  "file": "skku_manuscript.csv", "sha256": "<64 hex>", "default": true } ],
  "glossary": [ "glossary.csv", "config_glossary.csv" ] }
```

CSVs are git-ignored; an approved file is added deliberately with `git add -f`. `tools/audit_data.py` (run by the
publishing workflow) fails if the site contains a CSV the manifest does not list, or one whose hash differs.
Anything in `dist/` is public, whether or not the interface shows it by default.

## Plate-quality filter

The sidebar option **Apply existing analysis exclusions** is on by default and applies the manuscript's rules (listed under
Methods in the app): a plate is kept only if its total across all five count categories (alive, dead, ruptured, suicide,
missing) is at least 15, and SKKU plates with the exact note "10 total" are dropped; JHU legacy exclusions are listed in
the Methods tab. Records are never deleted from the data. Switching the option off includes every valid plate. In the
manuscript data (20 °C, OP50, standard configuration, 2-3.5 h) that adds 19 small plates (10 or 11 worms) across 14
genotypes and moves individual genotype AUCs by up to about 1 percentage point. Figures and tests use the default (on).

## Checks

```sh
npm test                 # unit + numerical comparison with the R code + interface modules (Node 20+)
npm install              # once, for the browser checks
npm run test:browser     # the real page in Chrome (test:safari for WebKit)
npm run test:rowfx        # row-position view vs R (needs R, the lab R explorer next to this folder, and the CSVs)
npm run test:bundled     # manifest behaviour on a plain static server (test:bundled:safari for WebKit)
THERMO_MANUSCRIPT_CSV=<thermotolerance.csv> npm run test:manuscript   # default view reproduces the manuscript's AUCnorm (needs R)
```

`npm test` needs reference output generated from the lab's R code and CSVs (`npm run fixtures`, needs R and the
private data). Those fixtures and `tests/artifacts/` are git-ignored and must never be published.

Last local run (2026-11-22): 55 unit, 1,429 numerical (R), 161 module, 116 browser (Chrome and WebKit), 19 bundled-data
(Chrome and WebKit), 73 manuscript-AUCnorm and 291 row-position (R) checks, all passing.

## Status and known limits

- The analyses are checked against R. The **row-position view** (`rowfx.js`) was compared with an independent R calculation
  (`tools/ref_rowfx.R`, normalisation and filters from the lab R explorer) and with the values behind Supplementary Fig. 14:
  row means, within-genotype and within-genotype-and-run deviations, plate counts and exclusion rules agree to 1e-13 (`npm run test:rowfx`,
  291 checks). Plates recorded at a non-integer row (one at row 5.5 in the SKKU data) are left out of the row comparison, as in the
  figure, and the page says so. The view is descriptive: subtracting a genotype's mean does not show that strain, run or date
  differences cannot contribute to a row pattern.
- AUCnorm bootstrap intervals are not computed; the *All selected data* AUC with equal-observation weighting reproduces the
  point estimate used in the manuscript.
- One deliberate difference from the lab's R explorer: genotype labels are kept as recorded (the R explorer renames a legacy JHU label); `tools/make_fixtures.R` applies the same to its reference inputs.
- `tools/make_fixtures.R` expects the lab's R explorer sources next to this folder; it is a development tool only.
- To cite a fixed version, use the archived release (DOI to be added).
