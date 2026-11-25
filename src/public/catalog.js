const rows = [...document.querySelectorAll('tbody tr[data-id]')];
const checks = [...document.querySelectorAll('.select:enabled')];
const all = document.querySelector('#all');
const selectAllPages = document.querySelector('#select-all-pages');
const clearSelection = document.querySelector('#clear-selection');
const selected = new Map();
const bulk = document.querySelector('#bulk');
const status = document.querySelector('#status');
const selectionStatus = document.querySelector('#selection-status');
const results = document.querySelector('#results');
const bulkPanel = document.querySelector('#bulk-progress');
const bulkCounts = document.querySelector('#bulk-counts');
const bulkMeter = document.querySelector('#bulk-meter');
const dialog = document.querySelector('#preview');
const singleUrl = document.querySelector('#single-url');
let busy = false;

function showStatus(message, failed = false) {
  status.hidden = false;
  status.textContent = message;
  status.classList.toggle('error', failed);
}

function updateSelection() {
  let visible = 0;
  for (const check of checks) {
    check.checked = selected.has(check.closest('tr').dataset.id);
    if (check.checked) visible++;
  }
  const count = selected.size;
  const hasOffPageSelection = count > visible;
  all.disabled = !checks.length && selectAllPages.disabled;
  all.checked = visible > 0 && visible === checks.length;
  all.indeterminate = !all.checked && count > 0;
  all.setAttribute('aria-label', hasOffPageSelection
    ? 'Clear selections on all pages'
    : 'Select or clear products on this page. Double-click to select all pages.');
  bulk.disabled = !count;
  clearSelection.hidden = !count;
  bulk.textContent = count ? 'Update selected (' + count + ')' : 'Update selected';
  selectionStatus.hidden = !count;
  selectionStatus.textContent = count
    ? count.toLocaleString() + (count === 1 ? ' product selected' : ' products selected') +
      (hasOffPageSelection ? ' across all pages.' : ' on this page.')
    : '';
}

all.addEventListener('change', () => {
  if (!busy) {
    const visible = checks.filter(check => check.checked).length;
    if (!all.checked || selected.size > visible) selected.clear();
    else for (const check of checks) changeSelection(check, true);
  }
  updateSelection();
});
for (const check of checks) check.addEventListener('change', () => {
  if (!busy) changeSelection(check, check.checked);
  updateSelection();
});
clearSelection.addEventListener('click', () => {
  if (busy) return;
  selected.clear();
  updateSelection();
});
all.addEventListener('dblclick', selectAcrossPages);
selectAllPages.addEventListener('click', selectAcrossPages);
updateSelection();

async function post(endpoint, payload) {
  const response = await fetch('/api/catalog/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function productFrom(row) {
  return { id: row.dataset.id, url: row.dataset.new, expectedUrl: row.dataset.original };
}

function changeSelection(check, checked) {
  const product = productFrom(check.closest('tr'));
  if (checked) selected.set(product.id, product);
  else selected.delete(product.id);
}

async function selectAcrossPages() {
  if (busy || selectAllPages.disabled) return;
  busy = true;
  showStatus('Selecting products across all pages…');
  try {
    const response = await fetch('/api/catalog/proposed-updates' + location.search);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to select products.');
    selected.clear();
    for (const product of data) selected.set(product.id, product);
    updateSelection();
    if (selected.size) status.hidden = true;
    else showStatus('No products have a proposed link change.');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    busy = false;
  }
}

async function trackBulkUpdate(products) {
  let updated = 0;
  let failed = 0;
  const updateCounts = () => {
    bulkMeter.value = updated + failed;
    bulkCounts.textContent = (updated + failed) + ' of ' + products.length +
      ' processed · ' + updated + ' updated · ' + failed + ' failed';
  };
  bulkMeter.max = products.length;
  results.replaceChildren();
  bulkPanel.hidden = false;
  updateCounts();

  let rateLimited = false;
  const report = result => {
    if (result.status === 'updated') updated++;
    else failed++;
    if (result.rateLimited) rateLimited = true;
    const item = document.createElement('li');
    item.classList.toggle('failed', result.status === 'failed');
    item.textContent = 'Product ' + result.id + (result.status === 'updated'
      ? ' · Updated'
      : ' · Failed: ' + (result.error || 'Unknown error'));
    results.prepend(item);
    updateCounts();
    disableCompletedRows([result]);
  };
  let submitted = 0;
  while (submitted < products.length && !rateLimited) {
    const batch = products.slice(submitted, submitted + 500);
    await streamBulkBatch(batch, report);
    submitted += batch.length;
  }
  const remaining = products.length - submitted;
  const summary = updated + ' updated, ' + failed + ' failed.';
  showStatus(remaining ? 'Meta paused the update. ' + summary + ' ' + remaining + ' were not sent. Wait before retrying.'
    : 'Bulk update finished. ' + summary, failed > 0);
}

async function streamBulkBatch(products, report) {
  const response = await fetch('/api/catalog/products/bulk-update-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ products }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Bulk update request failed.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let received = 0;
  let buffered = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += value;
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const event = JSON.parse(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (event.type === 'complete' && received === products.length) return;
        if (event.type !== 'result') continue;
        received++;
        report(event.result);
      }
    }
  } catch {
    throw new Error('Live tracking was interrupted. The server may still be updating products. Refresh the catalog before retrying.');
  } finally {
    reader.releaseLock();
  }
  throw new Error('Live tracking ended before completion. Refresh the catalog before retrying.');
}

