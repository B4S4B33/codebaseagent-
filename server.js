require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');

const { analyzeHandler, jobHandler } = require('./routes/analyze');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: process.env.MODEL || 'qwen/qwen3.8-27b' });
});

app.post('/api/analyze', analyzeHandler);
app.get('/api/jobs/:id', jobHandler);

// Static frontend, if present.
const path = require('path');
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { maxAge: '1d' }));

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`codebase-agent server on http://localhost:${port}`);
});

module.exports = { app, server };