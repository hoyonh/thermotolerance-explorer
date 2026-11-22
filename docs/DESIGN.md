# Design notes

## Approach

- A JavaScript viewer built **alongside** the R explorer and the Shinylive build, which are unchanged. The R code
  stays the scientific reference: `tools/make_fixtures.R` runs it and the tests compare the JavaScript with it.
- Lessons taken from the MAD viewer (`~/Desktop/next_manuscripts/MAD/mad_viewer_js_workspace/docs`): native ES modules
  and a static `dist/`; a small local Python server; independent R reference fixtures; source fingerprints in saved
  views; tests that exercise the real page in Chrome and WebKit. Not taken: its size. This viewer has one question
  (survival curves, AUC, date pairing), so about 20 small modules suffice.
- The interface **replicates the R explorer's layout and wording** (sidebar filters, curves card, AUC card, paired-date
  card, detail tabs) rather than redesigning it.

## What was measured

Warm, on the author's Mac (Chrome and Playwright WebKit give the same picture): page start-up about 0.7 s; choosing the
9,500-row SKKU CSV to first plot about 0.55 s; changing the Color / compare choice 35–55 ms; the paired-date example
30–70 ms. The Shinylive build needs a 40 MB first download and tens of seconds in Chrome; Safari was very slow.

## Differences from the R explorer (please confirm or reverse)

1. **The familiar comparison opens first.** After loading, the genotype filter is *wild type* + *sma-9(wk55)* (when both
   exist), like **Example comparison**. The R and Shinylive apps leave genotype blank after a load, which gives about
   100 genotypes and a "more than 30 curves" message. Following the author's rule that every default view must be
   informative. One line in `app.js` (`resetForData`) reverts it.
2. **Figure export is SVG and PNG, not PDF.** PDF needs a library or a print dialog; SVG opens in any vector editor.
3. **No drag-to-zoom.** Hover and click are supported; the hint text no longer promises zoom.
4. **Fingerprints are SHA-256**, not MD5 (browsers do not provide MD5). Views saved by the R app restore, but the
   fingerprint check reports a difference.
5. **No "Reload source CSVs" button.** Choose the file again, or use **Load project data folder**.
6. **Y-axis and x-axis numbers appear on every panel**, not only the outer ones.
7. The glossary filter lists show meanings but cannot be dragged off the plot.
8. **Paired-date PDF report** is not offered; the three paired figures show on screen and the data export as CSV.

## Changes after first release

- **Safari clipping bug (fixed).** With "Compare time periods" on, the lower part of the survival plot (below about
  25%) vanished in Safari. Cause: every figure defined clip regions with the same ids (`c0`, `c1`, …); once the
  paired-date figures existed, Safari applied their shorter clip region to the curve plot. Ids are now unique per
  figure, and `tests/browser.mjs` checks that no id repeats and that every point lies inside its clip rectangle.
  Chrome never showed it.
- **95% confidence interval** added to *Error bars*: mean ± t(0.975, n − 1) × SE, with n the number of units averaged
  (observations, or runs under run weighting); undefined for a single unit, as for SE. The Summary table and CSV gain
  a `ci95` half-width column. t quantiles are computed in JavaScript and checked against R's `qt`.

- **Offset for individual observations.** Observation points are drawn slightly to the side of their hour: each curve
  has its own slot, and a fixed per-observation jitter (derived from the observation id, so redraws never move a point)
  spreads points within the slot. Means, lines, plate curves' joins and error bars stay at the true hours, hover shows
  the true hours, and the card says so. The total width of all slots is 60% of the closest spacing between plotted
  hours (`OFFSET_SHARE` in `plots.js`); it is always on, with no control. Say if you want a switch or a different size.

## Multi-hour paired analyses (added after the first release)

The paired-date comparison summarised one exposure time at a time. In the data (SKKU, default filters) 16 of 20
N2.thaw/N2.therm blocks and 23 of 28 wild type/sma-9 blocks are measured at all of 2, 2.5, 3 and 3.5 h, and the gap
depends strongly on the hour chosen (wild type vs sma-9: 10.6, 33.1, 31.2 and 26.7 percentage points at 2, 2.5, 3 and
3.5 h, with 16 of 26 blocks above 95% survival at 2 h). Decisions taken with the author:

- Plates are independent, so no repeated-measures correction is applied; the matched block or date stays the
  replication unit, as in the existing period summaries.
- The existing **Paired AUC** card is unchanged except that it is now labelled *date-level* and says it matches on
  source and date only (not experiment, row or conditions). Its relative usefulness is to be reconsidered after
  comparing it with the matched-block version.
- A new **Across hours** tab in the Paired-date comparison holds two things.
  1. **Gap by exposure time**: the single-hour summaries at every recorded hour. Every eligible block counts at each
     hour, and the number of dates and blocks is shown. Thin lines are dates, thick lines period means ± SE across
     dates. An optional checkbox restricts it to complete blocks (all of 2, 2.5, 3 and 3.5 h), for comparison.
  2. **Matched-block AUC (2–3.5 h)**: trapezoid AUC of each group's mean survival inside every matched block, under the
     card's own matching rules. Complete blocks only; incomplete blocks are listed with the hours present and missing
     and counted in a message. Blocks on one date are averaged, then dates carry equal weight in each period; gap =
     comparison − reference; mean survival = AUC ÷ 1.5 h.
- No interpolated quantities (LT50) and no models or significance tests were added.
- These analyses do not exist in the R explorer, so `tools/make_fixtures.R` contains independent R implementations
  (using the original `pair_dates`, `paired_daily` and `trapezoid_auc`) as the reference; `numerical.mjs` compares the
  JavaScript with them on all 52 pairing runs.

## Date-cutoff shortcut (added after the multi-hour work)

- Sidebar, directly under "Assay dates" and its coverage note: **All dates / Up to and including the cutoff / After the cutoff**, with a cutoff date.
  It only fills the existing assay-date range, so every plot, table and export follows it, and the range stays editable.
- Default cutoff date: **2026-07-25**, the last assay date of the dataset behind the submitted manuscript (inferred from
  the data file saved before the 26 Jul package; the manuscript text itself gives no date). Default mode is **All dates**,
  so nothing changes unless the shortcut is used.
- The cutoff date belongs to the "up to and including" side; "After" starts the next day. This differs from the paired-date
  tabs' "Recent period begins", where the date itself is Recent. The two controls are independent.
- Indicator: every figure (survival curves, date trend, gap by hour, AUC gap, paired curves) carries a line above the panels
  whenever the assay dates are narrower than the loaded data, also in exported SVG/PNG. A shortcut cutoff reads
  "Assays up to and including <date> only" or "Assays after <date> only"; dates edited by hand read
  "Assay dates <from> to <to> only". The full range (what "Use full range" sets) shows nothing.
- Saved views keep `cut_mode` and `cut_date`; older views without them load with the cutoff off.
- Tests: `modules.mjs` (range arithmetic, note, saved view), `browser.mjs` (range, indicator, exported SVG, partition).

## Genotype search (added after the date-cutoff shortcut)

- `dist/js/genotype.js`: a genotype is read as its genes (`gene(allele)` parts, joined by `;` or a space). The genotype
  filter's search splits the query into words (spaces, `;`, `,`; case and hyphens ignored, so `tax2 sma9` works); every
  word must occur in the value, so alleles and pasted full genotypes still match as before.
- Order of matches: exact single mutant, other single mutants, doubles, triples and larger, then values with no gene
  (C1, T1, ...). Within a group, exact gene matches precede substring matches, then the original alphabetical order.
  Each entry carries a small single/double/triple tag. Only the genotype list changed; other filters and the
  paired-date comparison's genotype menu are unchanged.
- Limit: gene names are recognised by the pattern `letters-number(`; a differently written genotype is treated as having
  no gene (sorted last, still found by plain text).

## Filter-narrowing notice

