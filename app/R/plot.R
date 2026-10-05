make_curve_plot <- function(d, summary, mode, uncertainty, colors) {
  esc <- function(x) as.character(htmltools::htmlEscape(as.character(x)))
  d$tip <- paste0("<b>", esc(d$strain), " · ", esc(d$genotype), "</b><br>",
    esc(d$source), " · ", esc(d$date), " · experiment ", esc(d$expt), " · row ", esc(d$row),
    "<br>", d$hours, " h · ", round(d$survival_pct, 1), "% survival",
    "<br>Alive / dead: ", d$alive, " / ", d$dead,
    "<br>Ruptured / suicide / missing: ", d$Rup, " / ", d$suicide, " / ", d$missing,
    "<br>", esc(d$culture), " · ", esc(d$bacteria), " · ", esc(d$config),
    if ("time_period" %in% names(d)) paste0("<br>", esc(d$time_period)) else "",
    "<br>", esc(d$observation_id), ifelse(nzchar(d$note), paste0("<br>Note: ", esc(d$note)), ""),
    ifelse(d$ambiguous_plate, "<br>Plate identity unresolved; point shown without a plate line", ""))
  summary$tip <- paste0("<b>", esc(summary$curve), "</b><br>", esc(summary$panel),
    "<br>", summary$hours, " h · mean ", round(summary$mean, 1), "%",
    "<br>", summary$n_observations, " observations · ", summary$n_runs, " recorded runs",
    "<br>Weighting: ", ifelse(summary$unit == "run", "equal run means", "equal observations"),
    "<br>SE: ", ifelse(is.na(summary$se), "undefined (one unit)", round(summary$se, 2)))
  summary$observation_id <- paste("mean", summary$panel, summary$curve, summary$hours, sep = "::")
  p <- ggplot2::ggplot()
  if (mode %in% c("replicates", "both")) {
    lines <- d[!d$ambiguous_plate, , drop = FALSE]
    if (nrow(lines)) p <- p + ggplot2::geom_line(data = lines, ggplot2::aes(x = hours, y = survival_pct, color = curve, group = interaction(plate_id, curve)), alpha = 0.22, linewidth = 0.5)
  }
  if (mode %in% c("points", "replicates", "both")) {
    p <- p + suppressWarnings(ggplot2::geom_point(data = d,
      ggplot2::aes(x = hours, y = survival_pct, color = curve, text = tip, key = observation_id),
      size = 1.9, alpha = if (mode == "replicates") 0.8 else 0.4))
  }
  if (mode != "replicates") {
    if (uncertainty != "none") {
      summary$err <- if (uncertainty == "se") summary$se else summary$sd
      bars <- summary[is.finite(summary$err), , drop = FALSE]
      if (nrow(bars)) p <- p + ggplot2::geom_errorbar(data = bars, ggplot2::aes(x = hours, ymin = pmax(0, mean - err), ymax = pmin(100, mean + err), color = curve), width = 0.045, linewidth = 0.45)
    }
    p <- p + ggplot2::geom_line(data = summary, ggplot2::aes(x = hours, y = mean, color = curve, group = curve), linewidth = 0.85) +
      suppressWarnings(ggplot2::geom_point(data = summary, ggplot2::aes(x = hours, y = mean, color = curve, text = tip, key = observation_id), size = 2.5))
  }
  p + ggplot2::facet_wrap(~panel, ncol = if (length(unique(d$panel)) == 1) 1 else 3) +
    ggplot2::scale_color_manual(values = colors, name = NULL) +
    ggplot2::scale_y_continuous(limits = c(0, 100), breaks = seq(0, 100, 25), expand = ggplot2::expansion(mult = 0.03)) +
    ggplot2::labs(x = "Heat exposure (hours)", y = "Survival (%)") +
    ggplot2::theme_minimal(base_size = 12) +
    ggplot2::theme(panel.grid.minor = ggplot2::element_blank(), panel.grid.major.x = ggplot2::element_blank(),
      strip.text = ggplot2::element_text(face = "bold", color = "#243b4a", size = 10),
      legend.position = "bottom", legend.text = ggplot2::element_text(size = 10),
      plot.margin = ggplot2::margin(12, 16, 8, 8), text = ggplot2::element_text(color = "#243b4a"))
}
