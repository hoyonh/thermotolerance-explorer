// webR overflows WebKit's smaller call stack during app startup (posit-dev/r-shinylive#204),
// so file selection would silently do nothing. Explain instead. All iOS/iPadOS browsers are WebKit.
document.addEventListener('DOMContentLoaded', function() {
  const ua = navigator.userAgent;
  if (!/AppleWebKit/.test(ua) || /Chrome\/|Chromium\/|Edg\//.test(ua)) return;
  const card = document.querySelector('.file-card');
  if (!card) return;
  const note = document.createElement('div');
  note.className = 'notice browser-unsupported';
  note.setAttribute('role', 'alert');
  note.innerHTML = '<strong>Safari is not supported yet.</strong> The analysis engine crashes in Safari, so selected files are never loaded. ' +
    'Open this page in <strong>Chrome</strong> or <strong>Edge</strong>. On iPhone and iPad every browser uses Safari’s engine, so use a computer.';
  card.insertBefore(note, card.querySelector('h2').nextSibling);
  card.querySelectorAll('input[type=file]').forEach(function(input) { input.disabled = true; });
});
// Local browser downloads: fetch through Shinylive's service worker, then save a Blob.
// This avoids browser download navigations bypassing the virtual R server.
Shiny.addCustomMessageHandler('clearFileInput', function(id) {
  const el = document.getElementById(id);
  if (el) {
    el.value = '';
    const label = el.closest('.shiny-input-container').querySelector('input[type=text]');
    if (label) label.value = '';
  }
});
document.addEventListener('click', async function(event) {
  const link = event.target.closest('a.shiny-download-link');
  if (!link || !link.href || link.classList.contains('disabled')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (link.dataset.busy) return;
  link.dataset.busy = 'true'; link.setAttribute('aria-busy', 'true');
  const original = link.innerHTML;
  link.textContent = 'Preparing download…';
  try {
    const response = await fetch(link.href);
    if (!response.ok) throw new Error('Download failed (' + response.status + '). Check your selection and try again.');
    const disposition = response.headers.get('Content-Disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : 'thermotolerance-export';
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    window.alert(error.message);
  } finally {
    link.innerHTML = original; delete link.dataset.busy; link.removeAttribute('aria-busy');
  }
}, true);
