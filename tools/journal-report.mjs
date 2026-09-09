#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Разбор журнала самообучения avito-helper.
//
// Читает JSONL — и серверные месячные файлы (~/avito-journal/YYYY-MM.jsonl с VPS),
// и локальные выгрузки буфера («⬇ Буфер (JSONL)» в ⚙ Настройках). Формат один:
// сервер пишет событие как есть, одной строкой, без обёртки.
//
// ⚠️ Дедуп ОБЯЗАТЕЛЕН: если сервер записал батч, а ответ не дошёл, клиент отправит
// его повторно. С 09.09.2026 у события есть собственный ключ `eid` — по нему дедуп
// точный. У событий, записанных раньше, ключа нет: для них остаётся грубый
// `ts + device + event` (он схлопнет два одинаковых клика в одну миллисекунду).
//
// Запуск:
//   node tools/journal-report.mjs                 # всё *.jsonl из ./journal/
//   node tools/journal-report.mjs файл.jsonl ...  # конкретные файлы или папки
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

// Полная таксономия событий. Нули здесь — это диагноз: либо функцией не
// пользуются (мёртвый код), либо путь не доезжает до журнала (дыра в сборе).
const KNOWN_EVENTS = [
  'app_start', 'generated', 'regen', 'applied_title', 'copied',
  'fav_add', 'fav_remove', 'queue_add', 'posted', 'edited',
  'reference_added', 'export', 'cv_images', 'cv_variants', 'cv_infog_fill',
  'cv_download', 'tab_open', 'ui', 'error', 'journal_on', 'journal_off',
  // сессия 2026-09-06 (vision) и 2026-09-07 (чипы, приёмы)
  'vision', 'vision_uncertain', 'vision_pick', 'refs_tricks',
];

// Пути генерации — чтобы увидеть, какими воронками реально пользуются
const GEN_PATHS = ['main', 'batch', 'titles', 'descriptions', 'more', 'alt_titles', 'rephrase', 'session'];

// ─── чтение ──────────────────────────────────────────────────────────────────

function collectFiles(args) {
  const targets = args.length ? args : ['journal'];
  const files = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) { console.error(`  ! нет такого пути: ${t}`); continue; }
    const st = fs.statSync(t);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(t).sort()) {
        if (f.endsWith('.jsonl')) files.push(path.join(t, f));
      }
    } else files.push(t);
  }
  return files;
}

function readEvents(files) {
  const rows = [];
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    // Строки и события считаем раздельно: одна строка локальной выгрузки может
    // быть массивом и дать несколько событий, поэтому «событий больше, чем строк» —
    // норма, а битые строки иначе потерялись бы в этой арифметике.
    let lines = 0, broken = 0, events = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines++;
      try {
        const e = JSON.parse(line);
        // Локальная выгрузка буфера может быть массивом в одной строке
        if (Array.isArray(e)) { for (const x of e) { rows.push({ ...x, _src: f }); events++; } }
        else { rows.push({ ...e, _src: f }); events++; }
      } catch (err) { broken++; bad.push({ file: f, line: lines }); }
    }
    console.log(`  ${f}: ${lines} строк → ${events} событий${broken ? ` (битых строк: ${broken})` : ''}`);
  }
  if (bad.length) console.log(`  ! всего нечитаемых строк: ${bad.length}`);
  return rows;
}

// ─── утилиты вывода ──────────────────────────────────────────────────────────

const h = (t) => console.log(`\n${'═'.repeat(74)}\n${t}\n${'═'.repeat(74)}`);
const sub = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

function table(pairs, { total = 0, width = 34 } = {}) {
  if (!pairs.length) { console.log('   (пусто)'); return; }
  const max = Math.max(...pairs.map(([, v]) => v)) || 1;
  for (const [k, v] of pairs) {
    const bar = '█'.repeat(Math.round((v / max) * 24));
    const share = total ? `  ${pct(v, total).padStart(6)}` : '';
    console.log(`   ${String(k).padEnd(width)} ${String(v).padStart(6)}${share}  ${bar}`);
  }
}

