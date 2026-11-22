# Generates reference fixtures for the JavaScript numerical core from the existing R
# explorer code (thermotolerance_explorer/R). The R code is sourced unchanged and is
# the reference; nothing in thermotolerance_explorer/ is modified.
#
#   Rscript --vanilla thermotolerance_viewer_js/tools/make_fixtures.R
#
# Output: tests/fixtures/*.json.gz. These contain values derived from the private CSVs
# and must never be published (see .gitignore and README).
args <- commandArgs(FALSE)
script <- sub("^--file=", "", args[grepl("^--file=", args)])
proj <- dirname(dirname(normalizePath(script)))
root <- Sys.getenv("THERMO_PROJECT_ROOT", dirname(proj))
app <- file.path(root, "thermotolerance_explorer")
.libPaths(c(file.path(app, "library"), .libPaths()))
suppressPackageStartupMessages(library(jsonlite))
for (f in c("data.R", "pairing.R", "auc.R")) source(file.path(app, "R", f))
out_dir <- file.path(proj, "tests", "fixtures")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# ---- helpers ---------------------------------------------------------------
as_cols <- function(df) {
  df <- as.data.frame(df, stringsAsFactors = FALSE)
  cols <- lapply(df, function(x) {
    if (inherits(x, "Date")) x <- as.character(x)
    if (is.factor(x)) x <- as.character(x)
    I(x)
  })
  list(n = nrow(df), columns = cols)
}
write_gz <- function(x, name) {
  con <- gzfile(file.path(out_dir, name), "w")
  on.exit(close(con))
  writeLines(toJSON(x, na = "null", digits = NA, auto_unbox = TRUE, null = "null"), con)
}
tc <- function(expr) tryCatch(list(ok = TRUE, value = expr), error = function(e) list(ok = FALSE, message = conditionMessage(e)))

# ---- data frames ------------------------------------------------------------
snap <- load_data(root)
# One deliberate difference from the R explorer: the viewer keeps the recorded genotype label of legacy JHU rows that carry
# iw146 (the R explorer renames it). Apply the same to the reference inputs; every calculation below is still done by the
# unchanged R code.
keep_iw146_label <- function(d) { i <- d$source == "JHU" & grepl("iw146", d$raw_genotype, fixed = TRUE); d$genotype[i] <- as.character(d$raw_genotype[i]); d }
snap$data <- keep_iw146_label(snap$data)
frames <- list(both = snap$data)
jhu_path <- file.path(root, "data", source_files[["JHU"]])
frames$JHU_only <- keep_iw146_label(normalise_data(read.csv(jhu_path, stringsAsFactors = FALSE, check.names = FALSE), "JHU"))
skku_path <- file.path(root, "data", source_files[["SKKU"]])
frames$SKKU_only <- normalise_data(read.csv(skku_path, stringsAsFactors = FALSE, check.names = FALSE), "SKKU")

write_gz(list(
  files = as.list(source_files), md5 = as.list(snap$hashes),
  frames = lapply(frames, function(d) c(as_cols(d), list(types = as.list(vapply(d, function(x) class(x)[1], character(1))))))
), "normalised.json.gz")
cat("normalised written\n")

# ---- scenarios -------------------------------------------------------------
full_dates <- function(d) as.character(range(d$date, na.rm = TRUE))
full_hours <- function(d) range(d$hours, na.rm = TRUE)
defaults_for <- function(frame, sources) {
  d <- frames[[frame]]
  f <- default_filter_selection(d, sources)
  list(sources = sources, genotype = character(), strain = character(), culture = f$culture,
    bacteria = f$bacteria, config = f$config, sync = f$sync, dates = full_dates(d), hours = full_hours(d),
    runs = character(), undated = FALSE, date_selection = "all", quality = TRUE, excluded = character(),
    group = "genotype", facet = "none", unit = "plate", compare_periods = FALSE,
    period_cutoffs = "2026-07-01", period_method = "cutoffs", period_n = 3L)
}
scn <- function(id, frame = "both", sources = "SKKU", pairing = FALSE, ...) {
  s <- defaults_for(frame, sources)
  over <- list(...)
  for (k in names(over)) s[[k]] <- over[[k]]
  list(id = id, frame = frame, settings = s, pairing = pairing)
}
no_cond <- list(culture = character(), bacteria = character(), config = character(), sync = character())
scn_no_cond <- function(id, ...) do.call(scn, c(list(id = id), list(...), no_cond))

