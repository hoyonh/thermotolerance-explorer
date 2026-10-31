# Plain-language meanings for condition codes, from data/glossary.csv and data/config_glossary.csv.
# Codes stay the filter values; the glossary only adds labels, so filters, views and exports are unchanged.
glossary_categories <- c(sync = "synchronization", bacteria = "bacterial diet", config = "configuration")
glossary_columns <- list(terms = c("item", "category", "definition"),
  configs = c("config", "label1", "synchronization", "growth", "assay"))

read_glossary <- function(dir) {
  read <- function(name, cols) {
    path <- file.path(dir, "data", name)
    if (!file.exists(path)) return(as.data.frame(setNames(rep(list(character()), length(cols)), cols), stringsAsFactors = FALSE))
    d <- read.csv(path, stringsAsFactors = FALSE, check.names = FALSE, na.strings = character(), colClasses = "character", fileEncoding = "UTF-8")
    absent <- setdiff(cols, names(d))
    if (length(absent)) stop(name, " is missing columns: ", paste(absent, collapse = ", "), call. = FALSE)
    d <- d[cols]
    d[] <- lapply(d, trimws)
    d
  }
  list(terms = read("glossary.csv", glossary_columns$terms), configs = read("config_glossary.csv", glossary_columns$configs))
}

define_term <- function(g, category, item) {
  hit <- g$terms$definition[g$terms$category == category & g$terms$item == item]
  if (length(hit) && nzchar(hit[1])) hit[1] else NA_character_
}
first_sentence <- function(x) sub("^(.+?\\.)\\s.*$", "\\1", x, perl = TRUE)

# A configuration code has two meanings: the incubator setup (standard unless bare or cfloor)
# and the plate preparation (synchronization, growth plate, assay plate).
config_parts <- function(g, code) {
  row <- g$configs[g$configs$config == code, , drop = FALSE]
  incubator <- define_term(g, "configuration", if (code %in% c("bare", "cfloor")) code else "standard")
  if (!nrow(row)) return(if (code %in% g$terms$item[g$terms$category == "configuration"]) c(Incubator = incubator) else character())
  parts <- c(Label = if (code %in% c("bare", "cfloor")) "" else row$label1[1], Incubator = incubator,
    Synchronization = first_sentence(define_term(g, "synchronization", row$synchronization[1])),
    Growth = first_sentence(define_term(g, "growth", row$growth[1])),
    Assay = first_sentence(define_term(g, "assay", row$assay[1])))
  parts[!is.na(parts) & nzchar(parts)]
}

describe_code <- function(g, field, code) {
  if (identical(field, "config")) {
    parts <- config_parts(g, code)
    return(unname(paste0(ifelse(names(parts) == "Label", "", paste0(names(parts), ": ")), parts)))
  }
  if (!field %in% names(glossary_categories)) return(character())
  x <- define_term(g, glossary_categories[[field]], code)
  if (is.na(x)) character() else x
}

# Filter choices: the value stays the code; the label carries the code plus its meaning on later lines.
field_choices <- function(field, values, g = glossary) {
  values <- sort(unique(as.character(values)))
  if (!field %in% names(glossary_categories) || !length(values)) return(values)
  setNames(values, vapply(values, function(v) paste(c(v, describe_code(g, field, v)), collapse = "\n"), character(1)))
}

# Dropdown shows the code with its meaning beneath; the chosen chip shows the code only.
# An open list can be dragged off the plot (see glossary_script); its header says so and resets it.
glossary_select_options <- list(dropdownParent = "body", dropdownClass = "glossary-dropdown",
  plugins = list("remove_button", list(name = "dropdown_header", options = list(title = "\u283f Drag the list to move it off the plot \u00b7 double-click here to reset"))),
  render = I("{option: function(item, escape) { var lines = String(item.label).split('\\n');
    return '<div class=\"option glossary-option\"><div class=\"glossary-code\">' + escape(lines[0]) + '</div>' +
      lines.slice(1).map(function(x) { return '<div class=\"glossary-line\">' + escape(x) + '</div>'; }).join('') + '</div>'; },
  item: function(item, escape) { return '<div class=\"item\">' + escape(item.value) + '</div>'; }}"))

info_label <- function(label, tip) tagList(label, span(class = "info-tip", tabindex = "0", role = "button", `aria-label` = paste("About", label), `data-title` = label, `data-tip` = tip, "i"))

