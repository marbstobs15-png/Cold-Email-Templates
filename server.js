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

app.listen(PORT, () => {
  console.log(`Campaign Analyzer running at http://localhost:${PORT}`);
});
