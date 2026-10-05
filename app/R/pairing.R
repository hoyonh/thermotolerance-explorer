# Date pairing is done on observed rows, before taking period averages.
pair_key <- function(d, fields) {
  if (!nrow(d)) return(character())
  values <- lapply(d[fields], function(x) {
    x <- as.character(x); x[is.na(x)] <- "<missing>"
    paste0(nchar(x, type = "bytes"), ":", x)
  })
  do.call(paste, c(values, sep = "|"))
}

pair_dates <- function(d, group, reference, comparison, cutoff,
                       same_experiment = TRUE, separate_males = TRUE,
                       allow_unknown = FALSE) {
  stopifnot(group %in% c("strain", "genotype"), length(reference) == 1,
            length(comparison) == 1, reference != comparison,
            length(cutoff) == 1, !is.na(as.Date(cutoff)))
  d <- d[d[[group]] %in% c(reference, comparison), , drop = FALSE]
  d$pair_status <- rep("No counterpart at matching date, time and conditions", nrow(d))
  d$pair_block <- rep(NA_character_, nrow(d))
  d$pair_stratum <- rep(NA_character_, nrow(d))
  if (!nrow(d)) return(list(pairs = data.frame(), audit = d))
  d$sex_label <- ifelse(grepl("(^|[. _])male([. _]|$)", d$raw_strain), "male-labelled", "not male-labelled")
  conditions <- c("source", "culture", "bacteria", "config", "sync")
  missing_value <- function(x) is.na(x) | trimws(as.character(x)) %in% c("", "Not recorded")
  unknown <- Reduce(`|`, lapply(d[conditions], missing_value))
  invalid <- !is.finite(d$survival_pct) | !is.finite(d$hours)
  d$pair_status[!allow_unknown & unknown] <- "Missing condition metadata"
  d$pair_status[same_experiment & missing_value(d$expt)] <- "Missing experiment identifier"
  d$pair_status[is.na(d$date)] <- "Missing assay date"
  d$pair_status[invalid] <- "Invalid survival or time"
  eligible <- !invalid & !is.na(d$date) & (allow_unknown | !unknown) &
    (!same_experiment | !missing_value(d$expt))
  block_fields <- c(conditions, "date", if (same_experiment) "expt", if (separate_males) "sex_label")
  d$pair_block[eligible] <- pair_key(d[eligible, , drop = FALSE], block_fields)
  keys <- pair_key(d[eligible, , drop = FALSE], c(block_fields, "hours"))
  groups <- split(which(eligible), keys)
  result <- list()
  for (idx in groups) {
    z <- d[idx, , drop = FALSE]
    a <- z[z[[group]] == reference, , drop = FALSE]
    b <- z[z[[group]] == comparison, , drop = FALSE]
    if (!nrow(a) || !nrow(b)) next
    # Stock composition is part of each stratum, even when comparing genotypes.
    # This prevents an old stock from being silently replaced by a new one.
    row <- z[1, c(conditions, "date", "hours", "pair_block"), drop = FALSE]
    row$sex_label <- if (separate_males) z$sex_label[1] else "Sex labels pooled"
    collapse <- function(x) paste(sort(unique(as.character(x))), collapse = "; ")
    row$reference <- reference; row$comparison <- comparison
    row$reference_strains <- collapse(a$strain); row$comparison_strains <- collapse(b$strain)
    row$reference_experiments <- collapse(a$expt); row$comparison_experiments <- collapse(b$expt)
    row$reference_mean <- mean(a$survival_pct); row$comparison_mean <- mean(b$survival_pct)
    row$difference_pp <- row$comparison_mean - row$reference_mean
    row$n_reference <- nrow(a); row$n_comparison <- nrow(b)
    row$reference_rows <- collapse(a$observation_id); row$comparison_rows <- collapse(b$observation_id)
    row$n_unresolved <- sum(z$ambiguous_plate)
    row$period <- ifelse(row$date >= as.Date(cutoff), "Recent", "Historic")
    row$recent_from <- as.Date(cutoff)
    row$same_experiment <- same_experiment
    row$pair_stratum <- pair_key(row, c(conditions, "sex_label", "reference_strains", "comparison_strains"))
    row$stratum_label <- paste(row$source, row$culture, row$bacteria, row$config, row$sync,
      row$sex_label, paste(row$reference_strains, "vs", row$comparison_strains), sep = " · ")
    row$pair_panel <- paste(row$date, if (same_experiment) paste("/ experiment", row$reference_experiments) else "/ all experiments")
    d$pair_status[idx] <- "Paired"
    d$pair_stratum[idx] <- row$pair_stratum
    result[[length(result) + 1L]] <- row
  }
  pairs <- if (length(result)) do.call(rbind, result) else data.frame()
  if (nrow(pairs)) pairs <- pairs[order(pairs$date, pairs$pair_block, pairs$hours), , drop = FALSE]
  rownames(pairs) <- NULL
  list(pairs = pairs, audit = d)
}

paired_daily <- function(pairs, hour) {
  if (!nrow(pairs)) return(data.frame())
  z <- pairs[pairs$hours == hour, , drop = FALSE]
  if (!nrow(z)) return(data.frame())
  groups <- split(seq_len(nrow(z)), pair_key(z, c("pair_stratum", "date")))
  result <- lapply(groups, function(idx) {
    x <- z[idx, , drop = FALSE]
    row <- x[1, c("pair_stratum", "stratum_label", "date", "period", "recent_from", "hours", "reference", "comparison"), drop = FALSE]
    row$reference_mean <- mean(x$reference_mean)
    row$comparison_mean <- mean(x$comparison_mean)
    row$difference_pp <- mean(x$difference_pp)
    row$n_blocks <- nrow(x)
    row$n_reference <- sum(x$n_reference)
    row$n_comparison <- sum(x$n_comparison)
    row
  })
  result <- do.call(rbind, result)
  result[order(result$date), , drop = FALSE]
}

