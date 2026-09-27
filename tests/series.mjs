// Серия фото в 2б (28.09.2026): свои ракурсы товара → по кадру на каждый, одна комната на
// серию. Сначала первый кадр, остальные — отдельной кнопкой с ценой; первый кадр вторым
// референсом (ужатым JPEG — под лимит тела /api/image). Одиночный режим — как в git HEAD.
import { openApp, writeBaseline } from './lib.mjs';

// В странице: настоящие картинки (stagedJpeg их раскодирует), заглушка сети и журнала
const setup = page => page.evaluate(() => {
  const png = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); return c.toDataURL('image/png'); };
  window.__png = png;
  const photo = png(40, 30, '#336699');
  state.vision.dataUrl = photo;
  state.vision.media = { media_type: 'image/png', data: photo.slice(photo.indexOf(',') + 1) };
  localStorage.setItem('avito_admin_token', 'test-token');
  window.__req = []; window.__jlog = []; window.__fail = null;
  const origJ = window.jlog;
  window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
  // ответ вендора — большой PNG (как настоящий кадр), разный на каждый запрос
  const big = png(900, 1200, '#aa5500').split(',')[1];
  window.fetch = async (url, opts = {}) => {
    window.__req.push({ url, body: JSON.parse(opts.body || '{}'), len: (opts.body || '').length });
    const n = window.__req.length;
    if (window.__fail === n) return { ok: false, status: 500, json: async () => ({}), text: async () => 'упал вендор' };
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: big, media_type: 'image/png' }] }), text: async () => '' };
  };
  window.__confirms = []; window.__confirmAns = true;
  window.confirm = m => { window.__confirms.push(m); return window.__confirmAns; };
});