- In the notice above the survival curves: when Color / compare is Genotype and a strain filter is active, "Genotype curves
  use only the selected strains: A, B." names the strains actually present in the plotted data; the reverse (Strain curves,
  genotype filter active) names the genotypes. Lists longer than six end with "and N more". Genotype/strain only; it is
  a text notice, not drawn on the figure or in exports.

## Source switching (added after the filter-narrowing notice)

- Ticking or unticking a data source updates the Bacterial diet filter to the defaults for the new set of sources
  (JHU is all OP50; SKKU is mostly OP50-1), but only when the filter still equals the default for the old set; a filter
  edited by hand is left alone. A toast announces the change. Loading or removing a file still resets all filters.
- The JHU legacy hint moved from the end of the filter group to directly under the Bacterial diet filter.
- Notice above the curves: when the filters remove every row of a ticked source, "<source> contributes no data: no rows
  pass the <filter> filter (<values>); <source> has <values>" (also for assay dates, heat-exposure range and recorded
  runs, or "none of its rows pass all the filters together"). Computed in `dist/js/sourcegaps.js`; quality exclusions and
  "Dates compared" are not counted as filters (they have their own notices).

## Question: does row position matter? (added after source switching)

- Sidebar "Questions" section with one button, modelled on the MAD viewer's curated genetic questions. It only sets
  settings the user can see and change; "Back to my view" restores the snapshot taken when the question was asked
  (loading or removing a file also ends the question).
- Settings applied: all genotypes and strains, culture 20°C, Synchronization standard, Experimental configuration standard
  and bare (those present), diets for the loaded sources, all assay dates (undated included), heat exposure 2–3.5 h,
  Color/compare = Row position, Arrange panels = **By source and configuration** (new choice: panels "JHU · standard",
  "SKKU · bare", "SKKU · standard"), Mean curves, no error bars. JHU is restricted to 20°C as well (it also holds 15°C data) so the
  sources are comparable.
- Why separate panels: on 2026-11-20 data, SKKU standard is flat across rows 1-6 (3 h survival 40-45%) but SKKU bare falls
  steeply (about 30% in row 1 to about 2% in row 6, 8 observations per row); pooled, bare (about 4% of observations)
  is invisible. JHU falls steadily (3 h: 48% in row 1 to 32% in row 6). Pooling genotypes is cleaner for JHU (about 150-170
  genotypes per row, wild type 1-4%) than for SKKU, where wild type varies 8-18% by row. A first look at wild type alone in SKKU
  suggested the pooled flat curve might hide a row effect; that was based on 2-38 runs per row and included other configurations,
  and the genotype-adjusted analysis below (all genotypes, standard configuration only) does not support it.
- Notice above the plot (whenever Color/compare is Row position): the fewest observations at any hour per row in each panel, and
  rows with fewer than 10 are named; they are not reliable. Rows with very few observations (JHU rows 12-15, "Row not recorded",
  SKKU bare rows 7-12) are still drawn; a minimum-observations option is not implemented.
### Racks and incubator setup (author's account, 2026-11-20)

- **Setup, as told by the author (not derived from the data).** SKKU: rows 1-6 run left to right in the lower rack, rows 7-12 in the
  rack above; bare = assays done without the inner container (severe row effect), standard = with the inner container
  (capacity 6 rows, row effect negligible); the incubator fans blow from the back. JHU: rows 1-11 run left to right on the upper shelf,
  rows 12 and up on a separate shelf below it (boundary from the legend of Supplementary Figure S1, Hwang et al. 2020; on the legend, row = worm transfer order = plate row position, and the earliest transferred plates were furthest from the door hinge); no inner container was ever used; the incubator fans were on top. Row positions were
  rotated between assays at JHU as a habit.
- **What was built from it.** `rack` column (`Rack 1` / `Rack 2`; boundary after row 6 for SKKU, row 11 for JHU, `Not recorded`
  otherwise; `RACK_LAST_ROW` and `rackOf()` in `data.js`), "Rack" as a Color / compare choice, and, when the curves are colored
  by row position, second-rack curves drawn dashed with a key line above the figure (also in exports). The question's description
  states the container history and the dashed rule.
