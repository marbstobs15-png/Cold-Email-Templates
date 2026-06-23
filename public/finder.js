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

    if (!res.ok) {
      throw new Error(data.error || 'Search failed');
    }

    renderResults(data);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Website';
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderResults(data) {
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

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') findWebsite();
});