skku_d <- frames$both[frames$both$source == "SKKU", ]
top_genotypes <- names(sort(table(skku_d$genotype), decreasing = TRUE))[1:3]
skku_default_ids <- filter_data(frames$both, defaults_for("both", "SKKU"))$observation_id
skku_runs <- sort(unique(filter_data(frames$both, defaults_for("both", "SKKU"))$run_id))

scenarios <- list(
  scn("skku_default", pairing = TRUE),
  scn("skku_strain_run", pairing = TRUE, group = "strain", facet = "run_id", unit = "run"),
  scn_no_cond("skku_nofilter_valid", pairing = TRUE, quality = FALSE, group = "config", facet = "culture"),
  scn("jhu_default", sources = "JHU", pairing = TRUE, bacteria = "OP50", group = "genotype", facet = "date"),
  scn("jhu_only_frame", frame = "JHU_only", sources = "JHU", pairing = TRUE, bacteria = "OP50"),
  scn_no_cond("both_source_group", sources = c("SKKU", "JHU"), group = "source", unit = "run"),
  scn("skku_cut3", pairing = TRUE, compare_periods = TRUE, period_cutoffs = c("2025-06-01", "2026-01-01", "2026-07-01")),
  scn("skku_cut1_default", compare_periods = TRUE, group = "strain"),
  scn("skku_equal4", compare_periods = TRUE, period_method = "equal", period_n = 4L),
  scn("skku_equal10", compare_periods = TRUE, period_method = "equal", period_n = 10L, group = "strain"),
  scn("skku_balanced5", compare_periods = TRUE, period_method = "balanced", period_n = 5L),
  scn("skku_balanced2", compare_periods = TRUE, period_method = "balanced", period_n = 2L, unit = "run"),
  scn("skku_balanced10", compare_periods = TRUE, period_method = "balanced", period_n = 10L, group = "strain"),
  scn("jhu_balanced6", sources = "JHU", bacteria = "OP50", compare_periods = TRUE, period_method = "balanced", period_n = 6L, undated = TRUE),
  scn_no_cond("skku_shared_genotype", genotype = top_genotypes, date_selection = "shared"),
  scn_no_cond("skku_overlap_config", date_selection = "overlap", group = "config"),
  scn("skku_dates_hours", dates = c("2025-01-01", "2025-12-31"), hours = c(2, 3.5)),
  scn("jhu_undated_on", sources = "JHU", bacteria = "OP50", dates = c("2017-06-01", "2018-06-01"), undated = TRUE, quality = FALSE),
  scn("jhu_undated_off", sources = "JHU", bacteria = "OP50", dates = c("2017-06-01", "2018-06-01"), undated = FALSE, quality = FALSE),
  scn("skku_excluded_runs", excluded = skku_default_ids[c(1, 5, 9, 40)], runs = skku_runs[1:3]),
  scn("skku_row_position", group = "row_position", facet = "date"),
  scn("err_equal_too_many", genotype = top_genotypes[1], strain = character(), dates = c("2026-01-01", "2026-01-20"), compare_periods = TRUE, period_method = "equal", period_n = 10L),
  scn("err_bad_cutoffs", compare_periods = TRUE, period_cutoffs = c("2026-08-01", "2026-07-01"))
)

collation_pool <- new.env()
add_pool <- function(kind, x) assign(kind, unique(c(get0(kind, collation_pool), as.character(x))), collation_pool)

run_chain <- function(frame, s) {
  d <- select_group_dates(filter_data(frames[[frame]], s), s$group, s$date_selection)
  info <- attr(d, "date_selection")
  if (s$compare_periods && s$period_method %in% c("equal", "balanced")) {
    validate_period_n(s$period_n, length(unique(d$date[!is.na(d$date)])))
  }
  d <- assign_time_period(d, s$compare_periods, s$period_cutoffs, s$period_method, s$period_n)
  list(d = d, info = info)
}

