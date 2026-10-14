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

## Update: condition defaults and manuscript input (2026-10-06)

The private manuscript CSV was checked against GitHub's blob SHA and loaded
through the SKKU adapter without conversion (4,209 input rows). The CSV remains
outside the published app. An optional first argument to `tests/verify.R` or
`tests/browser.mjs` supplies its local path for repeat testing.

Headless Chrome passed the full upload, plotting, export and removal checks,
including manuscript loading and restoring all four condition defaults after
replacing that file. Downloaded results passed all seven desktop parity checks.
An intermediate run hit a webR export error while reactive updates were still
settling; the test now waits for the app to become idle before exporting, and
the complete rerun passed without JavaScript or R errors. The manuscript plot
test narrows genotype to respect the existing 30-curve limit.

The original desktop `verify.R` passed its functional checks. Its historical
whole-project fingerprint assertion fails because seven pre-existing project
files differ from the old baseline (R session files, source spreadsheets/CSV,
resources and a script). That baseline was not rewritten.

**Load manuscript dataset** fetches the CSV pinned to commit `d6cc0ba` from
`raw.githubusercontent.com` and passes its exact bytes to the SKKU loader.
`tests/verify.R` checks that path (same MD5 and file name as the source file), and
`tests/browser.mjs` checks both the private-repository message and a successful
load by intercepting the GitHub request. A real click currently returns GitHub's
404, which the page can read, and shows the “not public yet” message.

This update was deployed in [run 37416316328](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/37416316328)
(commit `140b5d9`, Ubuntu 24.04). The live site serves an `app.json` identical to the tested
build; `tests/browser.mjs` passed against the live URL (defaults, tabs, both manuscript-button
paths, exports); a real click on the live button shows the “not public yet” message; and the
Safari notice still appears in WebKit.

## Update: up to ten equal-date periods; start-up wording (2026-10-14)

**Equal numbers of assay dates** now allows 2–10 periods (was 2–6). The `group_dates_n()` match
in `verify_auc.R` now covers 2–10 periods; `tests/browser.mjs` checks the choices are 2 to 10.
The start-up message now says the 40 MB download also happens on the first visit after the app
is updated, as seen after deployments. `tests/browser.mjs`,
`tests/verify.R`, `compare_browser.R` and `audit.py` passed. Deployed in
[run 38520060542](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38520060542)
(commit `41e48fa`); the live `app.json` is identical to the tested build, the live page shows the
new wording, and the full `tests/browser.mjs` passed against the live site.

## Update: latest CSV shown first; combined-source notice (2026-10-14)

Choosing a CSV now shows only that source; any other loaded file stays loaded and can be
ticked under **Data sources**. Condition defaults still cover every loaded file, so ticking the
other source shows its data. Removing a file shows the remaining one. When SKKU and JHU are both
in the selection, the notice above the plot suggests examining them separately, unless Source is
the colour or panel choice (also in the desktop app). New `verify.R` tests for the notice;
`tests/browser.mjs` checks that loading JHU after SKKU shows JHU alone without the notice, and
that ticking SKKU too shows it. The paired-example readiness check in `browser.mjs` now polls
only while Shiny is idle, with a 15-second fetch timeout: polling during a re-render once failed
inside Shinylive's virtual server ("Empty or null key when converting atomic vector") and once
left the test waiting indefinitely. Deployed in
[run 38516289560](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38516289560)
(commit `8ff961d`); the live `app.json` is identical to the tested build and the full
`tests/browser.mjs` passed against the live site (with a longer start-up allowance for the
first download).

## Update: equal-date time periods (2026-10-14)

**Compare time periods** has a **Periods from** choice: **Cutoff dates** (unchanged) or **Equal
numbers of assay dates**, which splits the selection's distinct assay dates into 2–6 consecutive
periods as `group_dates_n()` in `scripts/plot_functions.R` does. A **Current selection** list shows
each period's dates and observations; too few dates for the chosen number stops with a message.
New `verify_auc.R` tests include a match against `group_dates_n()` itself (parsed from
`plot_functions.R`) for 2–6 periods on the real N2.thaw dates. `tests/browser.mjs` selects four
equal periods and checks the summary and legend; layout checked by screenshot;
`tests/verify.R`, `compare_browser.R` and `audit.py` passed. Deployed with the update above (commit `8ff961d`).

