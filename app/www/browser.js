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
