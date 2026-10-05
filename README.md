# Thermotolerance Explorer — browser version

This is a separate Shinylive build of the existing explorer. R runs in the
browser. The local/server app in `../thermotolerance_explorer` is unchanged.

## Everyday use

1. Open the website (or the local preview below).
2. Choose your **SKKU CSV**. Optionally choose the **JHU legacy CSV** too.
3. Use **Example comparison** for the familiar SKKU default, or choose filters.
4. Download plots, selected data, AUC/pairing results, or a saved-view JSON.

Selecting a replacement file resets filters and manual exclusions so row-based
exclusions are not silently carried over to changed data. The other loaded
source stays available. A JHU-only session is also supported. Invalid files show
an error and leave the last valid dataset in place.

To update your data, choose the newer CSV. No website rebuild, SSH, screen or R
restart is needed. A browser refresh clears the loaded files; select them again.
Saved-view JSON files store settings, not data. Load your CSVs before restoring a
view. Fingerprint warnings identify changed or missing source files.

## Privacy and access

No experimental CSVs are bundled with this site. File selection is handled by
Shinylive inside the browser; the application does not send selected data to a
remote data server. Browser service-worker requests simulate Shiny's local file
upload/download endpoints. The app does not save CSVs in persistent browser
storage. Downloaded exports remain on the computer, so handle those appropriately
on shared computers.

GitHub Pages normally makes the app interface and source code public. Local CSV
selection keeps experimental data out of the publication, but is not a login
system. If the interface itself must be restricted, use eligible private Pages
or another authenticated static host. Do not commit the parent Thermo_SKKU2
repository or its data to publish this app. Keep private CSVs in your approved lab
file-sharing location so they can be selected on meeting-room computers.

## Preview on this Mac

The browser build is in `site/`. In a Mac Terminal, run:

```sh
cd /Users/hoyon/Desktop/Thermo_SKKU2
python3 thermotolerance_explorer_shinylive/preview.py
```

Open **http://127.0.0.1:8765**. This serves static files only; all analysis runs in
the browser. Keep the terminal open during this local preview. Once published,
visitors use the website address and do not run this command. Opening index.html
by double-clicking is not supported because Shinylive needs HTTP/HTTPS and a
service worker. First loading downloads R and its packages and may take time.

## Build or refresh from the original app

The generated `app/` directory contains allowlisted shared code and browser-only
adapters. Do not edit it directly. Edit `browser/` for file-loading/browser
behavior; edit the original explorer's R functions for scientific changes.

```sh
cd /Users/hoyon/Desktop/Thermo_SKKU2
Rscript --vanilla thermotolerance_explorer_shinylive/build.R
```

The build copies the shared analysis modules byte-for-byte, adapts the existing
UI/server with checked transformations, exports static files, and audits the
published input list. It fails if the expected source layout changes or extra
files have appeared in `app/`. It never copies the project data directory.
`source-manifest.json` records the generated app hashes. Shinylive assets are
pinned to 0.10.12; this initial build uses shinylive 0.5.0. Package binaries may
have versions different from the desktop R installation; rerun validation after
changing the runtime or dependencies.

For a new build machine, install R, Python 3 and the `shinylive` R package first.
The build may download assets to Shinylive's standard user cache. `library/` in
this folder is a local build dependency directory and must not be published.

## Publish to GitHub Pages

Nothing has been published automatically. Use a **separate repository** containing
only these items from this folder:

- `app/`
- `source-manifest.json`
- `build.R` and `audit.py`
- `.github/workflows/pages.yml`
- `.gitignore`, this README and `VALIDATION.md`

Do not upload `data/`, any CSV, `library/`, `tools/`, or `tests/artifacts/`.
The last directory can contain private test exports/screenshots.

In the new repository, select **Settings → Pages → Source: GitHub Actions**.
Then select **Actions → Publish browser explorer → Run workflow**. The workflow
exports the already generated app (`--export-only`), audits it, and publishes only
`site/`. Its displayed deployment URL is the address visitors use.

After future code changes, rebuild locally, validate, copy the updated `app/` and
`source-manifest.json` into that separate repository, and run the workflow again.
CSV updates do not require this process. For another static host, publish only
the audited `site/` directory.

## Validation

```sh
Rscript --vanilla thermotolerance_explorer_shinylive/tests/verify.R
python3 thermotolerance_explorer_shinylive/audit.py
```

The R checks compare uploaded data against the existing loader and test empty,
one-source, two-source, replacement, rejection, removal, saved views and exports.
They read local project CSVs for verification only; those files are not copied
into the app or site. Browser checks use the separate `tests/browser.mjs` script,
which requires Playwright in `tools/` and a running preview. Its outputs stay in
ignored `tests/artifacts/` and must not be published.

See `VALIDATION.md` for the current tested behavior and limitations.

References: [Shinylive](https://posit-dev.github.io/r-shinylive/),
[GitHub Pages access](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site).
