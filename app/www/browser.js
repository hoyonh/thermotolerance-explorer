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
  card.querySelectorAll('input[type=file], #load_manuscript').forEach(function(input) { input.disabled = true; });
});
// Manuscript dataset: fetch the pinned CSV from GitHub and hand R the exact bytes, so it is
// read and fingerprinted exactly like the same file chosen from disk.
function setManuscriptMessage(text, isError) {
  const el = document.getElementById('manuscript_message');
  if (el) { el.textContent = text; el.classList.toggle('is-error', !!isError); }
}
Shiny.addCustomMessageHandler('manuscriptStatus', function(m) { setManuscriptMessage(m.text, m.error); });
document.addEventListener('click', async function(event) {
  const button = event.target.closest('#load_manuscript');
  if (!button || button.disabled) return;
  button.disabled = true;
  setManuscriptMessage('Loading from GitHub…');
  try {
    const response = await fetch(button.dataset.url, { cache: 'no-store' });
    if (response.status === 404) throw new Error('The manuscript repository is not public yet, so the file cannot be loaded automatically. Use the GitHub link to download it.');
    if (!response.ok) throw new Error('GitHub returned an error (' + response.status + '). Try again later or download the file.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    setManuscriptMessage('Downloaded; reading…');
    Shiny.setInputValue('manuscript_csv', { name: button.dataset.name, data: btoa(binary), nonce: Date.now() }, { priority: 'event' });
  } catch (error) {
    setManuscriptMessage(error.message.startsWith('The manuscript') || error.message.startsWith('GitHub') ? error.message
      : 'Could not reach GitHub. Check the connection or download the file.', true);
  } finally {
    button.disabled = false;
  }
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