const count = (arr, fn) => {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (k === undefined || k === null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};
const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

function quantiles(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1] };
}

// ─── основной разбор ─────────────────────────────────────────────────────────

const files = collectFiles(process.argv.slice(2));
if (!files.length) {
  console.error('Нет файлов. Положи выгрузки в ./journal/ или укажи пути аргументами.');
  process.exit(1);
}

console.log('Читаю:');
const raw = readEvents(files);
if (!raw.length) { console.error('Событий не найдено.'); process.exit(1); }

// Дедуп — обязателен, см. шапку файла
const seen = new Set();
const ev = [];
let dupes = 0, noEid = 0;
for (const e of raw) {
  const key = e.eid ? `eid:${e.eid}` : `${e.ts}|${e.device}|${e.event}`;
  if (!e.eid) noEid++;
  if (seen.has(key)) { dupes++; continue; }
  seen.add(key);
  ev.push(e);
}

h('1. ЦЕЛОСТНОСТЬ И ДОСТАВКА');

const times = ev.map(e => e.ts).filter(Boolean).sort();
console.log(`   Событий после дедупа : ${ev.length}   (снято дублей: ${dupes}, ${pct(dupes, raw.length)} от сырых)`);
if (noEid) console.log(`   Без ключа eid        : ${noEid}  — дедуп для них грубый (ts+device+event)`);
console.log(`   Период               : ${times[0] || '?'}  →  ${times[times.length - 1] || '?'}`);

const dropped = ev.reduce((s, e) => s + (Number(e._dropped) || 0), 0);
console.log(`   Потеряно клиентом    : ${dropped}${dropped ? '  ⚠️ буфер вытеснялся — события до отправки не дожили' : ''}`);

sub('По дням (дыра = день, когда журнал молчал)');
const byDay = count(ev, e => String(e.ts || '').slice(0, 10));
const days = [...byDay.keys()].filter(Boolean).sort();
if (days.length) {
  const d0 = new Date(days[0] + 'T00:00:00Z'), d1 = new Date(days[days.length - 1] + 'T00:00:00Z');
  const rows = [];
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    rows.push([key + (byDay.get(key) ? '' : '  ← тишина'), byDay.get(key) || 0]);
  }
  table(rows, { width: 24 });
}

sub('По устройствам (телефон и ПК должны стекаться в один журнал)');
for (const [dev, n] of sorted(count(ev, e => e.device || '?'))) {
  const t = ev.filter(e => (e.device || '?') === dev).map(e => e.ts).filter(Boolean).sort();
  console.log(`   ${String(dev).padEnd(10)} ${String(n).padStart(6)}  ${t[0]} → ${t[t.length - 1]}`);
}

sub('Версии сборки (build = document.lastModified)');
table(sorted(count(ev, e => e.build || '?')), { width: 34 });

h('2. ТАКСОНОМИЯ СОБЫТИЙ');
const byEvent = count(ev, e => e.event);
table(sorted(byEvent), { total: ev.length });

const missing = KNOWN_EVENTS.filter(k => !byEvent.get(k));
if (missing.length) {
  console.log(`\n   ⚠️ Ни разу не встретились (${missing.length}): ${missing.join(', ')}`);
  console.log('      Это либо мёртвая функция, либо путь не доезжает до журнала — различать по смыслу.');
}
const unknown = [...byEvent.keys()].filter(k => !KNOWN_EVENTS.includes(k));
if (unknown.length) console.log(`\n   ℹ️ Не описаны в таксономии: ${unknown.join(', ')}`);

h('3. ГЕНЕРАЦИЯ');
const gen = ev.filter(e => e.event === 'generated');
sub('Пути генерации');
table(sorted(count(gen, e => e.path || '?')), { total: gen.length });
const noPath = GEN_PATHS.filter(p => !gen.some(e => e.path === p));
if (noPath.length) console.log(`\n   ⚠️ Путей без единой генерации: ${noPath.join(', ')}`);

sub('Категории товара (по всем событиям, где категория проставлена)');
table(sorted(count(ev, e => e.category)), {});