## Update: loaded date coverage (2026-10-13)

Under Assay dates, the sidebar lists each loaded source's first and last date and the number
of undated observations, with a **Use full range** link that resets the fields to the loaded
span. New `verify.R` tests; `tests/browser.mjs` types an out-of-range start, clicks the link and
checks the first date returns. Layout checked by screenshot; `tests/verify.R`,
`compare_browser.R` and `audit.py` passed. Deployed in
[run 38383034054](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38383034054)
(commit `6a6dd94`); the live `app.json` is identical to the tested build and the live sidebar
shows the coverage for both sources.

## Update: assay dates accept any typed date (2026-10-13)

The Assay dates fields no longer have a minimum and maximum. With the limits, bootstrap-datepicker
replaced a typed date outside the CSV's range with another value (start 2024-01-01 became
2026-10-13). The fields still start at the loaded data's first and last dates. A start after the
end now gives "Assay dates: enter both dates, with the start no later than the end." Checked by
typing dates inside and outside the range in Chrome; new `verify.R` tests; `tests/browser.mjs`,
`tests/verify.R`, `compare_browser.R` and `audit.py` passed. Deployed in
[run 38378606194](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38378606194)
(commit `a7a3860`); the live `app.json` is identical to the tested build and the typing check
gave the same results on the live site.

## Update: start-up message (2026-10-13)