export async function runSeries(browser, base, t) {
  t.section('series — серия фото в 2б');
  writeBaseline();

  // ── Одиночный режим: тело запроса как в HEAD ──
  {
    const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
    const cur = await openApp(browser, `${base}/avito-helper.html`);
    try {
      const run = page => page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 20; c.height = 20;
        const u = c.toDataURL('image/png');
        state.vision.dataUrl = u; state.vision.media = { media_type: 'image/png', data: u.split(',')[1] };
        localStorage.setItem('avito_admin_token', 'test-token');
        state.form.category = 'phys'; state.form.physName = 'PlayStation 5 Slim';
        state.vision.staged.scene = 'shelf'; state.vision.staged.extra = 'рядом диск';
        let sent = null;
        window.fetch = async (url, opts) => { sent = { url, body: opts.body, auth: opts.headers.Authorization }; return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'QUJD', media_type: 'image/png' }] }) }; };
        await doStagedPhoto();
        return JSON.stringify(sent);
      });
      const a = await run(old.page), b = await run(cur.page);
      t.ok('одиночный «Поставить в интерьер» шлёт ровно то же, что в HEAD (тело байт в байт)', a === b, `${a.slice(0, 300)}\n${b.slice(0, 300)}`);
    } finally { await old.ctx.close(); await cur.ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await setup(page);
    await page.evaluate(() => { state.tab = 'generator'; state.form.category = 'phys'; state.form.physName = 'Геймпад DualSense'; render(); });

    const single = await page.evaluate(() => { const h = stagedCardHTML(); return { add: h.includes('for="staged-angle-file"'), hint: h.includes('Добавь ракурсы'), gen: h.includes('data-act="staged-gen"'), series: h.includes('staged-series-first') }; });
    t.ok('без ракурсов — одиночный режим, рядом «＋ ракурс» и подсказка про серию', single.add && single.hint && single.gen && !single.series, JSON.stringify(single));

    // ── Ракурс — настоящим выбором файла ──
    const file = async color => {
      const b64 = await page.evaluate(c => window.__png(60, 80, c).split(',')[1], color);
      const want = (await page.evaluate(() => state.vision.staged.angles.length)) + 1;
      await page.setInputFiles('#staged-angle-file', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
      await page.waitForFunction(n => state.vision.staged.angles.length === n, want);
    };
    await file('#ff0000');
    const one = await page.evaluate(() => { const h = stagedCardHTML(); const st = state.vision.staged; return { n: st.angles.length, jpeg: st.angles[0].dataUrl.startsWith('data:image/jpeg'), first: /Первый кадр серии \(~\$0\.023\)/.test(h), gen: h.includes('data-act="staged-gen"'), room: h.includes('data-act="staged-oneroom"') }; });
    t.ok('ракурс добавлен (ужат в JPEG), карточка перешла в серию: «Первый кадр серии (~$0.02)», одиночной кнопки нет', one.n === 1 && one.jpeg && one.first && !one.gen && one.room, JSON.stringify(one));
    for (const c of ['#00ff00', '#0000ff', '#ffff00']) await file(c);
    const full = await page.evaluate(async () => {
      const h = stagedCardHTML();
      const f = new File([new Blob(['x'])], 'x.png', { type: 'image/png' });
      await stagedAddAngle(f);
      return { n: state.vision.staged.angles.length, shots: stagedShots().length, addHidden: !stagedCardHTML().includes('for="staged-angle-file"'), hadAdd: h.includes('for="staged-angle-file"') };
    });
    t.ok(`пятый снимок — последний: шестой не принимается, «＋ ракурс» пропадает`, full.n === 4 && full.shots === 5 && full.addHidden, JSON.stringify(full));

    // ── Первый кадр ──
    const first = await page.evaluate(async () => {
      state.vision.staged.scene = 'shelf'; state.vision.staged.extra = '';
      await doStagedSeries('first');
      const s = state.vision.staged.series, r = window.__req;
      return { reqs: r.length, refs: r[0].body.input_references.map(x => x.image_url.url === state.vision.dataUrl), prompt: r[0].body.prompt === stagedPrompt(), items: s.items.length, done: !!s.items[0].dataUrl,
        ev: window.__jlog.filter(x => x.ev === 'staged').map(x => x.data), h: stagedCardHTML() };
    });
    t.ok('первый кадр — один запрос, один референс (фото распознавания), промпт как у одиночного', first.reqs === 1 && JSON.stringify(first.refs) === '[true]' && first.prompt && first.done && first.items === 5, JSON.stringify({ ...first, h: undefined }));
    t.ok('в журнал — phase series, index 0 из 5, без образца комнаты', first.ev.length === 1 && first.ev[0].phase === 'series' && first.ev[0].index === 0 && first.ev[0].of === 5 && first.ev[0].room === false, JSON.stringify(first.ev));
    t.ok('после первого кадра — «Сделать остальные 4 (~$0.09)», «Первый кадр заново», «Все в коллаж», «Скачать все (1)»', /Сделать остальные 4 \(~\$0\.09\)/.test(first.h) && first.h.includes('Первый кадр заново') && first.h.includes('Все в коллаж') && first.h.includes('Скачать все (1)'), first.h.slice(0, 200));

    // ── Остальные: цена до запуска, отказ ничего не тратит ──
    const no = await page.evaluate(async () => { window.__confirmAns = false; await doStagedSeries('rest'); window.__confirmAns = true; return { reqs: window.__req.length, msg: window.__confirms.at(-1) }; });
    t.ok('перед остальными — число генераций и цена; «Отмена» — ни одного запроса', no.reqs === 1 && /Сделать ещё 4 кадра серии/.test(no.msg) && /4 × \$0\.023 ≈ \$0\.09/.test(no.msg) && /как на первом кадре/.test(no.msg), JSON.stringify(no));

    const rest = await page.evaluate(async () => {
      state.vision.staged.quality = 'high';
      const p = doStagedSeries('rest');   // занятость ставится до первого await — смотрим сразу
      const busy = { vb: visionBusy(), guard: jActBusy('staged-series-rest', null), dis: /data-act="staged-series-rest" disabled/.test(stagedCardHTML()) };
      await p;
      const s = state.vision.staged.series, r = window.__req.slice(1);
      const angles = state.vision.staged.angles.map(a => a.dataUrl);
      return {
        busy, n: r.length, order: r.map((q, k) => q.body.input_references[0].image_url.url === angles[k]),
        room: r.map(q => q.body.input_references.length === 2 && q.body.input_references[1].image_url.url.startsWith('data:image/jpeg')),
        rule: r.every(q => q.body.prompt.includes('ПРИЛОЖЕНЫ ДВЕ КАРТИНКИ') && q.body.prompt.startsWith(stagedPrompt(s))),
        q: r.map(q => q.body.quality), maxLen: Math.max(...r.map(q => q.len)), done: s.items.every(it => it.dataUrl),
        ev: window.__jlog.filter(x => x.ev === 'staged' && x.data.index > 0).map(x => [x.data.index, x.data.room]),
      };
    });
    t.ok('на время серии карточка занята: фото не сменить, повторный тап не оплачивается', rest.busy.vb && rest.busy.guard && rest.busy.dis, JSON.stringify(rest.busy));
    t.ok('остальные 4 — по одному, каждый со своим ракурсом по порядку', rest.n === 4 && rest.order.every(Boolean) && rest.done, JSON.stringify(rest));
    t.ok('вторым референсом — первый кадр, ужатый в JPEG; в промпте роли картинок названы', rest.room.every(Boolean) && rest.rule, JSON.stringify(rest));
    t.ok('тело каждого запроса под лимитом сервера (большой PNG первого кадра ужат)', rest.maxLen < 1500000, String(rest.maxLen));
    t.ok('качество остальных — текущее (черновик первого → финал остальных), в журнале room: true', rest.q.every(q => q === 'high') && JSON.stringify(rest.ev) === JSON.stringify([[1, true], [2, true], [3, true], [4, true]]), JSON.stringify(rest));

    // ── Ошибка посередине: стоп, «Доделать» продолжает с неё ──
    const fail = await page.evaluate(async () => {
      state.vision.staged.quality = 'medium';
      await doStagedSeries('first');                 // серия заново (подтверждение — да)
      const base = window.__req.length;
      window.__fail = base + 2;                      // упадёт второй из «остальных» — кадр 3
      await doStagedSeries('rest');
      const s = state.vision.staged.series;
      const after = { sent: window.__req.length - base, done: s.items.map(it => !!it.dataUrl), err: state.vision.staged.error, h: stagedCardHTML() };
      window.__fail = null;
      const b2 = window.__req.length;
      await doStagedSeries('rest');
      return { ...after, resumed: window.__req.length - b2, all: s.items.every(it => it.dataUrl), h: undefined, btn: /Доделать 3/.test(after.h), shown: after.h.includes('Кадр 3: Картинка 500') };
    });
    t.ok('ошибка на кадре 3 останавливает серию (кадры 4–5 не оплачиваются), видна в карточке', fail.sent === 2 && JSON.stringify(fail.done) === '[true,true,false,false,false]' && /^Кадр 3:/.test(fail.err) && fail.shown, JSON.stringify(fail));
    t.ok('«Доделать 3» продолжает с упавшего кадра — готовые не перерисовываются', fail.btn && fail.resumed === 3 && fail.all, JSON.stringify(fail));

    // ── «Одна комната» снята — один референс ──
    const solo = await page.evaluate(async () => {
      await doStagedSeries('first');
      state.vision.staged.oneRoom = false;
      const b = window.__req.length;
      await doStagedSeries('rest');
      const r = window.__req.slice(b);
      state.vision.staged.oneRoom = true;
      return { refs: r.map(q => q.body.input_references.length), rule: r.some(q => q.body.prompt.includes('ДВЕ КАРТИНКИ')), msg: window.__confirms.at(-1) };
    });
    t.ok('без «Одной комнаты» — по одному референсу, без правила про две картинки, в подтверждении сказано', solo.refs.every(n => n === 1) && !solo.rule && /своя/.test(solo.msg), JSON.stringify(solo));

    // ── Слишком тяжёлый запрос не уходит ──
    const heavy = await page.evaluate(async () => {
      const b = window.__req.length;
      let err = '';
      try { await stagedRequest('x', ['data:image/jpeg;base64,' + 'A'.repeat(STAGED_BODY_MAX)], 'medium'); } catch (e) { err = e.message; }
      return { sent: window.__req.length - b, err };
    });
    t.ok('тело больше лимита — запрос не отправляется, объяснение понятное', heavy.sent === 0 && /слишком тяжёлый/.test(heavy.err) && /не списаны/.test(heavy.err), JSON.stringify(heavy));

    // ── В коллаж и скачать все ──
    const out = await page.evaluate(async () => {
      cv.mode = 'game'; cv.images = [{ id: 99, url: 'x', el: new Image(), transform: { scale: 1, ox: 0, oy: 0 } }];
      stagedSeriesToCovers();
      await new Promise(r => { const t0 = Date.now(); const w = () => (cv.images.length === 5 || Date.now() - t0 > 3000) ? r() : setTimeout(w, 20); w(); });
      const res = { mode: cv.mode, n: cv.images.length, tab: state.tab, ask: /в коллаж/.test(window.__confirms.at(-1)), ev: (window.__jlog.filter(x => x.ev === 'cv_images').at(-1) || {}).data };
      const names = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
      stagedSeriesDownload();
      await new Promise(r => setTimeout(r, 1800));
      HTMLAnchorElement.prototype.click = orig;
      state.tab = 'generator'; render();
      return { ...res, names };
    });
    t.ok('«Все в коллаж» из «Игры» — с вопросом, переключает на коллаж, все 5 кадров', out.ask && out.mode === 'collage' && out.n === 5 && out.tab === 'covers' && out.ev && out.ev.source === 'staged_series' && out.ev.added === 5, JSON.stringify({ ...out, names: undefined }));
    t.ok('«Скачать все» — 5 файлов с номерами кадров', JSON.stringify(out.names) === JSON.stringify([1, 2, 3, 4, 5].map(i => `staged-shelf-series-${i}.png`)), JSON.stringify(out.names));

    // ── Убрать ракурс; новое фото товара сбрасывает серию ──
    const del = await page.evaluate(() => {
      stagedDelAngle(3);        // готовый кадр по нему — с вопросом
      const a = { angles: state.vision.staged.angles.length, items: state.vision.staged.series.items.length, ask: /уже нарисован/.test(window.__confirms.at(-1)) };
      stagedDelAngle(0); stagedDelAngle(0); stagedDelAngle(0);
      return { ...a, series: state.vision.staged.series, single: stagedCardHTML().includes('data-act="staged-gen"') };
    });
    t.ok('убранный ракурс уходит из серии вместе с кадром; без ракурсов — снова одиночный режим', del.angles === 3 && del.items === 4 && del.ask && del.series === null && del.single, JSON.stringify(del));

    await file('#ff00ff');
    await page.evaluate(() => doStagedSeries('first'));
    const b64 = await page.evaluate(() => window.__png(50, 50, '#123456').split(',')[1]);
    await page.setInputFiles('#vision-file', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
    await page.waitForFunction(() => !state.vision.staged.angles.length);
    t.ok('новое фото товара убирает ракурсы и серию прежнего товара', await page.evaluate(() => state.vision.staged.series === null && state.vision.staged.oneRoom === true));

    // ── Находки ревью серии ──
    // одно и то же фото дважды: убираем вторую копию — кадр первой цел
    const same = await page.evaluate(async () => {
      const st = state.vision.staged;
      const blob = await new Promise(r => { const c = document.createElement('canvas'); c.width = 60; c.height = 80; c.getContext('2d').fillRect(0, 0, 60, 80); c.toBlob(r, 'image/png'); });
      const file = new File([blob], 'a.png', { type: 'image/png' });
      await stagedAddAngle(file); await stagedAddAngle(file);          // два одинаковых ракурса
      await doStagedSeries('first');
      await doStagedSeries('rest');
      const s = st.series;
      s.items[2].dataUrl = null;                                        // у второй копии кадра ещё нет
      const before = window.__confirms.length;
      stagedDelAngle(1);                                                // убираем вторую копию
      return { asked: window.__confirms.length - before, items: s.items.length, firstCopyKept: !!s.items[1].dataUrl, sameSrc: st.angles[0].dataUrl === s.items[1].src };
    });
    t.ok('одинаковое фото дважды: убрана вторая копия — без вопроса, готовый кадр первой копии цел (ревью серии)', same.asked === 0 && same.items === 2 && same.firstCopyKept && same.sameSrc, JSON.stringify(same));
    const keep = await page.evaluate(() => {
      const st = state.vision.staged, first = st.series.items[0].dataUrl;
      st.error = 'старая ошибка';
      st.series.items[1].dataUrl = null;                                // кадр ракурса не нарисован — убирается без вопроса
      stagedDelAngle(0);
      return { img: st.img && st.img.dataUrl === first, series: st.series, err: st.error, single: stagedCardHTML().includes('↻ Ещё вариант') };
    });
    t.ok('убрал последний ракурс — оплаченный первый кадр остаётся результатом одиночного режима (ревью серии)', keep.img && keep.series === null && keep.err === '' && keep.single, JSON.stringify(keep));
    const stale = await page.evaluate(async () => {
      const st = state.vision.staged;
      st.error = 'Картинка 500: одиночный запрос упал';
      await stagedAddAngle(new File([await new Promise(r => { const c = document.createElement('canvas'); c.width = 30; c.height = 30; c.toBlob(r, 'image/png'); })], 'b.png', { type: 'image/png' }));
      const h = stagedCardHTML();
      stagedDelAngle(0);
      return { err: st.error, shown: h.includes('одиночный запрос упал') };
    });
    t.ok('ошибка одиночного режима не висит в серии (ревью серии)', stale.err === '' && !stale.shown, JSON.stringify(stale));
    const price = await page.evaluate(() => ({ one: stagedUsd('medium', 1), four: stagedUsd('medium', 4) }));
    t.ok('цена кадра в подтверждении — с тремя знаками, сходится с итогом: 4 × $0.023 ≈ $0.09 (ревью серии)', price.one === '$0.023' && price.four === '$0.09', JSON.stringify(price));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }

  // ── Разбор журнала: скачивания серий не смешиваются с одиночными (ревью серии) ──
  {
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), cp = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-'));
    const ev = (i, o) => JSON.stringify({ ts: `2026-09-28T10:00:0${i}Z`, device: 't', eid: 'e' + i, event: 'staged', ...o });
    fs.writeFileSync(path.join(dir, 'j.jsonl'), [
      ev(1, { phase: 'generate', scene: 'shelf', quality: 'medium' }),
      ev(2, { phase: 'generate', scene: 'shelf', quality: 'medium' }),
      ev(3, { phase: 'series', index: 0, of: 3, room: false }),
      ev(4, { phase: 'series', index: 1, of: 3, room: true }),
      ev(5, { phase: 'series', index: 2, of: 3, room: true }),
      ev(6, { phase: 'download', series: true, count: 3 }),
      ev(7, { phase: 'download', series: true, count: 3 }),
    ].join('\n') + '\n');
    const out = cp.execFileSync(process.execPath, [path.resolve('../tools/journal-report.mjs'), dir], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    t.ok('отчёт: одиночных скачано 0 (серии не подмешаны), серии — отдельной строкой с числом файлов', /Сгенерировано: 2 · скачано: 0/.test(out) && /Ни одна картинка не скачана/.test(out) && /«Скачать все» по сериям: 2 раз, файлов 6/.test(out) && /первых кадров 1 · остальных кадров 2 \(с образцом комнаты — 2\)/.test(out), out.slice(out.indexOf('Товар в интерьере'), out.indexOf('Товар в интерьере') + 700));
  }
}