sub('Модели');
table(sorted(count(gen, e => e.model || e.provider)), {});

const lat = quantiles(gen.map(e => Number(e.latencyMs)).filter(Number.isFinite));
if (lat) console.log(`\n   Латентность, мс: min ${lat.min} · p25 ${lat.p25} · медиана ${lat.med} · p75 ${lat.p75} · p90 ${lat.p90} · max ${lat.max}`);

h('4. ВОРОНКА: ЦЕПОЧКИ ОТ ГЕНЕРАЦИИ ДО РАЗМЕЩЕНИЯ');
const chains = new Map();
for (const e of ev) {
  if (!e.chainId) continue;
  const c = chains.get(e.chainId) || { events: new Set(), n: 0 };
  c.events.add(e.event); c.n++;
  chains.set(e.chainId, c);
}
const all = [...chains.values()];
const withGen = all.filter(c => c.events.has('generated'));
const stat = (name, fn) => console.log(`   ${name.padEnd(38)} ${String(withGen.filter(fn).length).padStart(5)}   ${pct(withGen.filter(fn).length, withGen.length)}`);
console.log(`   Цепочек всего: ${all.length}, из них с генерацией: ${withGen.length}\n`);
if (withGen.length) {
  stat('→ дошли до копии (copied)', c => c.events.has('copied'));
  stat('→ в избранное (fav_add)', c => c.events.has('fav_add'));
  stat('→ размещено (posted)', c => c.events.has('posted'));
  stat('→ донесён финал (edited)', c => c.events.has('edited'));
  stat('→ была перегенерация (regen)', c => c.events.has('regen'));
  stat('✗ ОТКАЗЫ: ни копии, ни избранного, ни posted',
    c => !c.events.has('copied') && !c.events.has('fav_add') && !c.events.has('posted'));
}

h('5. ВЫБОР ЧЕЛОВЕКА (главный сигнал)');
const copied = ev.filter(e => e.event === 'copied');
console.log(`   Копий всего: ${copied.length}`);
sub('Что копируют');
table(sorted(count(copied, e => e.kind || '?')), { total: copied.length });
sub('Индекс победившего варианта (pos) — падает ли выбор всегда на первый');
table([...count(copied, e => e.pos).entries()].sort((a, b) => a[0] - b[0]), { total: copied.length, width: 10 });
sub('Светофор сканера в момент копии');
const scanC = count(copied, e => e.scan || 'нет данных');
table(sorted(scanC), { total: copied.length });
if (scanC.get('error')) {
  console.log(`\n   ⚠️ Копий при 🔴: ${scanC.get('error')} (${pct(scanC.get('error'), copied.length)}).`);
  console.log('      Либо сканер врёт и его игнорируют, либо в объявления уходит запрещёнка.');
}

h('6. ЧТО ПРАВЯТ РУКАМИ УЖЕ В АВИТО (editShare)');
const edited = ev.filter(e => e.event === 'edited');
// ⚠️ Считать можно ТОЛЬКО доносы, где описание реально вставили. Если поле
// описания в диалоге осталось пустым, клиент подставляет исходный текст сам
// (avito-helper.html: `fd = fdRaw || r.description`), и editShare выходит нулевым
// ПО ПОСТРОЕНИЮ, а не потому, что текст не правили. Смешать их в одну выборку —
// значит утопить медиану в структурных нулях и получить вывод, обратный правде.
const pasted   = edited.filter(e => e.descPasted === true);
const unpasted = edited.filter(e => e.descPasted === false);
const unmarked = edited.filter(e => typeof e.descPasted !== 'boolean');
console.log(`   Доносов всего: ${edited.length}  ·  с вставленным описанием: ${pasted.length}  ·  без описания: ${unpasted.length}${unmarked.length ? `  ·  без пометки: ${unmarked.length}` : ''}`);
if (unpasted.length) console.log(`   Доносы без описания в расчёт не идут — там editShare нулевой по построению.`);

