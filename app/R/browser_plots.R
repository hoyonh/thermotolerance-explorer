# webR's POSIX date-break path can fail in ggplotly. Use explicit Date ticks;
# the underlying paired calculations and plotted values are unchanged.
# Ticks are spaced evenly in time (not by assay index) so clustered dates do not overlap.
browser_paired_plot <- function(shared_plot) {
  force(shared_plot)
  function(daily, difference = FALSE) {
    x <- daily$date[!is.na(daily$date)]
    # With no dates, keep an explicit empty break set; automatic breaks fail on an empty range.
    dates <- if (!length(x)) x else if (min(x) == max(x)) min(x) else
      unique(as.Date(round(seq(as.numeric(min(x)), as.numeric(max(x)), length.out = 6)), origin = "1970-01-01"))
    shared_plot(daily, difference) + ggplot2::scale_x_date(breaks = dates, labels = format(dates, "%Y-%m-%d"))
  }
}
