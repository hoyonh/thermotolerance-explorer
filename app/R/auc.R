auc_hours <- c(2, 2.5, 3, 3.5)

assign_time_period <- function(d, enabled = FALSE, cutoff = "2026-07-01") {
  d$time_period <- rep("All dates", nrow(d))
  d$time_period_index <- rep(1L, nrow(d))
  if (!enabled) return(d)
  cutoff <- validate_period_cutoffs(cutoff)
  labels <- c(paste("Before", cutoff[1]),
    if (length(cutoff) > 1) paste(head(cutoff, -1), "to", tail(cutoff, -1) - 1),
    paste(tail(cutoff, 1), "onward"))
  known <- !is.na(d$date)
  index <- findInterval(as.numeric(d$date[known]), as.numeric(cutoff)) + 1L
  d$time_period[known] <- labels[index]
  d$time_period_index[known] <- index
  d$time_period[!known] <- "Undated (not assigned)"
  d$time_period_index[!known] <- length(labels) + 1L
  d
}

validate_period_cutoffs <- function(cutoffs) {
  dates <- tryCatch(as.Date(cutoffs), error = function(e) as.Date(NA))
  if (!length(dates) || length(dates) > 3 || anyNA(dates) || any(diff(dates) <= 0)) {
    stop("Choose one to three valid cutoff dates in strictly increasing order.", call. = FALSE)
  }
  dates
}

trapezoid_auc <- function(values) {
  if (length(values) != 4 || any(!is.finite(values))) return(NA_real_)
  sum(diff(auc_hours) * (head(values, -1) + tail(values, -1)) / 2)
}

auc_curve_stats <- function(d, unit = "plate") {
  means <- vapply(auc_hours, function(h) {
    z <- d[d$hours == h & is.finite(d$survival_pct), , drop = FALSE]
    if (!nrow(z)) return(NA_real_)
    if (unit == "run") mean(vapply(split(z$survival_pct, z$run_id), mean, numeric(1))) else mean(z$survival_pct)
  }, numeric(1))
  counts <- vapply(auc_hours, function(h) sum(d$hours == h & is.finite(d$survival_pct)), integer(1))
  missing <- auc_hours[!is.finite(means)]
  area <- trapezoid_auc(means)
  data.frame(auc_pct_h = area, mean_survival_pct = area / 1.5,
    complete = !length(missing), status = if (length(missing)) paste("Missing:", paste(missing, collapse = ", "), "h") else "Complete",
    mean_2h = means[1], mean_2_5h = means[2], mean_3h = means[3], mean_3_5h = means[4],
    n_2h = counts[1], n_2_5h = counts[2], n_3h = counts[3], n_3_5h = counts[4], weighting = unit)
}

all_selected_auc <- function(d, group, unit = "plate") {
  if (!nrow(d)) return(data.frame())
  if (!"time_period" %in% names(d)) d <- assign_time_period(d)
  groups <- split(seq_len(nrow(d)), pair_key(d, c(group, "time_period")))
  result <- lapply(groups, function(idx) {
    z <- d[idx, , drop = FALSE]
    cbind(data.frame(group = as.character(z[[group]][1]), time_period = z$time_period[1],
      time_period_index = if ("time_period_index" %in% names(z)) z$time_period_index[1] else 1L), auc_curve_stats(z, unit))
  })
  result <- do.call(rbind, result); rownames(result) <- NULL
  result[order(result$group, result$time_period_index), , drop = FALSE]
}

complete_date_auc <- function(d, group, reference, comparison, unit = "plate") {
  stopifnot(length(reference) == 1, length(comparison) == 1, reference != comparison)
  if (!"time_period" %in% names(d)) d <- assign_time_period(d)
  d <- d[d[[group]] %in% c(reference, comparison), , drop = FALSE]
  undated <- d[is.na(d$date), , drop = FALSE]
  d <- d[!is.na(d$date), , drop = FALSE]
  if (!nrow(d)) return(list(pairs = data.frame(), audit = data.frame(), undated = undated))
  # Same calendar date in two data sources is not treated as a paired assay.
  groups <- split(seq_len(nrow(d)), pair_key(d, c("source", "date")))
  rows <- lapply(groups, function(idx) {
    z <- d[idx, , drop = FALSE]
    a <- z[z[[group]] == reference, , drop = FALSE]
    b <- z[z[[group]] == comparison, , drop = FALSE]
    sa <- auc_curve_stats(a, unit); sb <- auc_curve_stats(b, unit)
    used <- z[z$hours %in% auc_hours, , drop = FALSE]
    row <- data.frame(source = z$source[1], date = z$date[1], time_period = z$time_period[1],
      time_period_index = if ("time_period_index" %in% names(z)) z$time_period_index[1] else 1L,
      reference = reference, comparison = comparison, reference_auc = sa$auc_pct_h,
      comparison_auc = sb$auc_pct_h, difference_pct_h = sb$auc_pct_h - sa$auc_pct_h,
      eligible = sa$complete & sb$complete, reference_status = sa$status, comparison_status = sb$status,
      n_reference = sum(a$hours %in% auc_hours), n_comparison = sum(b$hours %in% auc_hours), weighting = unit,
      observation_ids = paste(used$observation_id, collapse = "; "))
    for (field in c("culture", "bacteria", "config", "sync", "strain", "expt")) {
      row[[paste0("reference_", field)]] <- paste(sort(unique(a[[field]][a$hours %in% auc_hours])), collapse = "; ")
      row[[paste0("comparison_", field)]] <- paste(sort(unique(b[[field]][b$hours %in% auc_hours])), collapse = "; ")
    }
    for (field in c("mean_2h", "mean_2_5h", "mean_3h", "mean_3_5h", "n_2h", "n_2_5h", "n_3h", "n_3_5h")) {
      row[[paste0("reference_", field)]] <- sa[[field]]
      row[[paste0("comparison_", field)]] <- sb[[field]]
    }
    row
  })
  audit <- do.call(rbind, rows); rownames(audit) <- NULL
  audit <- audit[order(audit$date, audit$source), , drop = FALSE]
  list(pairs = audit[audit$eligible, , drop = FALSE], audit = audit, undated = undated)
}

summarise_paired_auc <- function(pairs) {
  if (!nrow(pairs)) return(data.frame())
  result <- lapply(split(pairs, pairs$time_period), function(z) {
    data.frame(time_period = z$time_period[1], time_period_index = z$time_period_index[1], reference = z$reference[1], comparison = z$comparison[1],
      n_date_pairs = nrow(z), reference_auc = mean(z$reference_auc), comparison_auc = mean(z$comparison_auc),
      difference_pct_h = mean(z$difference_pct_h),
      difference_se = if (nrow(z) > 1) sd(z$difference_pct_h) / sqrt(nrow(z)) else NA_real_)
  })
  result <- do.call(rbind, result); rownames(result) <- NULL
  result[order(result$time_period_index), , drop = FALSE]
}
