auc_ui <- function(id) {
  ns <- NS(id)
  div(class = "card detail-card", h2("Area under the curve (AUC)"),
    p(class = "hint", "Trapezoidal AUC at 2, 2.5, 3 and 3.5 h · units: % survival × hours · range 0–150. Uses all sidebar-filtered data and the main Color / compare and Mean weighting controls, independently of plot panels or page."),
    tabsetPanel(id = ns("tab"),
      tabPanel("All selected data", tableOutput(ns("all_table")),
        p(class = "hint", "AUC of each group's mean curve. All available observations at each required hour contribute; the contributing dates can differ across hours. A missing required hour gives an undefined AUC. Mean survival is AUC / 1.5 h."),
        downloadButton(ns("all_csv"), "All-selected AUC CSV")),
      tabPanel("Paired AUC",
        div(class = "plot-controls", selectizeInput(ns("reference"), "Reference group", choices = NULL),
          selectizeInput(ns("comparison"), "Comparison group", choices = NULL)),
        p(class = "hint", "Requires both groups to have all four timepoints on the same assay date and in the same source. Computes one AUC per group/date, then gives each shared date equal weight. This is date completeness matching; use sidebar filters to hold diet, temperature and other conditions constant. It is separate from the stricter Paired-date comparison below."),
        uiOutput(ns("coverage")), tableOutput(ns("paired_summary")),
        tableOutput(ns("paired_dates")),
        p(class = "hint", "First 100 date pairs shown. Difference = comparison − reference, in % survival × hours. SE is across date-level differences; undefined with only one date pair."),
        tags$details(tags$summary("Excluded dates and missing timepoints"), tableOutput(ns("audit"))),
        div(class = "export-bar", downloadButton(ns("paired_csv"), "Paired AUC dates CSV"),
          downloadButton(ns("summary_csv"), "Paired AUC summary CSV"), downloadButton(ns("audit_csv"), "Date completeness audit CSV"),
          downloadButton(ns("undated_csv"), "Undated observations CSV")))))
}

auc_server <- function(id, data, group, unit) {
  moduleServer(id, function(input, output, session) {
    pending <- reactiveVal(NULL)
    observeEvent(list(data(), group(), pending()), {
      choices <- sort(unique(as.character(data()[[group()]])))
      target <- pending()
      ref <- if (is.null(target)) isolate(input$reference) else target$reference
      cmp <- if (is.null(target)) isolate(input$comparison) else target$comparison
      if (!is.null(target)) choices <- unique(c(choices, ref, cmp))
      if (length(ref) != 1 || !ref %in% choices) ref <- head(c(intersect(c("wild type", "N2.thaw", "N2"), choices), choices), 1)
      if (length(cmp) != 1 || !cmp %in% choices || identical(ref, cmp)) cmp <- head(setdiff(choices, ref), 1)
      updateSelectizeInput(session, "reference", choices = choices, selected = ref %||% character())
      updateSelectizeInput(session, "comparison", choices = choices, selected = cmp %||% character())
    })
    observeEvent(list(input$reference, input$comparison), {
      s <- pending()
      if (!is.null(s) && identical(input$reference, s$reference) && identical(input$comparison, s$comparison)) pending(NULL)
    })
    all_auc <- reactive(all_selected_auc(data(), group(), unit()))
    paired <- reactive({
      validate(need(length(input$reference) == 1 && nzchar(input$reference) && length(input$comparison) == 1 && nzchar(input$comparison), "Select two groups using the sidebar and Color / compare control."),
        need(input$reference != input$comparison, "Choose two different groups."))
      complete_date_auc(data(), group(), input$reference, input$comparison, unit())
    })
    paired_summary <- reactive(summarise_paired_auc(paired()$pairs))
    output$all_table <- renderTable({
      z <- all_auc()
      if (nrow(z)) z[c("group", "time_period", "auc_pct_h", "mean_survival_pct", "status", "n_2h", "n_2_5h", "n_3h", "n_3_5h")]
    }, digits = 2, striped = TRUE, na = "—")
    output$coverage <- renderUI({
      r <- paired()
      text <- paste(nrow(r$pairs), "complete shared source/date pairs retained out of", nrow(r$audit), "candidate source/dates.",
        nrow(r$undated), "undated observations cannot enter paired AUC.")
      if (!nrow(r$pairs)) text <- paste(text, "Paired AUC is not estimable: neither missing timepoints nor unmatched dates are filled in.")
      z <- data(); z <- z[z[[group()]] %in% c(input$reference, input$comparison) & z$hours %in% auc_hours, , drop = FALSE]
      mixed <- c("culture", "bacteria", "config", "sync")
      mixed <- mixed[vapply(mixed, function(f) length(unique(z[[f]])) > 1, logical(1))]
      if (length(mixed)) text <- paste(text, "Selection varies in", paste(mixed, collapse = ", "), "— date matching alone does not control these conditions.")
      div(class = "notice", text)
    })
    output$paired_summary <- renderTable(paired_summary(), digits = 2, striped = TRUE, na = "—")
    output$paired_dates <- renderTable({
      z <- paired()$pairs
      if (nrow(z)) format_table_dates(head(z[c("source", "date", "time_period", "reference_auc", "comparison_auc", "difference_pct_h")], 100))
    }, digits = 2, striped = TRUE, na = "—")
    output$audit <- renderTable({
      z <- paired()$audit
      if (nrow(z)) format_table_dates(head(z[!z$eligible, c("source", "date", "time_period", "reference_status", "comparison_status")], 100))
    }, striped = TRUE, na = "—")
    output$all_csv <- downloadHandler(filename = "auc_all_selected.csv", content = function(file) write.csv(all_auc(), file, row.names = FALSE, na = ""))
    output$paired_csv <- downloadHandler(filename = "auc_paired_dates.csv", content = function(file) write.csv(paired()$pairs, file, row.names = FALSE, na = ""))
    output$summary_csv <- downloadHandler(filename = "auc_paired_summary.csv", content = function(file) write.csv(paired_summary(), file, row.names = FALSE, na = ""))
    output$audit_csv <- downloadHandler(filename = "auc_date_audit.csv", content = function(file) write.csv(paired()$audit, file, row.names = FALSE, na = ""))
    output$undated_csv <- downloadHandler(filename = "auc_undated_observations.csv", content = function(file) write.csv(paired()$undated, file, row.names = FALSE, na = ""))
    list(settings = reactive(list(reference = input$reference, comparison = input$comparison)),
      restore = function(s) {
        stopifnot(length(s$reference) == 1, length(s$comparison) == 1, s$reference != s$comparison)
        pending(s)
      })
  })
}
