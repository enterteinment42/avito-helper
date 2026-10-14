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
      t.ok('F25: второй вопрос называет записи с финалом', /с донесённым финалом, которого в файле нет: 1/.test(rp.asked), rp.asked);
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

      // Ревью 15.10: заголовки не пришли — пакет не потерян
      await setup();
      await page.evaluate(() => { save(); window.callAI = async () => { throw new Error('Сеть упала.'); }; });
      await answerConfirms(page, [true]);
      await page.evaluate(() => doGenTitlesOnly());
      const fail = await page.evaluate(() => ({
        batch: state.batchResults.length,
        stored: JSON.parse(localStorage.getItem('avito_batch_results') || '[]').length,
        toast: document.getElementById('toast')?.textContent || '',
      }));
      t.ok('F28: ошибка заголовков — пакет на месте и на диске', fail.batch === 1 && fail.stored === 1, JSON.stringify(fail));
      t.ok('F28: ошибка видна тостом (пакет заслоняет блок ошибки)', /Заголовки не получены: Сеть упала/.test(fail.toast), fail.toast);
      const unexpected = consoleErrors.filter(e => !/Сеть упала/.test(e));
      t.ok('F28: консоль чистая (кроме ожидаемой ошибки)', unexpected.length === 0, unexpected.join(' | '));
    } finally { await ctx.close(); }
  }

  // ── Ревью 15.10: импорт, корзина, восстановление настроек ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: OFF });
    try {
      // 1. Замена: пара в файле есть, но без финала — финал всё равно в корзину
      const a = { id: 800, _uid: 'u-800', product: 'GTA 5', region: 'Омск', title: 'Т', description: 'Бот', finalDesc: 'Мой финал', status: 'active', note: '', date: '01.10.2026' };
      await page.evaluate((a) => { state.db = [a]; localStorage.removeItem('avito_trash'); save(); }, a);
      const noFinal = { ...a }; delete noFinal.finalDesc;
      await importFile(page, 'r1.json', { v: 3, db: [noFinal] }, [false, true]);
      const r1 = await page.evaluate(() => ({ asked: window.__asked[1] || '', trash: syncTrash().map(x => x.rec.finalDesc), db: state.db[0]?.finalDesc }));
      t.ok('ревью: пара без финала — вопрос называет запись', /финалом, которого в файле нет: 1/.test(r1.asked), r1.asked);
      t.ok('ревью: финал при такой замене — в корзине', r1.trash.includes('Мой финал'), JSON.stringify(r1));

      // 3. Близнецы без _uid: у каждого своё время в корзине, возврат одного не стирает другого
      const tw = (n) => ({ id: 900 + n, product: 'Близнец', region: 'Пермь', title: 'Т', description: 'Бот', finalDesc: 'Финал ' + n, status: 'active', note: '', date: '02.10.2026' });
      await page.evaluate((list) => { state.db = list; localStorage.removeItem('avito_trash'); save(); }, [tw(1), tw(2)]);
      await page.evaluate(() => { state.db.forEach(r => delete r._uid); save(); });
      await importFile(page, 'r3.json', { v: 3, db: [] }, [false, true]);
      const r3 = await page.evaluate(() => { const t = syncTrash(); return { n: t.length, ats: new Set(t.map(x => x.key + '|' + x.at)).size }; });
      t.ok('ревью: у записей в корзине разные метки «ключ+время»', r3.n === 2 && r3.ats === 2, JSON.stringify(r3));
      await page.evaluate(() => { state.tab = 'settings'; render(); document.querySelectorAll('details').forEach(d => d.open = true); });
      await page.click('[data-act="trash-restore"]');
      t.eq('ревью: возврат одного близнеца оставляет второго в корзине', await page.evaluate(() => syncTrash().length), 1);

      // 8. Корзина не вмещает — замены нет
      await page.evaluate(() => {
        const big = 'x'.repeat(60000);
        state.db = [1, 2, 3, 4].map(i => ({ id: 1000 + i, _uid: 'big' + i, product: 'Большой', region: 'R' + i, title: 'Т', description: 'Б', finalDesc: big + i, status: 'active', note: '', date: '03.10.2026' }));
        localStorage.removeItem('avito_trash'); save();
      });
      await importFile(page, 'r8.json', { v: 3, db: [] }, [false, true]);
      const r8 = await page.evaluate(() => ({ db: state.db.length, trash: syncTrash().length, toast: document.getElementById('toast')?.textContent || '' }));
      t.ok('ревью: корзина не вмещает финалы — база не заменена, корзина не тронута', r8.db === 4 && r8.trash === 0, JSON.stringify({ db: r8.db, trash: r8.trash }));
      t.ok('ревью: тост объясняет и называет «⬇ Бэкап JSON»', /Замена отменена/.test(r8.toast) && /Бэкап JSON/.test(r8.toast), r8.toast);

      // 6. Обрезка корзины по размеру — свежее остаётся, лимит соблюдён
      const fit = await page.evaluate(() => {
        const list = Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, at: String(i), rec: { d: 'y'.repeat(10000) } }));
        const out = syncTrashFit(list);
        return { len: JSON.stringify(out).length, last: out[out.length - 1].key, first: out[0].key };
      });
      t.ok('ревью: обрезка корзины держит лимит и выкидывает старое', fit.len <= 200000 && fit.last === 'k29' && fit.first !== 'k0', JSON.stringify(fit));

      // 7. «Слить» не воскрешает удалённое
      const del = { id: 1100, _uid: 'u-del', product: 'Удалённая', region: 'Уфа', title: 'Т', description: 'Б', status: 'active', note: '', date: '04.10.2026' };
      await page.evaluate((d) => { state.db = [d]; save(); syncTomb(syncDbKey(d), d, 'db'); state.db = []; save(); }, del);
      await importFile(page, 'r7.json', { v: 3, db: [del, { ...del, id: 1101, _uid: 'u-live', product: 'Живая' }] }, [true]);
      const r7 = await page.evaluate(() => ({ prods: state.db.map(r => r.product), toast: document.getElementById('toast')?.textContent || '' }));
      t.ok('ревью: «слить» пропускает удалённую тобой запись', !r7.prods.includes('Удалённая') && r7.prods.includes('Живая'), JSON.stringify(r7.prods));
      t.ok('ревью: тост называет число пропущенных удалённых', /пропущено удалённых тобой раньше: 1/.test(r7.toast), r7.toast);

      // 2. Восстановление настроек из бэкапа — текущий промпт уходит в историю
      await page.evaluate(() => { state.settings.customSys = 'Текущий промпт'; state.settings.customSysHist = [{ text: 'Локальная старая', at: '2026-10-10T00:00:00.000Z' }]; save();
        window.__jl = []; const o = window.jlog; window.jlog = (ev, c, d) => { window.__jl.push({ event: ev, ...d }); return o(ev, c, d); }; });
      await importFile(page, 'r2.json', { v: 3, db: [], settings: { customSys: 'Промпт из бэкапа', customSysHist: [{ text: 'Древний', at: '2026-01-01T00:00:00.000Z' }] } }, [true, true]);
      const r2 = await page.evaluate(() => ({ sys: state.settings.customSys, hist: state.settings.customSysHist.map(h => h.text), j: window.__jl.find(e => e.event === 'sys_changed') }));
      t.eq('ревью: промпт из бэкапа применён', r2.sys, 'Промпт из бэкапа');
      t.eq('ревью: текущий — первым в истории, затем обе истории по дате', r2.hist.join(' | '), 'Текущий промпт | Локальная старая | Древний');
      t.ok('ревью: смена промпта восстановлением — в журнале', r2.j && r2.j.via === 'restore' && r2.j.prev === 'Текущий промпт', JSON.stringify(r2.j));

      // 4. Мусор в истории не сдвигает кнопки
      const r4 = await page.evaluate(() => {
        state.settings.customSys = 'Сейчас';
        state.settings.customSysHist = [null, { text: 'A', at: '' }, {}, { text: '' }, { text: 'B', at: '' }];
        state.tab = 'settings'; render();
        const n = document.querySelectorAll('[data-sys-hist]').length;
        document.querySelector('[data-sys-hist="0"]').click();
        return { n, sys: state.settings.customSys };
      });
      t.ok('ревью: пустые версии не показываются, «↩ вернуть» берёт показанную', r4.n === 2 && r4.sys === 'A', JSON.stringify(r4));
      t.ok('ревью: консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
    } finally { await ctx.close(); }
  }
}
