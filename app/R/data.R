# Pure data functions. These read source CSVs and never source the project's scripts.
source_files <- c(SKKU = "Lithgow_SKKU_ldh.csv", JHU = "Lithgow_NEWset3.csv")

# renderTable/xtable can print Date columns as their underlying day numbers.
# Format only presentation copies; keep Date types for filtering and exports.
format_table_dates <- function(d) {
  if (is.null(d)) return(d)
  for (name in names(d)) {
    if (inherits(d[[name]], "Date")) d[[name]] <- format(d[[name]], "%Y-%m-%d")
  }
  d
}
`%||%` <- function(x, y) if (is.null(x) || !length(x)) y else x
safe_page <- function(value, total) {
  page <- suppressWarnings(as.integer(value))
  if (length(page) != 1 || !is.finite(page)) page <- 1L
  max(1L, min(max(1L, total), page))
}

normalise_data <- function(d, source) {
  required <- c("strain", "genotype", "date", "hours", "alive", "dead", "Rup", "suicide", "missing", "expt", "row", "culture", "note")
  stopifnot(all(required %in% names(d)))
  d$source <- source
  d$source_row <- seq_len(nrow(d))
  d$observation_id <- paste(source, d$source_row, sep = ":")
  for (field in c("strain", "genotype", "culture", "bacteria", "config", "sync")) {
    if (!field %in% names(d)) d[[field]] <- "Not recorded"
    d[[paste0("raw_", field)]] <- d[[field]]
    d[[field]] <- as.character(d[[field]])
    d[[field]][is.na(d[[field]]) | !nzchar(d[[field]])] <- "Not recorded"
  }
  d$raw_date <- as.character(d$date)
  d$date <- suppressWarnings(as.Date(d$date, format = "%Y-%m-%d"))
  d$note[is.na(d$note)] <- ""
  d$strain <- sub(" .*", "", d$strain)
  if (source == "SKKU") {
    d$strain <- gsub("CB1370-SNU", "CB1370", d$strain, fixed = TRUE)
    # Exact replacements keep canonical OP50-1 labels idempotent.
    d$bacteria[d$bacteria == "OP50"] <- "OP50-1"
    d$bacteria[d$bacteria == "plain"] <- "OP50"
  } else {
    d$culture[d$culture == "15C"] <- "15°C"
    d$culture[d$culture == "20C"] <- "20°C"
    d$genotype <- gsub("daf-4(e1364); iw146", "bbs-9(iw146); daf-4(e1364)", d$genotype, fixed = TRUE)
    d$genotype <- gsub("arl-13(gk691642)", "arl-13(gk961642)", d$genotype, fixed = TRUE)
  }
  # Lab-confirmed metadata for the entire JHU legacy dataset. Preserve the
  # source values (including absent metadata) in the raw_* columns above.
  if (source == "JHU") {
    d$bacteria <- rep("OP50", nrow(d))
    d$config <- rep("standard", nrow(d))
    d$sync <- rep("standard", nrow(d))
  }
  count_fields <- c("alive", "dead", "Rup", "suicide", "missing")
  for (field in c(count_fields, "hours")) d[[field]] <- suppressWarnings(as.numeric(d[[field]]))
  counts <- as.matrix(d[count_fields])
  d$total <- rowSums(counts)
  d$valid <- apply(counts, 1, function(v) all(is.finite(v) & v >= 0 & v == floor(v))) &
    is.finite(d$hours) & d$hours >= 0 & is.finite(d$alive + d$dead) & (d$alive + d$dead) > 0
  d$survival_pct <- ifelse(d$valid, 100 * d$alive / (d$alive + d$dead), NA_real_)
  d$exclusion_reason <- ""
  add_reason <- function(mask, label) {
    mask[is.na(mask)] <- FALSE
    d$exclusion_reason[mask] <<- paste0(d$exclusion_reason[mask], label, "; ")
  }
  add_reason(!d$valid, "Invalid counts, time or zero survival denominator")
  add_reason(is.na(d$total) | d$total < 15, "Total below 15 or missing")
  if (source == "SKKU") {
    add_reason(d$note == "10 total", "SKKU note: 10 total")
  } else {
    add_reason(d$strain == "IW938cuz_4G", "Legacy excluded strain")
    add_reason(grepl("room_temp_high_setup|donotuse|odd_result_all|special_N2", d$note), "Legacy exclusion note")
    add_reason(grepl("20C-to-15C|15C-to-20C", d$raw_strain), "Temperature-shift assay")
  }
  d$exclusion_reason <- sub("; $", "", d$exclusion_reason)
  d$standard_included <- d$valid & !nzchar(d$exclusion_reason)
  value <- function(x) ifelse(is.na(x) | !nzchar(as.character(x)), "Not recorded", as.character(x))
  d$run_id <- paste(source, value(d$date), value(d$expt), sep = " / ")
  d$plate_id <- do.call(paste, c(lapply(d[c("run_id", "row", "raw_strain", "culture", "bacteria", "config", "sync")], value), sep = " | "))
  time_key <- paste(d$plate_id, d$hours)
  duplicate <- duplicated(time_key) | duplicated(time_key, fromLast = TRUE)
  bad_plates <- unique(d$plate_id[duplicate | is.na(d$row) | is.na(d$expt) | is.na(d$date)])
  d$ambiguous_plate <- d$plate_id %in% bad_plates
  d$plate_unit <- ifelse(d$ambiguous_plate, paste0("unresolved:", d$observation_id), d$plate_id)
  d
}

