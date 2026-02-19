const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const apiRouter = require('./routes/api');
const config = require('./config');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'easy-mods-backend',
    endpoints: {
      health: 'GET /health',
      sources: 'GET /sources?isVip=true|false',
      search: 'POST /search {title,year,jackettUrl?,jackettKey?}',
      streamPost: 'POST /stream {magnet}',
      streamGet: 'GET /stream?magnet=...'
    }
  });
});

app.use('/', apiRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

app.listen(config.port, () => {
  console.log(`[easy-mods-backend] listening on :${config.port}`);
  console.log(`[easy-mods-backend] torr servers: ${config.torrServers.join(', ')}`);
});