shared_dates <- function(d, group, a, b) {
  length(intersect(as.character(d$date[d[[group]] == a & !is.na(d$date)]), as.character(d$date[d[[group]] == b & !is.na(d$date)])))
}
pick_pairs <- function(d, group, n = 2) {
  counts <- sort(table(as.character(d[[group]])), decreasing = TRUE)
  top <- names(counts)[seq_len(min(8, length(counts)))]
  if (length(top) < 2) return(list())
  cand <- t(combn(top, 2))
  score <- apply(cand, 1, function(p) shared_dates(d, group, p[1], p[2]))
  ord <- order(-score, seq_along(score))
  lapply(head(ord[score[ord] > 0], n), function(i) c(cand[i, 1], cand[i, 2]))
}


# ---- new analyses: reference implementations (not in the original R explorer) -------------------
# Matched-block AUC over the fixed 2-3.5 h window, using the blocks produced by pair_dates().
# Only blocks measured at every window hour enter; the others are reported with the hours they lack.
window_hours <- auc_hours
hours_text <- function(x) paste(vapply(x, as.character, character(1)), collapse = "; ")
complete_block_ids <- function(pairs) {
  if (!nrow(pairs)) return(character())
  ok <- vapply(split(pairs$hours, pairs$pair_block), function(h) all(window_hours %in% h), logical(1))
  names(ok)[ok]
}
complete_pairs <- function(pairs) pairs[pairs$pair_block %in% complete_block_ids(pairs), , drop = FALSE]
block_auc <- function(pairs) {
  if (!nrow(pairs)) return(list(blocks = data.frame(), excluded = data.frame()))
  rows <- list(); ex <- list()
  for (idx in split(seq_len(nrow(pairs)), pairs$pair_block)) {
    z <- pairs[idx, , drop = FALSE]; z <- z[order(z$hours), , drop = FALSE]
    if (all(window_hours %in% z$hours)) {
      w <- z[match(window_hours, z$hours), , drop = FALSE]
      ra <- trapezoid_auc(w$reference_mean); ca <- trapezoid_auc(w$comparison_mean)
      rows[[length(rows) + 1L]] <- data.frame(pair_block = z$pair_block[1], pair_stratum = z$pair_stratum[1], stratum_label = z$stratum_label[1],
        date = z$date[1], period = z$period[1], recent_from = z$recent_from[1], pair_panel = z$pair_panel[1], reference = z$reference[1],
        comparison = z$comparison[1], reference_auc = ra, comparison_auc = ca, difference_auc = ca - ra,
        reference_mean_survival = ra / 1.5, comparison_mean_survival = ca / 1.5,
        n_reference = sum(w$n_reference), n_comparison = sum(w$n_comparison), stringsAsFactors = FALSE)
    } else {
      ex[[length(ex) + 1L]] <- data.frame(pair_block = z$pair_block[1], date = z$date[1], pair_panel = z$pair_panel[1], stratum_label = z$stratum_label[1],
        period = z$period[1], hours_present = hours_text(sort(unique(z$hours))), hours_missing = hours_text(window_hours[!window_hours %in% z$hours]), stringsAsFactors = FALSE)
    }
  }
  tidy <- function(l, keys) { if (!length(l)) return(data.frame()); d <- do.call(rbind, l); d[do.call(order, unname(d[keys])), , drop = FALSE] }
  list(blocks = tidy(rows, c("date", "pair_block")), excluded = tidy(ex, c("date", "pair_block")))
}
auc_daily <- function(blocks) {
  if (!nrow(blocks)) return(data.frame())
  groups <- split(seq_len(nrow(blocks)), pair_key(blocks, c("pair_stratum", "date")))
  result <- lapply(groups, function(idx) {
    x <- blocks[idx, , drop = FALSE]
    row <- x[1, c("pair_stratum", "stratum_label", "date", "period", "recent_from", "reference", "comparison"), drop = FALSE]
    row$reference_auc <- mean(x$reference_auc); row$comparison_auc <- mean(x$comparison_auc)
    row$difference_auc <- mean(x$difference_auc); row$n_blocks <- nrow(x)
    row
  })
  result <- do.call(rbind, result)
  result[order(result$date), , drop = FALSE]
}
auc_period_summary <- function(daily) {
  if (!nrow(daily)) return(data.frame())
  groups <- split(seq_len(nrow(daily)), pair_key(daily, c("pair_stratum", "period")))
  result <- lapply(groups, function(idx) {
    z <- daily[idx, , drop = FALSE]
    data.frame(stratum = z$stratum_label[1], period = z$period[1], recent_from = z$recent_from[1], reference = z$reference[1], comparison = z$comparison[1],
      n_dates = nrow(z), n_blocks = sum(z$n_blocks), reference_auc = mean(z$reference_auc), comparison_auc = mean(z$comparison_auc),
      difference_auc = mean(z$difference_auc), difference_se = if (nrow(z) > 1) sd(z$difference_auc) / sqrt(nrow(z)) else NA_real_,
      reference_mean_survival = mean(z$reference_auc) / 1.5, comparison_mean_survival = mean(z$comparison_auc) / 1.5,
      first_date = min(z$date), last_date = max(z$date), stringsAsFactors = FALSE)
  })
  result <- do.call(rbind, result)
  result[order(result$stratum, result$period), , drop = FALSE]
}
# Gap-by-hour profile: the existing single-hour summaries at every recorded hour.
hour_profile <- function(pairs) {
  lapply(sort(unique(pairs$hours)), function(h) { d <- paired_daily(pairs, h); list(hour = h, daily = as_cols(d), period = as_cols(paired_period_summary(d))) })
}

