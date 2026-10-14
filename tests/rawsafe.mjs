// Секция rawsafe — находки аудита №3 (14.10.2026), где сырьё или промпт терялись молча:
// F27 категория эталона из Истории, F24 сброс своего промпта, F22 финал из соседней
// вкладки, F23/F25 импорт бэкапа (слить / заменить), F28 пакет прятал шаг заголовков.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp, stubAI } from './lib.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'avito-rawsafe-'));
const OFF = { avito_sync_off: '1', avito_journal_off: '1' };

// Ответы на confirm() по порядку; тексты вопросов копятся для проверки
async function answerConfirms(page, answers) {
  await page.evaluate(a => {
    window.__answers = a.slice(); window.__asked = [];
    window.confirm = (q) => { window.__asked.push(String(q)); return window.__answers.length ? window.__answers.shift() : false; };
  }, answers);
}
async function importFile(page, name, payload, answers) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  await answerConfirms(page, answers);
  await page.evaluate(() => { state.tab = 'database'; render(); });
  await page.setInputFiles('#db-import-file', file);
  await page.waitForTimeout(250);
}

export async function runRawsafe(browser, base, t) {
  t.section('rawsafe — аудит №3: сырьё и промпт не теряются молча');

  // ── F27: категория эталона из формы Истории — только явным выбором (решение 15.10) ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: OFF });
    try {
      const form = (o) => ({ product: 'GTA 5', region: 'Пермь', status: 'active', note: '', account: '',
                             title: 'GTA 5 PS4 PS5', desc: 'Текст объявления руками', toRefs: true, postedAt: '', refCat: '', ...o });
      const r = await page.evaluate((f) => {
        state.form.category = 'game';   // генератор стоит на играх — подставляться это не должно
        state.tab = 'database'; render();
        const shown = document.getElementById('db-f-refcat')?.value;
        const label = document.getElementById('db-f-refcat')?.selectedOptions[0]?.textContent || '';
        const nDb = state.db.length, nRefs = state.refs.length;
        state.dbForm = f;
        document.querySelector('[data-act="db-add"]')?.click();
        return { shown, label, db: state.db.length - nDb, refs: state.refs.length - nRefs, toast: document.getElementById('toast')?.textContent || '' };
      }, form());
      t.eq('F27: по умолчанию категория не выбрана', r.shown, '');
      t.ok('F27: в списке видно «— выбери категорию —»', /выбери категорию/.test(r.label), r.label);
      t.ok('F27: без выбора не сохраняется ни запись, ни эталон (нет полузаписи)', r.db === 0 && r.refs === 0, JSON.stringify(r));
      t.ok('F27: тост объясняет, что сделать', /Выбери категорию эталона/.test(r.toast), r.toast);

      const ok = await page.evaluate((f) => {
        const nDb = state.db.length;
        state.dbForm = f;
        document.querySelector('[data-act="db-add"]')?.click();
        return { db: state.db.length - nDb, cat: state.refs[state.refs.length - 1]?.category, next: state.dbForm.refCat,
                 shownNext: document.getElementById('db-f-refcat')?.value };
      }, form({ refCat: 'gaming_sub' }));
      t.eq('F27: с выбором — запись добавлена', ok.db, 1);
      t.eq('F27: эталон в выбранной категории, а не в категории генератора', ok.cat, 'gaming_sub');
      t.ok('F27: для следующего эталона выбор снова пуст', ok.next === '' && ok.shownNext === '', JSON.stringify(ok));

      // Галочка снята — категория не нужна
      const noRef = await page.evaluate((f) => {
        const nDb = state.db.length, nRefs = state.refs.length;
        state.dbForm = f;
        document.querySelector('[data-act="db-add"]')?.click();
        return { db: state.db.length - nDb, refs: state.refs.length - nRefs };
      }, form({ toRefs: false, title: 'Другой', desc: 'Другой текст' }));
      t.ok('F27: без галочки «в эталоны» запись сохраняется и без категории', noRef.db === 1 && noRef.refs === 0, JSON.stringify(noRef));

      // Правка записи: категория записи подставлена — она её собственная, не генератора
      const e = await page.evaluate(() => {
        const rec = state.db.find(r => r.title === 'Другой');
        rec._category = 'ai_sub';
        document.body.insertAdjacentHTML('beforeend', `<button id="__edit" data-act="db-edit" data-id="${rec.id}"></button>`);
        document.getElementById('__edit').click();
        const shown = document.getElementById('db-f-refcat')?.value;
        state.dbForm.title = 'Новый заголовок'; state.dbForm.desc = 'Новый текст'; state.dbForm.toRefs = true;
        document.querySelector('[data-act="db-save"]')?.click();
        return { shown, saved: state.refs[state.refs.length - 1]?.category };
      });
      t.ok('F27: при правке — категория самой записи', e.shown === 'ai_sub' && e.saved === 'ai_sub', JSON.stringify(e));
      t.eq('F27: явный выбор «Другое» уважается', await page.evaluate(() => dbRefCat({ refCat: 'other' })), 'other');
      t.ok('F27: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }

  // ── F24: свой промпт не стирается одним кликом ──
  {
    const seed = { ...OFF, avito_settings: JSON.stringify({ customSys: 'Мой промпт: без эмодзи, дефис вместо тире.' }) };
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: seed });
    try {
      // Журнал в этой странице выключен (не ходить на сервер) — события ловим перехватом
      await page.evaluate(() => {
        window.__jl = [];
        const orig = window.jlog;
        window.jlog = (ev, chain, data) => { window.__jl.push({ event: ev, ...data }); return orig(ev, chain, data); };
        state.tab = 'settings'; render();
      });
      // Отмена — ничего не меняется
      await answerConfirms(page, [false]);
      await page.click('#sys-reset');
      const kept = await page.evaluate(() => ({ sys: state.settings.customSys, asked: window.__asked[0] || '' }));
      t.eq('F24: «Сбросить» с отменой промпт не трогает', kept.sys, 'Мой промпт: без эмодзи, дефис вместо тире.');
      t.ok('F24: вопрос называет длину текста', /\(42 знаков\)/.test(kept.asked), kept.asked);

      const MINE = 'Мой промпт: без эмодзи, дефис вместо тире.';
      await answerConfirms(page, [true]);
      await page.click('#sys-reset');
      const reset = await page.evaluate(() => ({
        sys: state.settings.customSys, hist: state.settings.customSysHist.map(h => h.text),
        at: state.settings.customSysHist[0]?.at,
        stored: JSON.parse(localStorage.getItem('avito_settings')).customSysHist?.map(h => h.text),
        list: document.querySelectorAll('[data-sys-hist]').length,
        summary: document.querySelector('[data-sys-hist]')?.closest('details')?.querySelector('summary')?.textContent || '',
        logged: window.__jl.find(e => e.event === 'sys_changed'),
      }));
      t.eq('F24: сброс подтверждён — промпт пуст', reset.sys, '');
      t.ok('F24: прежняя версия в истории, с датой', reset.hist.length === 1 && reset.hist[0] === MINE && !!reset.at, JSON.stringify(reset));
      t.ok('F24: история записана на диск (едет в бэкап и на сервер)', reset.stored?.[0] === MINE, JSON.stringify(reset.stored));
      t.ok('F24: список «Прежние версии» виден', reset.list === 1 && /Прежние версии — 1 из 5/.test(reset.summary), reset.summary);
      t.ok('F24: журнал получил обе версии', reset.logged && reset.logged.via === 'reset' && reset.logged.prev === MINE && reset.logged.next === '', JSON.stringify(reset.logged));

      await page.evaluate(() => document.querySelector('[data-sys-hist]').closest('details').open = true);
      await page.click('[data-sys-hist="0"]');
      const back = await page.evaluate(() => ({ sys: state.settings.customSys, hist: state.settings.customSysHist.length }));
      t.eq('F24: «↩ вернуть» возвращает текст', back.sys, MINE);
      t.eq('F24: вернувшаяся версия ушла из списка (пустой текст в историю не кладётся)', back.hist, 0);

      // Семь правок подряд: хранятся пять последних, свежие первыми, без повторов
      const many = await page.evaluate(() => {
        for (const s of ['в1', 'в2', 'в3', 'в2', 'в4', 'в5', 'в6', 'в7']) sysReplace(s, 'save');
        return state.settings.customSysHist.map(h => h.text);
      });
      t.eq('F24: хранятся 5 последних версий, свежие первыми, без повторов', many.join(','), 'в6,в5,в4,в2,в3');
      const mid = await page.evaluate(() => { sysReplace(state.settings.customSysHist[3].text, 'undo'); return { sys: state.settings.customSys, hist: state.settings.customSysHist.map(h => h.text) }; });
      t.ok('F24: возврат версии из середины — текущая уходит в историю первой', mid.sys === 'в2' && mid.hist.join(',') === 'в7,в6,в5,в4,в3', JSON.stringify(mid));
      await page.evaluate((m) => { sysReplace(m, 'undo'); render(); }, MINE);

      // «Сохранить» с пустым полем — тоже стирание, тоже спрашивает
      await page.fill('#sys-prompt', '   ');
      await answerConfirms(page, [false]);
      await page.click('#sys-save');
      t.eq('F24: «Сохранить» пустого поля с отменой ничего не стирает', await page.evaluate(() => state.settings.customSys), MINE);

      // Обычная замена текста — без вопроса, но с прежней версией
      await page.fill('#sys-prompt', 'Новый промпт');
      await answerConfirms(page, []);
      await page.click('#sys-save');
      const sv = await page.evaluate(() => ({ sys: state.settings.customSys, prev: state.settings.customSysHist[0]?.text, asked: window.__asked.length }));
      t.ok('F24: замена текста не спрашивает и помнит прежний', sv.sys === 'Новый промпт' && sv.prev === 'Мой промпт: без эмодзи, дефис вместо тире.' && sv.asked === 0, JSON.stringify(sv));
      t.ok('F24: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }

  // ── F22: финал, донесённый в соседней вкладке, не затирается устаревшей ──
  {
    const rec = { id: 500, _uid: 'u-500', product: 'PS Plus Extra', region: 'Пермь', title: 'Т', description: 'Бот', status: 'active', note: '', date: '01.10.2026' };
    const ref = { id: 600, source: 'other', category: 'game', title: 'Чужое', desc: 'Чужой текст', date: '01.10.2026' };
    const seed = { ...OFF, avito_db: JSON.stringify([rec]), avito_refs: JSON.stringify([ref]) };
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: seed });
    try {
      // «Соседняя вкладка» пишет в хранилище: финал в ту же запись + приёмы эталона
      const r = await page.evaluate(([rec, ref]) => {
        localStorage.setItem('avito_db', JSON.stringify([{ ...rec, finalTitle: 'Ф', finalDesc: 'Финал из соседней вкладки', editShare: 0.4 }]));
        localStorage.setItem('avito_refs', JSON.stringify([{ ...ref, tricks: ['начинает с вопроса'] }]));
        // Эта вкладка устарела и что-то сохраняет (☆, статус — неважно)
        state.db[0].note = 'правка в старой вкладке';
        save();
        const disk = JSON.parse(localStorage.getItem('avito_db'))[0];
        return { mem: state.db[0].finalDesc, disk: disk.finalDesc, note: disk.note, n: state.db.length,
                 tricks: JSON.parse(localStorage.getItem('avito_refs'))[0].tricks };
      }, [rec, ref]);
      t.eq('F22: финал соседней вкладки подтянут в память', r.mem, 'Финал из соседней вкладки');
      t.eq('F22: и остался на диске после записи устаревшей вкладки', r.disk, 'Финал из соседней вкладки');
      t.eq('F22: своя правка этой вкладки тоже на месте', r.note, 'правка в старой вкладке');
      t.eq('F22: запись не задвоилась', r.n, 1);
      t.ok('F22: разобранные приёмы эталона не затёрты', Array.isArray(r.tricks) && r.tricks.length === 1, JSON.stringify(r.tricks));

      // Свой финал побеждает чужой — правило «недостающее берём, своё не трогаем»
      const own = await page.evaluate((rec) => {
        state.db[0].finalDesc = 'Свой финал';
        localStorage.setItem('avito_db', JSON.stringify([{ ...rec, finalDesc: 'Чужой финал' }]));
        save();
        return JSON.parse(localStorage.getItem('avito_db'))[0].finalDesc;
      }, rec);
      t.eq('F22: свой финал не перезаписывается чужим', own, 'Свой финал');
      t.ok('F22: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }

  // ── F23 / F25: импорт бэкапа ──
  {
    const a = { id: 700, _uid: 'u-700', product: 'GTA 5', region: 'Пермь', title: 'Т', description: 'Бот А', status: 'active', note: '', date: '01.10.2026' };
    const twin = { ...a, id: 701, _uid: 'u-701' };   // повторное «✓ Размещено» — законный близнец
    const lone = { id: 702, _uid: 'u-702', product: 'Минус', region: 'Сыктывкар', title: 'Л', description: 'Бот Л', finalDesc: 'Финал, которого нет в файле', status: 'active', note: '', date: '02.10.2026' };
    const seed = { ...OFF, avito_db: JSON.stringify([a, lone]) };
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: seed });
    try {
      // В файле: та же запись А — уже с финалом, и её близнец
      const fileA = { ...a, finalTitle: 'ФА', finalDesc: 'Финал А из бэкапа', editShare: 0.2, postedAt: 1759000000000 };
      await importFile(page, 'merge.json', { v: 3, db: [fileA, twin] }, [true]);
      const m = await page.evaluate(() => ({
        n: state.db.length, aFinal: state.db.find(r => r._uid === 'u-700')?.finalDesc,
        aPosted: state.db.find(r => r._uid === 'u-700')?.postedAt,
        twin: !!state.db.find(r => r._uid === 'u-701'),
        toast: document.getElementById('toast')?.textContent || '',
        ids: new Set(state.db.map(r => r.id)).size,
      }));
      t.eq('F23: «слить» возвращает финал в уже существующую запись', m.aFinal, 'Финал А из бэкапа');
      t.eq('F23: и поля учёта (дата публикации)', m.aPosted, 1759000000000);
      t.ok('F23: законный близнец (свой _uid) добавлен, а не схлопнут', m.twin && m.n === 3, JSON.stringify(m));
      t.eq('F23: id не пересекаются', m.ids, m.n);
      t.ok('F23: тост говорит о дополненных записях, а не о «дублях»', /дополнено записей[^:]*: 1/.test(m.toast) && !/дублей/.test(m.toast), m.toast);

      // F25: замена — записи с финалом без пары в файле уходят в корзину
      await importFile(page, 'replace.json', { v: 3, db: [fileA] }, [false, true]);
      const rp = await page.evaluate(() => ({
        n: state.db.length,
        asked: window.__asked[1] || '',
        trash: syncTrash().filter(x => x.kind === 'db').map(x => x.rec.finalDesc),
      }));
      t.eq('F25: база заменена содержимым файла', rp.n, 1);
      t.ok('F25: второй вопрос называет записи с финалом', /с донесённым финалом и без пары в файле: 1/.test(rp.asked), rp.asked);
      t.ok('F25: запись с финалом — в корзине', rp.trash.includes('Финал, которого нет в файле'), JSON.stringify(rp.trash));
      t.ok('F25: запись, которая есть в файле, в корзину не попала', !rp.trash.includes('Финал А из бэкапа'), JSON.stringify(rp.trash));

      // Возврат из корзины работает для таких записей
      await page.evaluate(() => { state.tab = 'settings'; render(); document.querySelectorAll('details').forEach(d => d.open = true); });
      await page.click('[data-act="trash-restore"]');
      t.ok('F25: запись возвращается из корзины', await page.evaluate(() => state.db.some(r => r.finalDesc === 'Финал, которого нет в файле')));

      // Отказ от замены — ни корзины, ни замены
      const before = await page.evaluate(() => ({ n: state.db.length, trash: syncTrash().length }));
      await importFile(page, 'replace2.json', { v: 3, db: [] }, [false, false]);
      const after = await page.evaluate(() => ({ n: state.db.length, trash: syncTrash().length }));
      t.ok('F25: отказ от замены не трогает ни базу, ни корзину', before.n === after.n && before.trash === after.trash, JSON.stringify({ before, after }));
      t.ok('F23/F25: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }

  // ── F28: шаг заголовков при сохранённом пакете ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: OFF });
    try {
      await stubAI(page, JSON.stringify({ titles: [{ title: 'Заголовок один', hook: 'х' }, { title: 'Заголовок два', hook: 'х' }] }));
      const setup = () => page.evaluate(() => {
        state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));
        state.batchResults = [{ id: 1, region: 'Пермь', title: 'Пакет', description: 'Текст пакета' }];
        state.tab = 'generator'; render();
      });
      await setup();
      await answerConfirms(page, [false]);
      await page.evaluate(() => doGenTitlesOnly());
      const no = await page.evaluate(() => ({ batch: state.batchResults.length, calls: window.__aiCalls.length, asked: window.__asked[0] || '' }));
      t.ok('F28: при пакете шаг заголовков спрашивает', /сохранённый пакет/.test(no.asked), no.asked);
      t.ok('F28: отказ — пакет на месте, запроса к модели нет', no.batch === 1 && no.calls === 0, JSON.stringify(no));

      await answerConfirms(page, [true]);
      await page.evaluate(() => doGenTitlesOnly());
      const yes = await page.evaluate(() => ({
        batch: state.batchResults.length, step: state.titleStep?.titles.length || 0,
        shown: (document.getElementById('results-box')?.textContent || '').includes('Заголовок один'),
        stored: JSON.parse(localStorage.getItem('avito_batch_results') || '[]').length,
      }));
      t.ok('F28: согласие — пакет убран, шаг заголовков виден', yes.batch === 0 && yes.step === 2 && yes.shown, JSON.stringify(yes));
      t.eq('F28: пакет убран и с диска (не вернётся на F5)', yes.stored, 0);

      // Без пакета — без лишнего вопроса
      await answerConfirms(page, []);
      await page.evaluate(() => doGenTitlesOnly());
      t.eq('F28: без пакета вопроса нет', await page.evaluate(() => window.__asked.length), 0);
      t.ok('F28: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }
}
