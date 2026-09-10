const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function extract(source) {
  const start = source.indexOf('var CE_DEFAULT_CFG =');
  const end = source.indexOf('/* 1週(日〜土)。', start);
  if (start < 0 || end < start) throw Error('Clock detector source boundaries missing');
  let core = source.slice(start, end).replace(/\r\n/g, '\n');
  const a = core.indexOf('function getCeCfg(){'), b = core.indexOf('/* ハワイ時刻', a);
  if (a < 0 || b < a) throw Error('Configuration provider boundaries missing');
  core = core.slice(0,a) + core.slice(b);
  return `// Generated from the Funergy+ clock-error block. Do not edit rules here.
// Regenerate with node scripts/extract-bot-clock.cjs.
// Providers must supply the app-equivalent effective labor and explicit settings.
export function createClockDetector({ getTipLabor, getCeCfg }) {
  if (typeof getTipLabor !== 'function' || typeof getCeCfg !== 'function')
    throw new TypeError('Effective labor and configuration providers are required');
${core}return { ceIsSystemAccount, ceCheckShift, ceScanDay, _ceOverlap, _ceClock, CE_DEFAULT_CFG, CE_KIND_LABEL, CE_ERROR_KINDS };
}
`;
}
if (require.main === module) fs.writeFileSync(path.join(root,'bot/clock-detector.mjs'),extract(fs.readFileSync(path.join(root,'index.html'),'utf8')));
module.exports = { extract };