paired_period_summary <- function(daily) {
  if (!nrow(daily)) return(data.frame())
  groups <- split(seq_len(nrow(daily)), pair_key(daily, c("pair_stratum", "period")))
  result <- lapply(groups, function(idx) {
    z <- daily[idx, , drop = FALSE]
    data.frame(stratum = z$stratum_label[1], period = z$period[1], recent_from = z$recent_from[1],
      hours = z$hours[1], reference = z$reference[1], comparison = z$comparison[1], n_dates = nrow(z),
      n_blocks = sum(z$n_blocks), reference_mean = mean(z$reference_mean),
      comparison_mean = mean(z$comparison_mean), difference_pp = mean(z$difference_pp),
      difference_se = if (nrow(z) > 1) sd(z$difference_pp) / sqrt(nrow(z)) else NA_real_,
      first_date = min(z$date), last_date = max(z$date))
  })
  result <- do.call(rbind, result)
  result[order(result$stratum, result$period), , drop = FALSE]
}

paired_trend_plot <- function(daily, difference = FALSE) {
  esc <- function(x) as.character(htmltools::htmlEscape(as.character(x)))
  common_tip <- paste0(esc(daily$date), " · ", daily$hours, " h<br>", esc(daily$period),
    "<br>", daily$n_blocks, " matched blocks · observations ", daily$n_reference, " / ", daily$n_comparison)
  if (difference) {
    z <- daily
    z$tip <- paste0(common_tip, "<br>", esc(z$comparison), " − ", esc(z$reference), ": ", round(z$difference_pp, 2), " percentage points")
    p <- ggplot2::ggplot(z, ggplot2::aes(x = date, y = difference_pp, color = period)) +
      ggplot2::geom_hline(yintercept = 0, color = "#a3aaa8", linetype = "dashed") +
      suppressWarnings(ggplot2::geom_point(ggplot2::aes(text = tip), size = 3)) +
      ggplot2::scale_color_manual(values = c(Historic = "#496b8a", Recent = "#c26b39")) +
      ggplot2::labs(y = "Comparison − reference\n(percentage points)", title = "Does the paired difference change?")
  } else {
    a <- daily; b <- daily
    a$value <- a$reference_mean; a$series <- paste("Reference:", a$reference)
    b$value <- b$comparison_mean; b$series <- paste("Comparison:", b$comparison)
    a$tip <- paste0(common_tip, "<br>", esc(a$series), ": ", round(a$value, 2), "%")
    b$tip <- paste0(common_tip, "<br>", esc(b$series), ": ", round(b$value, 2), "%")
    z <- rbind(a, b)
    p <- ggplot2::ggplot(z, ggplot2::aes(x = date, y = value, color = series, group = interaction(series, period))) +
      ggplot2::geom_line(alpha = 0.55, linewidth = 0.6) +
      suppressWarnings(ggplot2::geom_point(ggplot2::aes(text = tip), size = 2.6)) +
      ggplot2::scale_color_manual(values = setNames(c("#287d75", "#b46187"), c(a$series[1], b$series[1]))) +
      ggplot2::scale_y_continuous(limits = c(0, 100)) +
      ggplot2::labs(y = "Survival (%)", title = "Do both groups move together?")
  }
  p + ggplot2::geom_vline(xintercept = daily$recent_from[1], color = "#c26b39", linetype = "dotted") +
    ggplot2::coord_cartesian(xlim = range(daily$date) + c(-1, 1)) +
    ggplot2::labs(x = paste("Assay date · recent begins", daily$recent_from[1]), color = NULL) +
    ggplot2::theme_minimal(base_size = 12) +
    ggplot2::theme(panel.grid.minor = ggplot2::element_blank(), legend.position = "bottom",
      plot.title = ggplot2::element_text(size = 13, face = "bold"))
}

paired_curve_plot <- function(pairs) {
  esc <- function(x) as.character(htmltools::htmlEscape(as.character(x)))
  a <- pairs; b <- pairs
  a$value <- a$reference_mean; a$series <- paste("Reference:", a$reference)
  b$value <- b$comparison_mean; b$series <- paste("Comparison:", b$comparison)
  z <- rbind(a, b)
  z$tip <- paste0(esc(z$pair_panel), "<br>", esc(z$series), "<br>", z$hours, " h · ", round(z$value, 2),
    "%<br>Reference / comparison observations: ", z$n_reference, " / ", z$n_comparison)
  ggplot2::ggplot(z, ggplot2::aes(x = hours, y = value, color = series, group = interaction(pair_block, series))) +
    ggplot2::geom_line(linewidth = 0.7) +
    suppressWarnings(ggplot2::geom_point(ggplot2::aes(text = tip), size = 2)) +
    ggplot2::facet_wrap(~pair_panel, ncol = min(3, length(unique(z$pair_panel)))) +
    ggplot2::scale_y_continuous(limits = c(0, 100), breaks = c(0, 50, 100)) +
    ggplot2::scale_color_manual(values = setNames(c("#287d75", "#b46187"), c(a$series[1], b$series[1]))) +
    ggplot2::labs(x = "Heat exposure (hours)", y = "Survival (%)", color = NULL) +
    ggplot2::theme_minimal(base_size = 11) +
    ggplot2::theme(panel.grid.minor = ggplot2::element_blank(), legend.position = "bottom", strip.text = ggplot2::element_text(size = 9))
}