const es = quantiles(pasted.map(e => Number(e.editShare)).filter(Number.isFinite));
if (!es) console.log('\n   Ни одного доноса с вставленным описанием — доля правок пока неизвестна.');
else {
  console.log(`\n   По ${es.n} доносам с описанием:`);
  console.log(`   Доля изменённых слов: min ${es.min.toFixed(2)} · p25 ${es.p25.toFixed(2)} · медиана ${es.med.toFixed(2)} · p75 ${es.p75.toFixed(2)} · max ${es.max.toFixed(2)}`);
  if (es.med > 0.3) console.log(`   ⚠️ Медиана ${es.med.toFixed(2)} > 0.3 — промпт систематически не попадает, правки стоит вносить в SYS.`);
  else console.log(`   Медиана ${es.med.toFixed(2)} — правки точечные, порог тревоги (0.3) не превышен.`);
}
// Заголовок правят отдельно от описания: он короткий, и его переписывают чаще
const titleChanged = edited.filter(e => e.titleChanged === true).length;
if (edited.length) console.log(`\n   Заголовок переписан: ${titleChanged} из ${edited.length}  (${pct(titleChanged, edited.length)})`);

h('7. РАСПОЗНАВАНИЕ ПО ФОТО');
const vis = ev.filter(e => e.event === 'vision');
const picks = ev.filter(e => e.event === 'vision_pick');
const unc = ev.filter(e => e.event === 'vision_uncertain');
console.log(`   Распознаваний: ${vis.length} · уточняющих вопросов: ${unc.length} · выборов человека: ${picks.length}`);
if (picks.length) {
  const changed = picks.filter(p => p.changed === true).length;
  console.log(`\n   Догадку модели ПОПРАВИЛИ: ${changed} из ${picks.length}  (${pct(changed, picks.length)})`);
  console.log('   Это прямая метрика качества: чем выше доля, тем чаще первый вариант мимо.');
  sub('По полям: сколько раз спрашивали и сколько раз поправили');
  const byField = new Map();
  for (const p of picks) {
    const f = p.field || '?';
    const r = byField.get(f) || { n: 0, ch: 0 };
    r.n++; if (p.changed === true) r.ch++;
    byField.set(f, r);
  }
  for (const [f, r] of [...byField.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`   ${f.padEnd(24)} спрошено ${String(r.n).padStart(4)} · поправлено ${String(r.ch).padStart(4)}  (${pct(r.ch, r.n)})`);
  }
  console.log('\n   Поле с высокой долей правок = готовый few-shot: там модель промахивается стабильно.');
}
if (unc.length && !picks.length) {
  console.log('\n   ⚠️ Вопросы задаются, но выборов нет — чипы показываются и остаются нетронутыми.');
}

h('8. ОБЛОЖКИ');
const dl = ev.filter(e => e.event === 'cv_download');
console.log(`   Скачано обложек (обложка пошла в дело): ${dl.length}`);
sub('Раскладки');
table(sorted(count(dl, e => (e.settings && e.settings.layout) || e.layout || '?')), { total: dl.length });
sub('Режим');
table(sorted(count(dl, e => (e.settings && e.settings.mode) || '?')), { total: dl.length });
sub('Источник картинок (cv_images)');
table(sorted(count(ev.filter(e => e.event === 'cv_images'), e => e.source || '?')), {});

h('9. ЧЕМ ПОЛЬЗУЮТСЯ, А ЧЕМ НЕТ');
sub('Вкладки');
table(sorted(count(ev.filter(e => e.event === 'tab_open'), e => e.tab || '?')), {});
sub('Крупные кнопки (перепись ui)');
table(sorted(count(ev.filter(e => e.event === 'ui'), e => e.act || '?')), { width: 30 });

h('10. ОШИБКИ');
const errs = ev.filter(e => e.event === 'error');
console.log(`   Всего: ${errs.length}`);
if (errs.length) {
  sub('По стадиям');
  table(sorted(count(errs, e => e.stage || '?')), { total: errs.length });
  sub('Последние 10');
  for (const e of errs.slice(-10)) {
    console.log(`   ${e.ts}  ${String(e.stage || '?').padEnd(18)} ${String(e.message || e.msg || '').slice(0, 90)}`);
  }
}

console.log('');