result <- list()
for (sc in scenarios) {
  s <- sc$settings
  cat("scenario", sc$id, "\n")
  chain <- tc(run_chain(sc$frame, s))
  entry <- list(id = sc$id, frame = sc$frame, settings = s)
  if (!chain$ok) { entry$error <- chain$message; result[[sc$id]] <- entry; next }
  d <- chain$value$d; info <- chain$value$info
  entry$kept <- list(ids = d$observation_id, time_period = d$time_period, time_period_index = d$time_period_index)
  entry$date_selection <- if (is.null(info)) NULL else list(mode = info$mode, rows_before = info$rows_before, rows_kept = info$rows_kept,
    dates_before = info$dates_before, dates_kept = info$dates_kept, span = as.character(info$span), text = describe_date_selection(info))
  entry$period_lines <- tc(describe_time_periods(d))$value
  # candidate rows before quality rules, for the app's "omitted" notice
  entry$candidate_n <- nrow(filter_data(frames[[sc$frame]], s, apply_quality = FALSE))
  dec <- decorate_data(d, s$group, s$facet)
  levels_out <- NULL
  if (isTRUE(s$compare_periods)) {
    dec$curve <- paste(dec$curve, dec$time_period, sep = " · ")
    levels_out <- unique(dec$curve[order(as.character(dec[[s$group]]), dec$time_period_index)])
    dec$curve <- factor(dec$curve, levels = levels_out)
  }
  entry$curve_levels <- levels_out
  entry$curve_after_periods <- if (isTRUE(s$compare_periods)) as.character(dec$curve) else NULL
  entry$summary <- as_cols(summarise_curves(dec, s$unit))
  entry$auc_all <- as_cols(all_selected_auc(d, s$group, s$unit))
  add_pool("strain", d$strain); add_pool("genotype", d$genotype); add_pool("config", d$config)
  add_pool("row_position", d$row_position); add_pool("run_id", d$run_id)
  # paired AUC
  entry$auc_pairs <- list()
  if (nrow(d)) {
    for (p in pick_pairs(d, s$group)) {
      r <- complete_date_auc(d, s$group, p[1], p[2], s$unit)
      entry$auc_pairs[[length(entry$auc_pairs) + 1L]] <- list(reference = p[1], comparison = p[2],
        pairs = as_cols(r$pairs), audit = as_cols(r$audit), undated_n = nrow(r$undated),
        summary = as_cols(summarise_paired_auc(r$pairs)))
    }
  }
  # date pairing
  entry$pairing <- list()
  if (isTRUE(sc$pairing) && nrow(d)) {
    for (dim in c("strain", "genotype", "config", "sync")) {
      data_for <- d
      if (dim %in% c("config", "sync")) {
        s2 <- s; s2$config <- character(); s2$sync <- character()
        data_for <- assign_time_period(select_group_dates(filter_data(frames[[sc$frame]], s2), s2$group, s2$date_selection))
      }
      variants <- list(list(same_experiment = TRUE, separate_males = TRUE, allow_unknown = FALSE),
                       list(same_experiment = FALSE, separate_males = FALSE, allow_unknown = TRUE))
      for (p in pick_pairs(data_for, dim, if (dim == "strain") 2 else 1)) {
        for (v in variants) {
          r <- pair_dates(data_for, dim, p[1], p[2], "2026-09-01", v$same_experiment, v$separate_males, v$allow_unknown)
          hours_avail <- sort(unique(r$pairs$hours))
          daily <- lapply(head(hours_avail, 3), function(h) list(hour = h, daily = as_cols(paired_daily(r$pairs, h)),
            period = as_cols(paired_period_summary(paired_daily(r$pairs, h)))))
          if (nrow(r$pairs)) add_pool("pair_block", r$pairs$pair_block)
          ba <- block_auc(r$pairs); ad <- auc_daily(ba$blocks); cp <- complete_pairs(r$pairs)
          entry$pairing[[length(entry$pairing) + 1L]] <- list(dimension = dim, reference = p[1], comparison = p[2],
            block_auc = list(blocks = as_cols(ba$blocks), excluded = as_cols(ba$excluded), daily = as_cols(ad), period = as_cols(auc_period_summary(ad))),
            profile_all = hour_profile(r$pairs), profile_complete = hour_profile(cp), complete_blocks = length(complete_block_ids(r$pairs)),
            total_blocks = length(unique(r$pairs$pair_block)),
            cutoff = "2026-09-01", flags = v, pairs = as_cols(r$pairs),
            audit = as_cols(r$audit[c("observation_id", "pair_status", "pair_block", "pair_stratum", "sex_label", "config_without_sync")]),
            daily = daily)
        }
      }
    }
  }
  result[[sc$id]] <- entry
}
write_gz(result, "scenarios.json.gz")
cat("scenarios written\n")

