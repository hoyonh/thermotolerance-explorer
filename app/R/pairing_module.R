paired_date_ui <- function(id, cutoff) {
  ns <- shiny::NS(id)
  div(class = "card paired-card",
    div(class = "card-heading", h2("Paired-date comparison"),
      actionButton(ns("example"), "Example: N2.thaw vs N2.therm")),
    p(class = "hint", "Compare contemporaneous groups first, then examine their difference over time. Uses the sidebar filters and exclusions."),
    div(class = "plot-controls",
      selectInput(ns("dimension"), "Compare by", c("Strain / stock" = "strain", "Genotype" = "genotype")),
      selectizeInput(ns("reference"), "Reference", choices = NULL),
      selectizeInput(ns("comparison"), "Comparison", choices = NULL),
      dateInput(ns("cutoff"), "Recent period begins", value = cutoff),
      selectInput(ns("hour"), "Time point for date trends", choices = NULL),
      numericInput(ns("page"), "Curve panel page (12 per page)", 1, min = 1, step = 1)),
    tags$details(tags$summary("Matching rules"),
      p(class = "hint", "Always match assay date, heat-exposure time, source, culture temperature, bacterial diet, configuration and synchronization. Genotype comparisons also keep the actual stock combinations separate across dates."),
      checkboxInput(ns("same_experiment"), "Also require the same experiment identifier", TRUE),
      checkboxInput(ns("separate_males"), "Keep male-labelled and other observations separate", TRUE),
      checkboxInput(ns("allow_unknown"), "Allow equal ‘Not recorded’ condition labels to match", FALSE),
      p(class = "hint", "Matching is based on recorded labels; it does not establish that unrecorded experimental conditions were identical.")),
    selectInput(ns("stratum"), "Matched conditions and stock combination", choices = NULL, width = "100%"),
    uiOutput(ns("coverage")),
    tabsetPanel(id = ns("tab"),
      tabPanel("Across dates", uiOutput(ns("period_message")),
        plotlyOutput(ns("absolute"), height = "340px"), plotlyOutput(ns("difference"), height = "340px"),
        tableOutput(ns("period_table")),
        p(class = "hint", "Each point uses only matched observations at the chosen hour. Average observations within each group and matching block, average blocks within a date, then give dates equal weight in each period. A positive gap means the comparison survived better. SE describes variation among date-level gaps; no significance test is performed.")),
      tabPanel("Paired curves", textOutput(ns("page_count")), uiOutput(ns("curve_container")),
        p(class = "hint", "Only time points observed in both groups within the same matching block are drawn. A date can contribute at one hour but be missing at another.")),
      tabPanel("Pairing audit", tableOutput(ns("audit_counts")),
        p(class = "hint", "The audit covers all sidebar-selected observations in the two chosen groups, before selecting a matched condition combination. First 100 unmatched observations shown; download the audit for every row."),
        tableOutput(ns("unmatched")))),
    div(class = "export-bar", downloadButton(ns("pdf"), "Paired report PDF"),
      downloadButton(ns("daily_csv"), "Paired dates CSV"), downloadButton(ns("blocks_csv"), "Matched blocks CSV"),
      downloadButton(ns("period_csv"), "Period summary CSV"), downloadButton(ns("audit_csv"), "Pairing audit CSV")))
}

