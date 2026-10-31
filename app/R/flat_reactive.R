# Browser build only: lets the explorer run in Safari and other WebKit browsers.
# Shiny evaluates a chain of reactives by nesting: reading r3() evaluates r2(), which evaluates r1().
# Under webR, each level costs so much of the JavaScript stack that WebKit's smaller stack overflows
# ("Maximum call stack size exceeded", posit-dev/r-shinylive#204) once a chain stops at req().
# Here each reactive is computed by its own observer and its result stored; reading it returns the
# stored result, so no chain is ever evaluated inside another. Errors, including req() and
# validate(), are stored and re-raised to the reader, as Shiny does.
# Cost: every reactive is recomputed when its inputs change, even if nothing currently shows it.
reactive <- function(x, env = parent.frame(), quoted = FALSE, ..., label = NULL) {
  force(env)
  expr <- if (quoted) x else substitute(x)
  pending <- structure(class = c("shiny.silent.error", "validation", "error", "condition"), list(message = "", call = NULL))
  result <- shiny::reactiveVal(list(ok = FALSE, error = pending))
  shiny::observe(result(tryCatch(list(ok = TRUE, value = eval(expr, env)), error = function(e) list(ok = FALSE, error = e))),
    priority = 100, label = label)
  function() {
    r <- result()
    if (!r$ok) stop(r$error)
    r$value
  }
}
