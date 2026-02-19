const express = require('express');
const fs = require('fs/promises');
const { sourcesFile, vipKeysFile } = require('../config');

const router = express.Router();

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeKey(value) {
  return String(value || '').trim();
}

function isVipKeyValid(vipDb, key) {
  if (!key) return { valid: false, reason: 'empty_key' };

  const found = (vipDb.keys || []).find((item) => item.key === key);
  if (!found) return { valid: false, reason: 'not_found' };
  if (!found.active) return { valid: false, reason: 'inactive' };

  if (found.expiresAt) {
    const expiresAt = new Date(found.expiresAt).getTime();
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      return { valid: false, reason: 'expired' };
    }
  }

  return {
    valid: true,
    reason: 'ok',
    label: found.label || 'vip',
    expiresAt: found.expiresAt || null
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'easy-mods-backend', ts: new Date().toISOString() });
});

router.get('/sources', async (req, res) => {
  try {
    const vipKey = normalizeKey(req.query.vipKey);
    const [allSources, vipDb] = await Promise.all([readJson(sourcesFile), readJson(vipKeysFile)]);

    const vipResult = isVipKeyValid(vipDb, vipKey);
    const isVip = vipResult.valid;

    const filteredSources = allSources
      .filter((source) => (isVip ? true : !source.vip))
      .map((source) => ({
        id: source.id || source.name,
        name: source.name,
        icon: source.icon || '🎬',
        vip: Boolean(source.vip),
        quality: source.quality || 'HD',
        description: source.description || '',
        url: source.url || null,
        balancer: source.balancer || null,
        badgeColor: source.vip ? '#ff9800' : '#4caf50'
      }));

    res.json({
      ok: true,
      isVip,
      vip: {
        valid: vipResult.valid,
        reason: vipResult.reason,
        label: vipResult.label || null,
        expiresAt: vipResult.expiresAt || null
      },
      total: filteredSources.length,
      sources: filteredSources
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'sources_read_failed',
      message: error.message
    });
  }
});

router.post('/check-vip', express.json(), async (req, res) => {
  try {
    const vipKey = normalizeKey(req.body && req.body.key);
    const vipDb = await readJson(vipKeysFile);
    const vipResult = isVipKeyValid(vipDb, vipKey);

    res.json({
      ok: true,
      key: vipKey ? '***' : '',
      valid: vipResult.valid,
      reason: vipResult.reason,
      label: vipResult.label || null,
      expiresAt: vipResult.expiresAt || null
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'vip_check_failed',
      message: error.message
    });
  }
});

module.exports = router;
