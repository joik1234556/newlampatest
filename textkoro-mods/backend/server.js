const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const apiRouter = require('./routes/api');
const config = require('./config');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'Easy-Mods backend',
    docs: {
      sources: `${config.apiPrefix}/sources?vipKey=YOUR_KEY`,
      checkVip: `${config.apiPrefix}/check-vip`
    }
  });
});

app.use(config.apiPrefix, apiRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

app.listen(config.port, () => {
  console.log(`[easy-mods] server started on :${config.port}`);
});
