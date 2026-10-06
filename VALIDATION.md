# Validation record — browser explorer

Last validated: **2026-10-06**, against the build in `site/` generated from the
current `app/` (hashes in `source-manifest.json`). Rerun every check below after
rebuilding, changing the original explorer, or changing Shinylive or packages.

## How to rerun

From `/Users/hoyon/Desktop/Thermo_SKKU2`:

```sh
Rscript --vanilla thermotolerance_explorer_shinylive/tests/verify.R
python3 thermotolerance_explorer_shinylive/audit.py
python3 thermotolerance_explorer_shinylive/preview.py            # keep running
node thermotolerance_explorer_shinylive/tests/browser.mjs        # second terminal
Rscript --vanilla thermotolerance_explorer_shinylive/tests/compare_browser.R
```

`compare_browser.R` reads the exports written by `browser.mjs`, so run it after
a passing browser run. Outputs go to `tests/artifacts/`, which contains real
experimental exports and must never be published.

## Results (2026-10-06)

| Check | What it covers | Result |
|---|---|---|
| `tests/verify.R` (desktop R) | Uploaded CSVs normalize identically to the original loader (data and MD5 provenance); JHU defaults; empty/one-/two-source snapshots; rejection of missing columns, header-only, unusable and duplicate-column CSVs; app starts with no data; load, replace, reject (last good data kept), exclusion reset on replacement, removal; filtered values match `filter_data()`; PDF, PNG, CSV and saved-view exports | PASS (26 expectations) |
| `audit.py` | Exported inputs equal the 11 allowlisted files byte-for-byte; no CSV anywhere in `site/`; no file ≥ 100 MB | PASS |
| `tests/browser.mjs` (headless Chrome) | Exported site starts in the browser; SKKU CSV loads (8,629 observations); Example comparison renders the interactive plot; tabs switch (guards against Bootstrap being dropped from the page, which happened in an earlier build); downloads of selected rows, summary, figure PDF/PNG, saved view and AUC CSV; paired-date example renders both plots and exports the paired CSV (checked to be N2.thaw vs N2.therm) and paired PDF; SKKU + JHU together; JHU only; back to empty; no JavaScript errors, no R errors, no non-GET requests to any external host | PASS |
| `tests/compare_browser.R` | Files downloaded from the browser match desktop R: observation IDs, survival %, summary curve/mean/SE, all-selected AUC (tolerance 1e-10) | PASS (7 expectations) |
| Separate-repository export | Only the files listed in README “Publish to GitHub Pages” copied to a clean folder; `build.R --export-only` run as the workflow does | PASS; identical `app.json` and identical package binaries |
| GitHub Actions workflow | First run of `pages.yml` in [hoyonh/thermotolerance-explorer](https://github.com/hoyonh/thermotolerance-explorer) ([run 37350695905](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/37350695905), Ubuntu 24.04 runner): package install, export, audit, Pages deploy | PASS |
| Safari engine (Playwright WebKit) | Shows the “Safari is not supported yet” notice and disables both file pickers; Chrome shows no notice | PASS (notice only; the app itself does not run in Safari) |
| Live site (redeployed, [run 37398094467](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/37398094467), Ubuntu 24.04) | https://hoyonh.github.io/thermotolerance-explorer/ serves an `app.json` identical to the local build and the same 38 package binaries; no CSV present; `tests/browser.mjs` (including the tab check) rerun against the live URL; Safari notice confirmed in WebKit; uploads confirmed to be answered by the in-browser service worker, with no request leaving for any other host | PASS |

Environment: macOS 26.6.2; desktop R 4.5.2; webR R 4.6.0 (wasm32); shinylive R
package 0.5.0; Shinylive assets 0.10.12; Chrome 154; Playwright 1.63.0; Node 26.

## Package versions in the browser

The WebAssembly binaries come from `repo.r-wasm.org` at build time, not from the
desktop library. In this build the browser runs ggplot2 4.0.3 and plotly 4.12.0,
while desktop R has ggplot2 4.0.1 and plotly 4.12.1. Numeric parity above passed
with these versions. Exports run in the browser may still differ slightly in
appearance (fonts, spacing) from desktop exports. Building on another day can
bundle newer binaries; shinylive then prints “Package version mismatch”
warnings. Treat each build as unvalidated until the checks above pass.

## Not covered / known limitations

- The workflow runner is pinned to `ubuntu-24.04`, the image the passing run
  used. Changing it, or the R/action versions, needs a new run and a recheck of
  the live site.
- **Safari is not supported.** webR exceeds WebKit's smaller call stack during
  app startup (`RangeError: Maximum call stack size exceeded`; plain R recursion
  fails at ~325 levels in WebKit vs ~450 in Chrome). Upstream:
  [posit-dev/r-shinylive#204](https://github.com/posit-dev/r-shinylive/issues/204),
  open. The app shows a notice instead. This includes every browser on iPhone and
  iPad. Re-test after a Shinylive/webR update.
- Only Chrome on macOS was tested end to end. Edge (same engine as Chrome),
  Firefox, Windows and meeting-room computers should be checked by hand once
  (load a CSV, plot, one download).
- Plotting and exports were exercised with the SKKU file; the JHU file was
  tested for loading, combining and removal only.
- Browser checks use the local project CSVs and Chrome path on this Mac, so they
  are not part of the GitHub workflow.
- First load downloads R and packages (about 115 MB of static files); expect a
  slow start on a new computer or after a cache clear.
- The browser console reports one harmless 404 (the site has no favicon).
- A page refresh clears loaded CSVs by design; saved views store settings only.