- **What the data show (2026-11-20 files).** SKKU bare falls left to right in the lower rack (3 h survival about 30% in row 1, about 2% in
  row 6) and restarts higher in the upper rack (about 48% in row 7), then falls again; JHU falls through the first rack and flattens, with a
  no clear restart after the boundary (rows 12 and up have very few observations). The airflow direction is recorded here as context
  only; the viewer does not test why the gradient exists.
- **Not built.** A comparison within the same genotype and run across rotated rows (the rotation allows it) is a possible later question.

### Within-genotype comparison (shown by the row-position question; otherwise opt-in)

- Sidebar checkbox "Also show the within-genotype comparison" (Questions section; saved with views as `row_within_genotype`). It is off
  in ordinary views and is switched on by the row-position question (author's request: show it by default there); it can be unticked.
  While the question is active the AUC and paired-date cards are hidden (they say nothing about row position); "Back to my view" brings them back.
  When ticked, a card "Row effect within genotype" appears after the survival curves, independent of Color / compare; it follows
  all sidebar filters (so a single genotype can be chosen there). `dist/js/rowfx.js` holds the calculation; there is no R counterpart.
- Per source and configuration panel and per row: the mean of (observation minus its genotype's mean at the same heat exposure), using
  only genotypes measured in at least two rows ("within genotype"), and the stricter version using the same recorded run
  (date and experiment) only ("within genotype and recorded run", needs two rows of the same genotype in the same run). Percentage
  points, counts shown, points with fewer than 10 observations drawn hollow, rack boundary marked, CSV and SVG export.
- Findings on the 2026-11-20 files (question selection, 2-3.5 h): JHU standard falls from +12 points in row 1 to -7 in row 8 (matched:
  +9 to -6) and recovers slightly to about -3 to -4 by rows 10-11; SKKU standard stays within about +-2 points of zero in rows 1-6
  (matched about +-2); SKKU bare falls from +11 (row 1) to -12 (row 6) and restarts at +26 in row 7, then falls to -12 by row 12.
  SKKU bare has no matched estimate (no genotype measured in two rows of the same run). Strain mix therefore does not explain the JHU
  or SKKU-bare effects, and SKKU standard has no row effect to explain.

- Not done: a wild-type-only check button (the Genotype filter does it by hand).

### "How to read these figures" (row-position question only)

- A prominent button in the Questions section of the sidebar, and smaller buttons on the survival-curves card (while the question is
  active) and on the within-genotype card, open a dialog (`ui.js` `modal`, native `<dialog>`; Escape or the Close button closes it).
- Sections: what is compared (panels, racks, container history, conditions), survival curves, row effect within genotype, what the
  current data show, things to keep in mind. The container history and rack layout are stated as coming from the lab's records.
- "What the current data show" is computed live from the loaded files for the question's own selection (`rowLiveNumbers` in
  `questions.js`), independent of later sidebar edits: per panel, mean survival at 3 h in the first and last recorded rows, and the rows where
  the within-genotype value is highest and lowest. Only recorded rows with at least 30 observations are used, so a few plates cannot set the
  extremes. The text states numbers only, no conclusions. The incubator fans are deliberately not in the dialog.
- Scope: the row-position question only; the ordinary views have no such dialog.

## Axis labels

- Survival-curve and paired-curve panels label the x-axis only at the heat exposures that were measured (2, 2.5, 3, 3.5 ...);
  `hourTicks()` falls back to rounded ticks when more than 10 distinct hours would crowd the axis.

## Known limits and untested

- Tested engines: installed Chrome and Playwright's WebKit (desktop). Firefox, real Safari and iPhone/iPad are not
  tested; the narrow-screen layout was checked only by eye in Chrome at 420 px.
- Figures were not compared pixel-for-pixel with the R plots, and the tests do not judge whether a screen "makes
  scientific sense". The numbers do match R (see README); the drawing is new code.
- Column types follow `read.csv`. Numbers print like R only to 15 significant digits and without scientific notation.
- String ordering uses the browser's ICU collator, which agreed with R on every value in the data.