# ---- standalone grids and tables ---------------------------------------------
set.seed(20261118)
grid <- list()
for (m in 2:60) for (n in 2:min(10, m)) {
  w <- sample(1:40, m, replace = TRUE)
  if (m %% 5 == 0) w <- rep(10L, m)                      # all-equal weights exercise tie-breaking
  grid[[length(grid) + 1L]] <- list(m = m, n = n, weights = w,
    cut = cut(seq_len(m), breaks = n, labels = FALSE), balanced = balanced_date_groups(w, n))
}
write_gz(grid, "period_grid.json.gz")

repeats <- lapply(c("both", "JHU_only"), function(f) as_cols(repeat_counts(frames[[f]])))
names(repeats) <- c("both", "JHU_only")
coverage <- lapply(c("both", "JHU_only", "SKKU_only"), function(f) date_coverage_lines(frames[[f]]))
names(coverage) <- c("both", "JHU_only", "SKKU_only")
defaults <- list(
  skku = default_filter_selection(frames$both, "SKKU"), jhu = default_filter_selection(frames$both, "JHU"),
  both = default_filter_selection(frames$both, c("SKKU", "JHU")))
write_gz(list(repeats = repeats, coverage = coverage, defaults = defaults), "misc.json.gz")

pool <- as.list(collation_pool)
write_gz(lapply(pool, function(x) list(sorted = I(sort(x)))), "collation.json.gz")
cat("done\n")
