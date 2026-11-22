# Independent R reference for the viewer's row-position numbers (tests/rowfx.mjs).
# Normalisation and filtering come from the lab R explorer; row means and within-genotype deviations are plain base R written
# independently of rowfx.js. Usage: Rscript --vanilla tools/ref_rowfx.R <SKKU.csv> <JHU.csv> <out.csv>
# Independent R computation of row-position numbers: R explorer's own normalise/filter (reference for selection), then plain base-R summaries.
args <- commandArgs(TRUE); skku <- args[1]; jhu <- args[2]; out <- args[3]
root <- Sys.getenv("THERMO_PROJECT_ROOT", normalizePath(file.path(dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))), "..", "..")))
source(file.path(root, "thermotolerance_explorer", "R", "data.R"))   # the lab R explorer: reference for normalisation and filters
fr <- list(normalise_data(read.csv(skku, stringsAsFactors=FALSE, check.names=FALSE), "SKKU"),
           normalise_data(read.csv(jhu,  stringsAsFactors=FALSE, check.names=FALSE), "JHU"))
cols <- unique(unlist(lapply(fr, names))); fr <- lapply(fr, function(d){for (c in setdiff(cols,names(d))) d[[c]] <- NA; d[cols]})
d <- do.call(rbind, fr)
srcs <- c("SKKU","JHU"); mine <- d[d$source %in% srcs,]
dts <- sort(as.character(d$date[!is.na(d$date)]))
s <- list(sources=srcs, culture=intersect("20°C", mine$culture), bacteria=default_filter_selection(d, srcs)$bacteria,
          config=intersect(c("standard","bare"), mine$config), sync=intersect("standard", mine$sync),
          dates=c(dts[1], dts[length(dts)]), undated=TRUE, hours=c(2,3.5), runs=character(0), quality=TRUE, excluded=character(0),
          genotype=character(0), strain=character(0))
f <- filter_data(d, s)
f <- f[is.finite(f$survival_pct) & is.finite(f$row) & f$row == round(f$row), ]   # whole-number rows only, as in Supplementary Fig. 14
f$panel <- paste(f$source, f$config)
res <- list()
for (p in sort(unique(f$panel))) {
  x <- f[f$panel==p, ]
  dev <- function(key) { g <- split(seq_len(nrow(x)), key); do.call(rbind, lapply(g, function(i) { if (length(unique(x$row[i]))<2) return(NULL); data.frame(row=x$row[i], dev=x$survival_pct[i]-mean(x$survival_pct[i])) })) }
  gdev <- dev(paste(x$genotype, x$hours, sep="\001")); mdev <- dev(paste(x$run_id, x$genotype, x$hours, sep="\001"))
  for (r in sort(unique(x$row))) {
    z <- x[x$row==r,]; hm <- sapply(c(2,2.5,3,3.5), function(h) mean(z$survival_pct[z$hours==h]))
    g <- gdev$dev[gdev$row==r]; m <- if (!is.null(mdev)) mdev$dev[mdev$row==r] else numeric(0)
    res[[length(res)+1]] <- data.frame(panel=p, row=r, n_plates=nrow(z), mean_2_3.5h=if (all(is.finite(hm))) mean(hm) else NA,
      h2=hm[1],h25=hm[2],h3=hm[3],h35=hm[4], n_gen=length(g), gen_adj=if(length(g)) mean(g) else NA, n_mat=length(m), mat_adj=if(length(m)) mean(m) else NA)
  }
}
write.csv(do.call(rbind,res), out, row.names=FALSE); cat("rows kept by filter:", nrow(f), "\n")
