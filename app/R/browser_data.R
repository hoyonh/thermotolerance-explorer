# Browser-only file ingestion. Scientific normalization remains in shared R/data.R.
empty_browser_snapshot <- function() {
  fields <- c("strain", "genotype", "culture", "bacteria", "config", "sync", "run_id")
  d <- as.data.frame(setNames(rep(list(character()), length(fields)), fields))
  d$date <- as.Date(character()); d$hours <- numeric()
  list(data = d, hashes = character(), files = character(), loaded_at = "No CSV files selected")
}
browser_dates <- function(d) {
  x <- d$date[!is.na(d$date)]
  if (length(x)) range(x) else rep(Sys.Date(), 2)
}
browser_hours <- function(d) {
  x <- d$hours[is.finite(d$hours)]
  if (!length(x)) return(c(0, 4))
  r <- range(x)
  if (r[1] == r[2]) c(max(0, r[1] - 0.5), r[2] + 0.5) else r
}
read_browser_csv <- function(upload, source) {
  stopifnot(source %in% names(source_files))
  if (is.null(upload) || !nrow(upload)) stop("Choose a CSV file first.", call. = FALSE)
  if (upload$size[1] > 50 * 1024^2) stop("Choose a CSV smaller than 50 MB.", call. = FALSE)
  d <- read.csv(upload$datapath[1], stringsAsFactors = FALSE, check.names = FALSE)
  required <- c("strain", "genotype", "date", "hours", "alive", "dead", "Rup", "suicide", "missing", "expt", "row", "culture", "note")
  absent <- setdiff(required, names(d))
  if (length(absent)) stop("Missing columns: ", paste(absent, collapse = ", "), call. = FALSE)
  if (anyDuplicated(names(d))) stop("CSV column names must be unique.", call. = FALSE)
  if (!nrow(d)) stop("The CSV has headers but no observations.", call. = FALSE)
  normalized <- normalise_data(d, source)
  if (!any(normalized$valid)) stop("No usable observations: check counts and heat-exposure times.", call. = FALSE)
  list(data = normalized, hash = unname(as.character(tools::md5sum(upload$datapath[1]))),
       name = basename(upload$name[1]))
}
combine_browser_sources <- function(parts) {
  parts <- parts[intersect(names(source_files), names(parts))]
  parts <- parts[!vapply(parts, is.null, logical(1))]
  if (!length(parts)) return(empty_browser_snapshot())
  cols <- unique(unlist(lapply(parts, function(x) names(x$data))))
  frames <- lapply(parts, function(x) {
    d <- x$data
    for (col in setdiff(cols, names(d))) d[[col]] <- NA
    d[cols]
  })
  list(data = do.call(rbind, unname(frames)),
       hashes = vapply(parts, function(x) x$hash, character(1)),
       files = vapply(parts, function(x) x$name, character(1)),
       loaded_at = format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z"))
}