`loading.html` (inserted by `build.R` through Shinylive's `include_after_body`) shows a short
message, an elapsed-time counter and, after 45 s, a "still loading" line under the spinner. It
removes itself when the app's page appears. No extra downloads. Checked with Chrome throttled to
about 1 MB/s (message shown, slow line at 45 s, removed when the app appeared after about 103 s);
`tests/browser.mjs` and `audit.py` passed. Deployed in
[run 38351511679](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38351511679)
(commit `32c0ee1`); on the live site the message appeared, showed the slow line, and was removed
when the app appeared; the live `app.json` is identical to the tested build.

## Update: no hidden settings (2026-10-13)

Settings are no longer inside collapsed sections: "Dates, hours & experiments" in the sidebar
and "Matching rules" in the paired-date panel are always shown, and **Dates compared** moved
from the sidebar to the plot controls next to Color / compare. Only the AUC audit table (output,
not settings) remains collapsible. Layout checked by screenshot; `tests/browser.mjs`,
`tests/verify.R`, `compare_browser.R` and the desktop functional checks passed.
Deployed in [run 38349066110](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38349066110)
(commit `9a31af6`); the live `app.json` is identical to the tested build and `tests/browser.mjs`
passed against the live URL. github.com refused HTTPS connections from this Mac at the time, so
the commit was pushed through the GitHub API with identical commit IDs.

## Update: setting comparisons and date selection (2026-10-13)

**Paired-date comparison** can compare by **Configuration** or **Synchronization** as well as
strain and genotype. The compared setting is not matched; all other conditions are, plus the same
strain/stock. These modes ignore the sidebar configuration and synchronization filters (labels
such as `NS s-NGM NGM-1` encode synchronization, so both must be lifted). A synchronization
comparison matches configurations with their leading synchronization label removed. On SKKU data,
standard vs bare/cfloor has no pairs (no shared dates); for example, `SS b-EPSK-Cu NGM-1` vs
`SS s-NGM NGM-1` pairs on 7 dates and NS vs SS on 6.

**Dates compared** (next to Color / compare above the plot) adds "Only dates shared by every group" and
"Overlapping date range of all groups" for the Color / compare groups, applied to the whole view.
On real data both keep exactly the same observations as `select_shared_dates()` and
`select_date_range()` in `scripts/plot_functions.R` (N2.thaw vs N2.therm; N2 vs DHL107). Where
ranges do not overlap, the app shows an empty view with a notice instead of stopping with an error.

New unit tests in `verify_pairing.R` and `verify.R`; `tests/browser.mjs` gained configuration,
synchronization and shared-date steps, and its paired-CSV poll now treats a failed fetch as not
yet ready (a transient failure was seen once while outputs re-rendered). All functional checks,
`tests/verify.R`, `compare_browser.R` parity and `audit.py` passed locally.

Deployed in [run 38343584179](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38343584179)
(commit `4a105cd`, Ubuntu 24.04). The live site serves an `app.json` identical to the tested build,
and `tests/browser.mjs` passed against the live URL, including the new steps.

## Update: plate identity clean-up and Row position (2026-10-12)

The internal `ambiguous_plate` and `plate_unit` columns were removed (the second was unused).
Several counts from one plate at the same hour are treated as independent counts: all enter
every summary and the plate line passes through their mean. Observations without a date,
experiment or row get no plate line, with no warning. The "unresolved plate identity" notice,
inspector warning, pairing sentence and `n_unresolved*` export columns are gone; the metric
is now "plates". A quiet list of repeat counts is in Methods & provenance (SKKU: 16 plate/hour
pairs, 32 counts, matching the duplicates found before). **Row position** (`row_position`,
labels "Row 01" … "Row 05.5", "Row not recorded") is available in Color / compare and
Arrange panels, and therefore in the AUC table. A pre-existing legend fault was fixed: plotly
could take a group's legend entry from its error-bar trace, leaving a blank swatch.

Means, SE/SD, AUC and pairing results are unchanged: `compare_browser.R` parity passed, and the
desktop `verify.R`, `verify_pairing.R` and `verify_auc.R` functional checks all passed (only the
historical whole-project fingerprint checks fail, as before). Point clicks still open the
inspector after the legend change.

Deployed in [run 38153273428](https://github.com/hoyonh/thermotolerance-explorer/actions/runs/38153273428)
(commit `34c4b3a`, Ubuntu 24.04). The live site serves an `app.json` identical to the tested build;
`tests/browser.mjs` passed against the live URL (defaults, Row position, repeat-count list, tabs,
exports, both manuscript-button paths); a live point click opens the inspector; the real manuscript
button still reports the private repository; the Safari notice still appears.

## Results (2026-10-06)

| Check | What it covers | Result |
|---|---|---|
| `tests/verify.R` (desktop R) | Uploaded CSVs normalize identically to the original loader (data and MD5 provenance); JHU defaults; default filter rules (20°C, OP50-1, standard configuration and synchronization; OP50 added with JHU; blank when absent); empty/one-/two-source snapshots; rejection of missing columns, header-only, unusable and duplicate-column CSVs; app starts with no data; load, replace, reject (last good data kept), exclusion reset on replacement, removal; filtered values match `filter_data()`; PDF, PNG, CSV and saved-view exports | PASS (33 expectations; more with the optional manuscript CSV) |
| `audit.py` | Exported inputs equal the 11 allowlisted files byte-for-byte; no CSV anywhere in `site/`; no file ≥ 100 MB | PASS |
| `tests/browser.mjs` (headless Chrome) | Exported site starts in the browser; SKKU CSV loads (5,637 observations under the condition defaults) with the default filters selected; Example comparison renders the interactive plot; Color / compare → Row position gives one curve per row (Row 01 …); Methods & provenance lists repeat counts at the same plate and hour; tabs switch (guards against Bootstrap being dropped from the page, which happened in an earlier build); downloads of selected rows, summary, figure PDF/PNG, saved view and AUC CSV; paired-date example renders both plots and exports the paired CSV (checked to be N2.thaw vs N2.therm) and paired PDF; SKKU + JHU together (OP50 added to the diet default); **Load manuscript dataset** with GitHub intercepted: a 404 shows the “not public yet” message, and a served CSV loads as SKKU with the defaults applied; JHU only; back to empty; no JavaScript errors, no R errors, no non-GET requests to any external host | PASS |
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
- The manuscript button has not loaded the real file from GitHub, because the
  repository is still private. Once it is public, click it once on the live site
  (or rerun `browser.mjs` with the interception removed).
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