function preview(products, isBulk, readOnly = false) {
  if (busy || !products.length) return;
  const editingSingle = !isBulk && !readOnly;
  document.querySelector('#preview-title').textContent = editingSingle ? 'Edit product link' : 'Review link changes';
  document.querySelector('#single-url-editor').hidden = !editingSingle;
  singleUrl.disabled = !editingSingle;
  singleUrl.value = editingSingle ? products[0].url || products[0].expectedUrl : '';
  document.querySelector('#preview-summary').textContent = readOnly
    ? products.length + ' proposed URL changes on this page.'
    : isBulk
    ? 'Are you sure you want to update ' + products.length + ' products in Meta?'
    : 'Enter the link shoppers should open for product ' + products[0].id + '.';
  dialog.querySelector('[value="confirm"]').hidden = readOnly;
  dialog.querySelector('[value="cancel"]').textContent = readOnly ? 'Close' : 'Cancel';
  const urls = document.querySelector('#preview-urls');
  urls.replaceChildren();
  for (const product of products) {
    const entry = document.createElement('p');
    entry.textContent = 'Current link: ' + (product.expectedUrl || 'No usable link') +
      (editingSingle ? '' : '\nNew link: ' + product.url);
    urls.append(entry);
  }
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener('close', async () => {
    if (readOnly || dialog.returnValue !== 'confirm' || busy) return;
    busy = true;
    showStatus('Updating URLs in Meta…');
    try {
      if (isBulk) {
        await trackBulkUpdate(products);
      } else {
        await post('products/' + products[0].id + '/url', { ...products[0], url: singleUrl.value.trim() });
        reload('Product URL updated.');
      }
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      busy = false;
    }
  }, { once: true });
}

function reload(message) {
  sessionStorage.setItem('catalog-status', message);
  location.reload();
}

function disableCompletedRows(updates) {
  const updated = new Set(updates.filter(result => result.status === 'updated').map(result => result.id));
  for (const id of updated) selected.delete(id);
  for (const row of rows.filter(row => updated.has(row.dataset.id))) {
    const checkbox = row.querySelector('.select');
    checks.splice(checks.indexOf(checkbox), 1);
    checkbox.checked = false;
    checkbox.disabled = true;
    const [original, proposed] = row.querySelectorAll('.url');
    original.replaceChildren(proposed.querySelector('a').cloneNode(true));
    proposed.textContent = 'Updated';
    row.dataset.original = row.dataset.new;
    row.dataset.new = '';
  }
  updateSelection();
}

const lastStatus = sessionStorage.getItem('catalog-status');
if (lastStatus) {
  showStatus(lastStatus);
  sessionStorage.removeItem('catalog-status');
}

for (const row of rows) row.querySelector('.preview')?.addEventListener('click', () => preview([productFrom(row)], false));
bulk.addEventListener('click', () => preview([...selected.values()], true));
document.querySelector('#refresh').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  showStatus('Checking Meta for the latest products…');
  try {
    await post('refresh' + location.search);
    reload('Catalog refreshed.');
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    busy = false;
  }
});
document.querySelector('#transform').addEventListener('click', () => {
  if (busy) return;
  const proposed = checks.map(check => productFrom(check.closest('tr')));
  if (proposed.length) preview(proposed, false, true);
  else showStatus('No links on this page match the current address. Use Edit link to change an individual product.');
});
