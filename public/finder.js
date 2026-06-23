// ---- Mode switching --------------------------------------------------------

function switchMode(mode) {
  const single = mode === 'single';
  document.getElementById('mode-single').classList.toggle('hidden', !single);
  document.getElementById('mode-bulk').classList.toggle('hidden', single);
  document.getElementById('tab-single').classList.toggle('active', single);
  document.getElementById('tab-bulk').classList.toggle('active', !single);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---- Single lookup ---------------------------------------------------------

async function findWebsite() {
  const company = document.getElementById('company').value.trim();
  const location = document.getElementById('location').value.trim();
  const btn = document.getElementById('find-btn');
  const errorEl = document.getElementById('finder-error');
  const resultsEl = document.getElementById('finder-results');

  errorEl.classList.add('hidden');
  resultsEl.classList.add('hidden');

  if (!company) {
    errorEl.textContent = 'Please enter a company name.';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Searching...';

  try {
    const res = await fetch('/api/find-website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, location })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    renderSingle(data);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Website';
  }
}

function renderSingle(data) {
  const resultsEl = document.getElementById('finder-results');

  if (!data.website) {
    resultsEl.innerHTML = `<p class="subtitle">No website found for "${escapeHtml(data.query)}".
      Try adding or refining the location.</p>`;
    resultsEl.classList.remove('hidden');
    return;
  }

  const url = escapeHtml(data.website);
  let html = `
    <div class="input-group">
      <label>Best match</label>
      <a href="${url}" target="_blank" rel="noopener" style="font-size: 18px; word-break: break-all;">${url}</a>
    </div>`;

  const others = (data.candidates || []).slice(1);
  if (others.length) {
    html += `<div class="input-group"><label>Other possibilities</label><ul style="padding-left: 18px; margin: 0;">`;
    for (const c of others) {
      const cUrl = escapeHtml(c.url);
      html += `<li style="margin-bottom: 6px;"><a href="${cUrl}" target="_blank" rel="noopener" style="word-break: break-all;">${cUrl}</a></li>`;
    }
    html += `</ul></div>`;
  }

  resultsEl.innerHTML = html;
  resultsEl.classList.remove('hidden');
}

// ---- Bulk parsing ----------------------------------------------------------

// Split one CSV line into fields, honoring simple double-quoted values.
function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

// Turn the textarea contents into [{company, location}]. Each line is
// "Company, Location" — the company is the first field, the location is the
// rest joined back together (so "City, ST" stays intact).
function parseRows(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    const company = fields[0];
    if (!company) continue;
    const location = fields.slice(1).join(', ').trim();
    rows.push({ company, location });
  }
  return rows;
}

// Load a CSV file into the textarea. If it has a header row with a "company"
// column we map columns accordingly; otherwise we treat it as company,location.
function loadCsv(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = String(e.target.result).split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return;

    const header = splitCsvLine(lines[0]).map(h => h.toLowerCase());
    const hasHeader = header.includes('company');
    let companyIdx = 0, locationIdx = 1;
    let dataLines = lines;
    if (hasHeader) {
      companyIdx = header.indexOf('company');
      locationIdx = header.indexOf('location');
      dataLines = lines.slice(1);
    }

    const out = [];
    for (const line of dataLines) {
      const f = splitCsvLine(line);
      const company = (f[companyIdx] || '').trim();
      if (!company) continue;
      const location = locationIdx >= 0 ? (f[locationIdx] || '').trim() : '';
      out.push(location ? `${company}, ${location}` : company);
    }
    document.getElementById('bulk-input').value = out.join('\n');
  };
  reader.readAsText(file);
}

// ---- Bulk lookup -----------------------------------------------------------

let lastBulkResults = [];

async function findBulk() {
  const text = document.getElementById('bulk-input').value;
  const btn = document.getElementById('bulk-btn');
  const errorEl = document.getElementById('bulk-error');
  const progressEl = document.getElementById('bulk-progress');
  const resultsEl = document.getElementById('bulk-results');

  errorEl.classList.add('hidden');
  resultsEl.classList.add('hidden');

  const rows = parseRows(text);
  if (!rows.length) {
    errorEl.textContent = 'Please enter at least one company.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (rows.length > 200) {
    errorEl.textContent = 'Please limit to 200 companies per run.';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Searching...';
  progressEl.textContent = `Searching ${rows.length} ${rows.length === 1 ? 'company' : 'companies'}… this can take a moment (about 1 second each).`;
  progressEl.classList.remove('hidden');

  try {
    const res = await fetch('/api/find-websites-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bulk search failed');
    lastBulkResults = data.results || [];
    renderBulk(lastBulkResults);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Websites';
    progressEl.classList.add('hidden');
  }
}

function renderBulk(results) {
  const resultsEl = document.getElementById('bulk-results');
  const found = results.filter(r => r.website).length;

  let html = `
    <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h2 style="margin:0;">Results — ${found}/${results.length} found</h2>
      <button class="btn btn-outline" onclick="downloadCsv()">Download CSV</button>
    </div>
    <div style="overflow-x:auto;">
    <table class="bulk-table">
      <thead><tr><th>Company</th><th>Location</th><th>Website</th></tr></thead>
      <tbody>`;

  for (const r of results) {
    let cell;
    if (r.website) {
      const url = escapeHtml(r.website);
      cell = `<a href="${url}" target="_blank" rel="noopener" style="word-break:break-all;">${url}</a>`;
    } else {
      cell = `<span class="bulk-none">${escapeHtml(r.error || 'Not found')}</span>`;
    }
    html += `<tr>
      <td>${escapeHtml(r.company)}</td>
      <td>${escapeHtml(r.location || '')}</td>
      <td>${cell}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  resultsEl.innerHTML = html;
  resultsEl.classList.remove('hidden');
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv() {
  const header = ['company', 'location', 'website'];
  const lines = [header.join(',')];
  for (const r of lastBulkResults) {
    lines.push([csvCell(r.company), csvCell(r.location || ''), csvCell(r.website || '')].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'company-websites.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Enter submits in single mode only (textarea needs Enter for new lines).
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('mode-single').classList.contains('hidden')) {
    if (e.target.tagName !== 'TEXTAREA') findWebsite();
  }
});