paired_date_server <- function(id, data, default_cutoff) {
  shiny::moduleServer(id, function(input, output, session) {
    pending <- reactiveVal(NULL)
    valid_group <- reactive(input$dimension %||% "strain")
    observeEvent(list(data(), valid_group()), {
      values <- sort(unique(as.character(data()[[valid_group()]])))
      target <- pending()
      restoring <- !is.null(target) && identical(valid_group(), target$dimension)
      ref <- if (restoring) target$reference else isolate(input$reference)
      cmp <- if (restoring) target$comparison else isolate(input$comparison)
      if (!restoring && (length(ref) != 1 || is.na(ref) || !ref %in% values)) ref <- intersect(c("wild type", "N2.thaw", "N2"), values)[1]
      if (!length(ref) || is.na(ref)) ref <- head(values, 1)
      if (!restoring && (length(cmp) != 1 || !cmp %in% values || identical(cmp, ref))) cmp <- head(setdiff(values, ref), 1)
      updateSelectizeInput(session, "reference", choices = unique(c(values, ref)), selected = ref %||% character())
      updateSelectizeInput(session, "comparison", choices = unique(c(values, cmp)), selected = cmp %||% character())
    }, ignoreNULL = FALSE)
    result <- reactive({
      ref <- input$reference; cmp <- input$comparison
      validate(need(length(ref) == 1 && nzchar(ref) && length(cmp) == 1 && nzchar(cmp), "Select two groups. Clear the sidebar genotype or strain filters if a group is missing."),
               need(ref != cmp, "Choose different reference and comparison groups."))
      cutoff <- input$cutoff %||% default_cutoff
      pair_dates(data(), valid_group(), ref, cmp, cutoff,
        same_experiment = isTRUE(input$same_experiment), separate_males = isTRUE(input$separate_males),
        allow_unknown = isTRUE(input$allow_unknown))
    })
    observeEvent(result(), {
      p <- result()$pairs
      values <- if (nrow(p)) unique(p$pair_stratum) else character()
      labels <- if (nrow(p)) p$stratum_label[match(values, p$pair_stratum)] else character()
      target <- pending()
      chosen <- if (!is.null(target)) target$stratum else isolate(input$stratum)
      if (!is.null(target) && length(chosen) == 1 && !chosen %in% values) {
        values <- c(values, chosen); labels <- c(labels, "Saved combination (not currently available)")
      }
      if (!length(chosen) || !chosen %in% values) chosen <- head(values, 1)
      updateSelectInput(session, "stratum", choices = setNames(values, labels), selected = chosen %||% character())
    })
    selected_pairs <- reactive({
      p <- result()$pairs
      if (!nrow(p)) return(p)
      p[p$pair_stratum %in% input$stratum, , drop = FALSE]
    })
    observeEvent(selected_pairs(), {
      p <- selected_pairs()
      hours <- if (nrow(p)) sort(unique(p$hours)) else numeric()
      target <- pending()
      hour <- if (!is.null(target)) target$hour else isolate(input$hour)
      if (!is.null(target) && length(hour) == 1 && !hour %in% hours) hours <- sort(unique(c(hours, as.numeric(hour))))
      if (!length(hour) || !hour %in% hours) hour <- if (3 %in% hours) 3 else head(hours, 1)
      updateSelectInput(session, "hour", choices = hours, selected = hour %||% character())
    })
    observeEvent(list(input$reference, input$comparison, input$stratum, input$hour), {
      target <- pending()
      if (!is.null(target) && identical(input$reference, target$reference) && identical(input$comparison, target$comparison) &&
          (is.null(target$stratum) || identical(input$stratum, target$stratum)) &&
          (is.null(target$hour) || identical(as.character(input$hour), as.character(target$hour)))) pending(NULL)
    })
    daily <- reactive(paired_daily(selected_pairs(), suppressWarnings(as.numeric(input$hour))))
    periods <- reactive(paired_period_summary(daily()))
    require_daily <- function() validate(need(nrow(daily()) > 0,
      "No paired observations at this time point. Choose a matched condition combination or check the pairing audit."))
    panel_names <- reactive(sort(unique(selected_pairs()$pair_panel)))
    page_pairs <- reactive({
      p <- selected_pairs()
      if (!nrow(p)) return(p)
      page <- safe_page(input$page, ceiling(length(panel_names()) / 12))
      names <- panel_names()[seq_along(panel_names()) %in% seq((page - 1) * 12 + 1, page * 12)]
      p[p$pair_panel %in% names, , drop = FALSE]
    })
    output$coverage <- renderUI({
      r <- result(); p <- selected_pairs(); a <- r$audit
      chosen <- a$pair_status == "Paired" & a$pair_stratum %in% input$stratum
      dates <- daily()
      text <- paste0(sum(chosen), " of ", nrow(a), " candidate observations in the selected matched combination (all hours). ",
        sum(a$pair_status != "Paired"), " observations could not be paired. ",
        sum(a$pair_status == "Paired" & !chosen), " paired observations belong to other condition/stock combinations.")
      if (nrow(dates)) text <- paste0(text, " At ", input$hour, " h: ", sum(dates$period == "Historic"), " historic and ", sum(dates$period == "Recent"), " recent paired dates.")
      if (!nrow(r$pairs)) text <- paste0(text, " No shared observations under these rules. See Pairing audit; a missing match is not a zero difference.")
      if (isTRUE(input$allow_unknown)) text <- paste(text, "Unknown metadata are allowed to match; equivalence of those conditions cannot be checked.")
      if (nrow(p) && any(p$n_unresolved > 0)) text <- paste(text, "Some contributing observations have unresolved plate identity; see the audit.")
      div(class = "notice", text)
    })
    output$period_message <- renderUI({
      s <- periods()
      if (!nrow(s)) return(NULL)
      if (!all(c("Historic", "Recent") %in% s$period)) return(p(class = "notice", "Only one period has paired dates for this exact condition/stock combination. Historic-versus-recent change is not estimable from this selection."))
      h <- s[s$period == "Historic", ]; r <- s[s$period == "Recent", ]
      p(class = "paired-change", sprintf("Recent − historic: reference %+.1f pp · comparison %+.1f pp · paired gap %+.1f pp.",
        r$reference_mean - h$reference_mean, r$comparison_mean - h$comparison_mean, r$difference_pp - h$difference_pp))
    })
    widget <- function(p) config(ggplotly(p, tooltip = "text"), displaylogo = FALSE)
    output$absolute <- renderPlotly({ require_daily(); widget(paired_trend_plot(daily())) })
    output$difference <- renderPlotly({ require_daily(); widget(paired_trend_plot(daily(), TRUE)) })
    output$curve_container <- renderUI(plotlyOutput(session$ns("curves"), height = paste0(max(350, ceiling(min(12, length(panel_names())) / 3) * 220 + 110), "px")))
    output$curves <- renderPlotly({
      validate(need(nrow(page_pairs()) > 0, "No matched curves for these groups and conditions."))
      widget(paired_curve_plot(page_pairs()))
    })
    output$page_count <- renderText(paste(length(panel_names()), "matched date/experiment panels ·", max(1, ceiling(length(panel_names()) / 12)), "pages"))
    output$period_table <- renderTable({
      s <- periods()
      if (nrow(s)) s[c("period", "n_dates", "n_blocks", "reference_mean", "comparison_mean", "difference_pp", "difference_se")]
    }, digits = 2, striped = TRUE, na = "—")
    output$audit_counts <- renderTable(as.data.frame(table(result()$audit$pair_status), responseName = "Observations"), striped = TRUE)
    output$unmatched <- renderTable({
      a <- result()$audit
      format_table_dates(head(a[a$pair_status != "Paired", c("observation_id", "date", "hours", "strain", "expt", "culture", "bacteria", "config", "pair_status")], 100))
    }, striped = TRUE, na = "—")
    output$daily_csv <- downloadHandler(filename = "paired_dates.csv", content = function(file) write.csv(daily(), file, row.names = FALSE, na = ""))
    output$blocks_csv <- downloadHandler(filename = "matched_blocks.csv", content = function(file) write.csv(selected_pairs(), file, row.names = FALSE, na = ""))
    output$period_csv <- downloadHandler(filename = "paired_period_summary.csv", content = function(file) write.csv(periods(), file, row.names = FALSE, na = ""))
    output$audit_csv <- downloadHandler(filename = "pairing_audit.csv", content = function(file) {
      a <- result()$audit; a$selected_combination <- a$pair_stratum %in% input$stratum
      write.csv(a, file, row.names = FALSE, na = "")
    })
    output$pdf <- downloadHandler(filename = "paired_date_report.pdf", content = function(file) {
      require_daily()
      grDevices::cairo_pdf(file, width = 11, height = 8)
      on.exit(grDevices::dev.off())
      caption <- paste("Recent begins", input$cutoff, "·", selected_pairs()$stratum_label[1])
      print(paired_trend_plot(daily()) + ggplot2::labs(caption = paste(strwrap(caption, 120), collapse = "\n")))
      print(paired_trend_plot(daily(), TRUE) + ggplot2::labs(caption = paste(strwrap(caption, 120), collapse = "\n")))
      if (nrow(page_pairs())) print(paired_curve_plot(page_pairs()))
    })
    restore <- function(s) {
      stopifnot(is.list(s), s$dimension %in% c("strain", "genotype"),
        length(s$reference) == 1, length(s$comparison) == 1, s$reference != s$comparison,
        length(s$cutoff) == 1, !is.na(as.Date(s$cutoff)))
      pending(s)
      updateSelectInput(session, "dimension", selected = s$dimension)
      updateSelectizeInput(session, "reference", choices = unique(c(data()[[s$dimension]], s$reference)), selected = s$reference)
      updateSelectizeInput(session, "comparison", choices = unique(c(data()[[s$dimension]], s$comparison)), selected = s$comparison)
      updateDateInput(session, "cutoff", value = s$cutoff)
      for (field in c("same_experiment", "separate_males", "allow_unknown")) updateCheckboxInput(session, field, value = isTRUE(s[[field]]))
      if (length(s$stratum)) updateSelectInput(session, "stratum", choices = s$stratum, selected = s$stratum)
      if (length(s$hour)) updateSelectInput(session, "hour", choices = s$hour, selected = s$hour)
      updateNumericInput(session, "page", value = safe_page(s$page, .Machine$integer.max))
    }
    list(settings = reactive(list(dimension = valid_group(), reference = input$reference, comparison = input$comparison,
      cutoff = as.character(input$cutoff %||% default_cutoff), hour = input$hour, stratum = input$stratum,
      same_experiment = input$same_experiment, separate_males = input$separate_males, allow_unknown = input$allow_unknown, page = input$page)),
      restore = restore, example = reactive(input$example))
  })
}