# Moving explanations out of the way: drag an open filter list from anywhere on it (kept as a transform,
# because selectize re-positions the list), and click an info icon to pin a draggable card.
glossary_script <- tags$script(HTML(r"---(
(function () {
  function place(panel, dx, dy) {
    panel.dataset.dx = dx; panel.dataset.dy = dy;
    panel.style.transform = dx || dy ? 'translate(' + dx + 'px,' + dy + 'px)' : '';
  }
  var zones = '.glossary-dropdown, .tip-card-bar', resets = '.glossary-dropdown .selectize-dropdown-header, .tip-card-bar';
  function panelOf(el) { return el.closest('.glossary-dropdown, .tip-card'); }
  // A filter list moves from anywhere on it; a card from its title bar. A press that moves under 5 px
  // stays a click (selecting a code). Capture phase, before selectize's handlers, so dragging neither
  // selects, closes nor blurs the list.
  window.addEventListener('mousedown', function (e) {
    var zone = e.button === 0 && e.target.closest && e.target.closest(zones);
    if (!zone || e.target.closest('.selectize-dropdown-header-close, .tip-card-close')) return;
    var scroller = e.target.closest('.selectize-dropdown-content');
    if (scroller && e.clientX > scroller.getBoundingClientRect().left + scroller.clientWidth) return;  // scrollbar
    var panel = panelOf(zone);
    e.preventDefault(); e.stopPropagation();
    var x0 = e.clientX, y0 = e.clientY, dx = +panel.dataset.dx || 0, dy = +panel.dataset.dy || 0, moved = false;
    function move(m) {
      if (!moved && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
      moved = true; panel.classList.add('dragging');
      place(panel, dx + m.clientX - x0, dy + m.clientY - y0);
    }
    function up(u) {
      window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true);
      panel.classList.remove('dragging');
      if (!moved) return;
      u.stopPropagation();  // selectize selects an option on mouseup as well as click
      function swallow(c) { c.preventDefault(); c.stopPropagation(); window.removeEventListener('click', swallow, true); }
      window.addEventListener('click', swallow, true);
      setTimeout(function () { window.removeEventListener('click', swallow, true); }, 0);
    }
    window.addEventListener('mousemove', move, true); window.addEventListener('mouseup', up, true);
  }, true);
  window.addEventListener('dblclick', function (e) {
    var handle = e.target.closest && e.target.closest(resets);
    if (handle) { e.stopPropagation(); place(panelOf(handle), 0, 0); }
  }, true);
  function closeCard(card) { card.tip.classList.remove('pinned'); card.tip.card = null; card.remove(); }
  function toggleCard(tip) {
    if (tip.card) return closeCard(tip.card);
    var card = document.createElement('div'), bar = document.createElement('div'), title = document.createElement('span'),
      close = document.createElement('button'), body = document.createElement('div');
    card.className = 'tip-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', tip.dataset.title);
    bar.className = 'tip-card-bar'; title.textContent = tip.dataset.title;
    close.className = 'tip-card-close'; close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.textContent = '×';
    close.addEventListener('click', function () { closeCard(card); tip.focus(); });
    body.className = 'tip-card-body'; body.textContent = tip.dataset.tip;
    bar.append(title, close); card.append(bar, body); card.tip = tip; tip.card = card;
    var r = tip.getBoundingClientRect();
    card.style.left = Math.max(8, Math.min(r.left - 8, window.innerWidth - 288)) + 'px';
    card.style.top = Math.min(r.bottom + 6, window.innerHeight - 160) + 'px';
    document.body.appendChild(card); tip.classList.add('pinned');
  }
  // The icon sits inside the filter's label: stop the click from also opening the filter.
  document.addEventListener('click', function (e) {
    var tip = e.target.closest && e.target.closest('.info-tip');
    if (tip) { e.preventDefault(); e.stopPropagation(); toggleCard(tip); }
  }, true);
  document.addEventListener('keydown', function (e) {
    var tip = e.target.closest && e.target.closest('.info-tip');
    if (tip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleCard(tip); }
    if (e.key === 'Escape') document.querySelectorAll('.tip-card').forEach(closeCard);
  });
})();
)---"))

glossary_headings <- c(synchronization = "Synchronization", growth = "Growth plates", assay = "Assay plates", medium = "Media",
  configuration = "Incubator setup", `bacterial diet` = "Bacterial diet", term = "Terms")

glossary_table <- function(header, rows) tags$table(class = "table table-striped table-condensed glossary-table",
  tags$thead(tags$tr(lapply(header, tags$th))), tags$tbody(lapply(rows, function(r) tags$tr(lapply(r, tags$td)))))

# Glossary tab: configuration codes in the loaded data (all glossary codes when none is loaded), then every term by category.
glossary_ui <- function(g, configs_in_data = character()) {
  codes <- if (length(configs_in_data)) sort(unique(configs_in_data)) else g$configs$config
  config_rows <- lapply(codes, function(code) {
    row <- g$configs[g$configs$config == code, , drop = FALSE]
    incubator <- if (code %in% c("bare", "cfloor")) code else "standard"
    if (!nrow(row)) return(list(tags$code(code), if (code %in% c("bare", "cfloor", "standard")) "" else tags$em("Not in config_glossary.csv"), incubator, "", "", ""))
    list(tags$code(code), row$label1, incubator, row$synchronization, row$growth, row$assay)
  })
  categories <- unique(c(intersect(names(glossary_headings), g$terms$category), g$terms$category))
  tagList(
    p("Plain-language meanings of the condition codes used in the filters. Open a Bacterial diet, Configuration or Synchronization filter to see the same meanings next to each code."),
    h3("Configuration codes"),
    p(class = "hint", "A configuration code gives two things: the incubator setup, and how the worms and plates were prepared (synchronization, growth plate, assay plate). Every assay used the standard incubator setup (inner container on a rack) unless the code is bare or cfloor. The parts are defined in the sections below."),
    glossary_table(c("Code", "Plot label", "Incubator", "Synchronization", "Growth plate", "Assay plate"), config_rows),
    lapply(categories, function(category) {
      terms <- g$terms[g$terms$category == category, , drop = FALSE]
      tagList(h3(if (category %in% names(glossary_headings)) glossary_headings[[category]] else tools::toTitleCase(category)),
        glossary_table(c("Code", "Meaning"), Map(function(item, definition) list(tags$code(item), definition), terms$item, terms$definition)))
    }))
}
