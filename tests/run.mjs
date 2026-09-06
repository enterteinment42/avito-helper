// Регрессионный стенд avito-helper. Запуск: npm test
import { chromium } from 'playwright';
import { startServer, writeBaseline, makeReporter } from './lib.mjs';
import { runParity } from './parity.mjs';
import { runEditor } from './editor.mjs';
import { runRegress } from './regress.mjs';

const only = process.argv[2]; // node run.mjs parity|editor|regress — прогнать одну секцию

const t = makeReporter();
const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;

let browser;
try {
  if (!only || only === 'parity') writeBaseline();
  browser = await chromium.launch();
  if (!only || only === 'parity')  await runParity(browser, base, t);
  if (!only || only === 'editor')  await runEditor(browser, base, t);
  if (!only || only === 'regress') await runRegress(browser, base, t);
} catch (e) {
  console.error('\nСтенд упал:', e);
  t.ok('стенд отработал без исключений', false, String(e && e.stack || e));
} finally {
  await browser?.close();
  server.close();
}

const pass = t.results.filter(r => r.pass).length;
console.log(`\nИтого: ${pass}/${t.results.length}`);
if (pass !== t.results.length) {
  console.log('\nУпало:');
  for (const r of t.results.filter(r => !r.pass)) console.log(` - ${r.name}`);
  process.exit(1);
}