load_data <- function(project_dir, data_dir = Sys.getenv("THERMO_DATA_DIR", "")) {
  if (!nzchar(data_dir)) data_dir <- file.path(project_dir, "data")
  paths <- file.path(path.expand(data_dir), source_files)
  if (!all(file.exists(paths))) stop("Missing source CSV: ", paste(paths[!file.exists(paths)], collapse = ", "))
  frames <- lapply(seq_along(paths), function(i) normalise_data(read.csv(paths[i], stringsAsFactors = FALSE, check.names = FALSE), names(source_files)[i]))
  cols <- unique(unlist(lapply(frames, names)))
  frames <- lapply(frames, function(d) {
    for (col in setdiff(cols, names(d))) d[[col]] <- NA
    d[cols]
  })
  list(data = do.call(rbind, frames), hashes = setNames(as.character(tools::md5sum(paths)), names(source_files)),
       loaded_at = format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z"))
}

filter_data <- function(d, settings, apply_quality = TRUE) {
  keep <- d$source %in% settings$sources
  for (field in c("genotype", "strain", "culture", "bacteria", "config", "sync")) {
    values <- settings[[field]]
    if (length(values)) keep <- keep & d[[field]] %in% values
  }
  if (length(settings$dates) == 2) {
    dates <- as.Date(unlist(settings$dates))
    in_dates <- !is.na(d$date) & d$date >= dates[1] & d$date <= dates[2]
    keep <- keep & (in_dates | (isTRUE(settings$undated) & is.na(d$date)))
  }
  if (length(settings$hours) == 2) keep <- keep & is.finite(d$hours) & d$hours >= settings$hours[1] & d$hours <= settings$hours[2]
  if (length(settings$runs)) keep <- keep & d$run_id %in% settings$runs
  if (apply_quality) {
    keep <- keep & if (isTRUE(settings$quality)) d$standard_included else d$valid
    keep <- keep & !d$observation_id %in% settings$excluded
  }
  keep[is.na(keep)] <- FALSE
  d[keep, , drop = FALSE]
}

decorate_data <- function(d, group, facet) {
  d$curve <- as.character(d[[group]])
  d$panel <- if (facet == "none") rep("All selected observations", nrow(d)) else as.character(d[[facet]])
  d$panel[is.na(d$panel)] <- "Not recorded"
  d
}

summarise_curves <- function(d, unit = "plate") {
  if (!nrow(d)) return(data.frame())
  groups <- split(seq_len(nrow(d)), interaction(d$panel, d$curve, d$hours, drop = TRUE, lex.order = TRUE))
  result <- lapply(groups, function(idx) {
    z <- d[idx, , drop = FALSE]
    v <- if (unit == "run") vapply(split(z$survival_pct, z$run_id), mean, numeric(1)) else z$survival_pct
    n <- length(v)
    data.frame(panel = z$panel[1], curve = z$curve[1], hours = z$hours[1], mean = mean(v),
               sd = if (n > 1) sd(v) else NA_real_, se = if (n > 1) sd(v) / sqrt(n) else NA_real_,
               n_units = n, n_observations = nrow(z), n_runs = length(unique(z$run_id)),
               n_resolved_plates = length(unique(z$plate_id[!z$ambiguous_plate])),
               n_unresolved_observations = sum(z$ambiguous_plate), unit = unit,
               stringsAsFactors = FALSE)
  })
  result <- do.call(rbind, result)
  result[order(result$panel, result$curve, result$hours), , drop = FALSE]
}
