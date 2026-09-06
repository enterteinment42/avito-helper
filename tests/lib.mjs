// Общая обвязка стенда: статический сервер, браузер, ассерты, baseline из git HEAD.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(TESTS_DIR, '..');
export const BASELINE_DIR = path.join(TESTS_DIR, '.baseline');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

// Инструмент нельзя открывать как file:// (Origin: null не проходит CORS прокси —
// урок Bug #10), да и localStorage на file:// ведёт себя иначе. Поднимаем http.
export function startServer() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    let base = ROOT;
    if (url.startsWith('/baseline/')) {
      url = url.slice('/baseline'.length);
      // Шрифты у baseline те же самые — отдаём из репозитория
      base = url.startsWith('/fonts/') ? ROOT : BASELINE_DIR;
    }
    if (url === '/' || url.endsWith('/')) url += 'avito-helper.html';
    const file = path.join(base, path.normalize(url).replace(/^([/\\])+/, ''));
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Версия из git HEAD — база для сравнения промпта. git.exe берём тот же, что
// используется в проекте (GitHub Desktop), с фолбэком на git из PATH.
export function writeBaseline() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const candidates = [];
  const ghd = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
  if (fs.existsSync(ghd)) {
    for (const d of fs.readdirSync(ghd).filter(n => n.startsWith('app-'))) {
      candidates.push(path.join(ghd, d, 'resources', 'app', 'git', 'cmd', 'git.exe'));
    }
  }
  candidates.push('git');
  let lastErr;
  for (const git of candidates) {
    try {
      const out = execFileSync(git, ['show', 'HEAD:avito-helper.html'], {
        cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer',
      });
      fs.writeFileSync(path.join(BASELINE_DIR, 'avito-helper.html'), out);
      return true;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Не удалось получить baseline из git HEAD: ' + (lastErr && lastErr.message));
}

// ── Ассерты ──────────────────────────────────────────────
export function makeReporter() {
  const results = [];
  const t = {
    ok(name, cond, detail = '') {
      results.push({ name, pass: !!cond, detail: cond ? '' : detail });
      console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond || !detail ? '' : `\n        ${detail}`}`);
    },
    eq(name, actual, expected) {
      const pass = actual === expected;
      t.ok(name, pass, pass ? '' : `ожидалось: ${JSON.stringify(expected)}\n        получено: ${JSON.stringify(actual)}`);
    },
    section(title) { console.log(`\n── ${title} ──`); },
    get results() { return results; },
  };
  return t;
}

// Страница с чистым localStorage и собранной консолью.
export async function openApp(browser, url, { storage = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  if (storage) {
    // Данные надо положить ДО загрузки приложения — state читает localStorage при старте
    await page.addInitScript(s => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, storage);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#app header'));
  return { ctx, page, consoleErrors };
}

// Сетевые границы: генерация не должна ходить в настоящий API.
export async function stubAI(page, reply) {
  await page.evaluate(r => {
    window.__aiCalls = [];
    window.callAI = async (messages, opts = {}) => {
      window.__aiCalls.push({ messages, opts });
      return r;
    };
  }, reply);
}

export const VARIANTS_JSON = JSON.stringify({
  variants: [
    { id: 1, title: 'Вариант один', description: 'Описание один. Оформляется в цифре. PS4 PS5', style: 'деловой' },
    { id: 2, title: 'Вариант два', description: 'Описание два. Оформляется в цифре. PS4 PS5', style: 'дерзкий' },
    { id: 3, title: 'Вариант три', description: 'Описание три. Оформляется в цифре. PS4 PS5', style: 'восторженный' },
  ],
});
