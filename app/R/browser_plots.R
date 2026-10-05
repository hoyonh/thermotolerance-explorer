# webR's POSIX date-break path can fail in ggplotly. Use explicit Date ticks;
# the underlying paired calculations and plotted values are unchanged.
browser_paired_plot <- function(shared_plot) {
  force(shared_plot)
  function(daily, difference = FALSE) {
    dates <- sort(unique(daily$date[!is.na(daily$date)]))
    if (length(dates) > 6) dates <- dates[unique(round(seq(1, length(dates), length.out = 6)))]
    shared_plot(daily, difference) + ggplot2::scale_x_date(breaks = dates, labels = format(dates, "%Y-%m-%d"))
  }
}
