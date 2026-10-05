args <- commandArgs(trailingOnly = FALSE)
script <- sub("^--file=", "", args[grepl("^--file=", args)])
root <- dirname(normalizePath(script))
.libPaths(c(file.path(root, "library"), file.path(root, "../thermotolerance_explorer/library"), .libPaths()))
if (!requireNamespace("shinylive", quietly = TRUE)) stop("Install shinylive first; see README.md.")
if (!"--export-only" %in% commandArgs(trailingOnly = TRUE)) {
  status <- system2("python3", shQuote(file.path(root, "prepare.py")))
  if (status != 0) stop("App preparation failed")
}
# In a standalone publication repository, export the already generated app.
manifest <- jsonlite::read_json(file.path(root, "source-manifest.json"))
actual <- list.files(file.path(root, "app"), recursive = TRUE, all.files = TRUE)
actual <- actual[!dir.exists(file.path(root, "app", actual)) & basename(actual) != ".DS_Store"]
if (!setequal(actual, names(manifest))) stop("Unapproved app files: regenerate from the source allowlist.")
stage <- tempfile("thermo-browser-app-")
dir.create(stage)
for (name in names(manifest)) {
  target <- file.path(stage, name)
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
  if (!file.copy(file.path(root, "app", name), target)) stop("Could not stage ", name)
}
shinylive::export(stage, file.path(root, "site"),
  wasm_packages = TRUE, assets_version = "0.10.12",
  template_params = list(title = "Thermotolerance Explorer — local CSVs"))
file.create(file.path(root, "site", ".nojekyll"))
status <- system2("python3", shQuote(file.path(root, "audit.py")))
if (status != 0) stop("Publication audit failed")
message("Built site/. Publish only that directory, never the parent project or experimental data.")
