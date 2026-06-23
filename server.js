const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const INSTANTLY_BASE = 'https://api.instantly.ai';

app.post('/api/proxy', async (req, res) => {
  const { apiKey, endpoint, method = 'GET' } = req.body;

  if (!apiKey || !endpoint) {
    return res.status(400).json({ error: 'Missing apiKey or endpoint' });
  }

  try {
    const url = `${INSTANTLY_BASE}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Company website finder ---------------------------------------------

// Domains that are directories, social networks, or aggregators rather than
// a company's own website. We never want to return these as "the website".
const EXCLUDED_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'yelp.com', 'yellowpages.com',
  'bbb.org', 'mapquest.com', 'foursquare.com', 'tripadvisor.com', 'glassdoor.com',
  'indeed.com', 'crunchbase.com', 'bloomberg.com', 'zoominfo.com', 'dnb.com',
  'manta.com', 'houzz.com', 'angi.com', 'angieslist.com', 'thumbtack.com',
  'homeadvisor.com', 'nextdoor.com', 'google.com', 'goo.gl', 'maps.google.com',
  'wikipedia.org', 'amazon.com', 'ebay.com', 'apple.com', 'bing.com',
  'duckduckgo.com', 'reddit.com', 'medium.com', 'wordpress.com', 'blogspot.com',
  'wixsite.com', 'godaddysites.com', 'business.site', 'porch.com', 'buildzoom.com'
];

function isExcluded(hostname) {
  const h = hostname.replace(/^www\./, '').toLowerCase();
  return EXCLUDED_DOMAINS.some(d => h === d || h.endsWith('.' + d));
}

// DuckDuckGo's HTML results wrap target URLs in a redirect of the form
// //duckduckgo.com/l/?uddg=<encoded-url>. Unwrap it back to the real URL.
function unwrapDuckDuckGo(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname === '/l/' && u.searchParams.has('uddg')) {
      return decodeURIComponent(u.searchParams.get('uddg'));
    }
    return u.href;
  } catch {
    return null;
  }
}

// Parse organic result links out of DuckDuckGo's HTML response.
function parseResults(html) {
  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapDuckDuckGo(m[1].replace(/&amp;/g, '&'));
    if (!url) continue;
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    results.push({ url, title });
  }
  return results;
}

// Score how likely a result is to be the company's own site. Higher is better.
function scoreCandidate(hostname, companyName) {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  const domainWord = host.split('.')[0];
  const tokens = companyName.toLowerCase().match(/[a-z0-9]+/g) || [];
  let score = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (domainWord.includes(t)) score += 2;
  }
  // Reward a tidy domain that closely matches the collapsed company name.
  const collapsed = tokens.join('');
  if (collapsed && domainWord.replace(/[^a-z0-9]/g, '') === collapsed) score += 5;
  // Common business TLDs get a small bump.
  if (/\.(com|co|io|net|biz)$/.test(host)) score += 1;
  return score;
}

app.post('/api/find-website', async (req, res) => {
  const { company, location } = req.body || {};

  if (!company || !company.trim()) {
    return res.status(400).json({ error: 'Missing company name' });
  }

  const query = [company, location].filter(Boolean).join(' ').trim();

  try {
    const response = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      },
      body: new URLSearchParams({ q: query }).toString()
    });

    const html = await response.text();
    const results = parseResults(html);

    const seen = new Set();
    const candidates = [];
    for (const r of results) {
      let host;
      try {
        host = new URL(r.url).hostname;
      } catch {
        continue;
      }
      if (isExcluded(host)) continue;
      const key = host.replace(/^www\./, '');
      if (seen.has(key)) continue;
      seen.add(key);
      // Return the homepage rather than whatever deep page ranked first.
      const homepage = `${new URL(r.url).protocol}//${host}/`;
      candidates.push({
        url: homepage,
        title: r.title,
        hostname: host,
        score: scoreCandidate(host, company)
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return res.json({ query, website: null, candidates: [] });
    }

    res.json({
      query,
      website: candidates[0].url,
      candidates: candidates.slice(0, 5)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Campaign Analyzer running at http://localhost:${PORT}`);
});
