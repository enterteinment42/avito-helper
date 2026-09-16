// Секция rotate — ротация объявлений и учёт по аккаунтам.
// Объявление на Авито выдыхается, и владелец крутит его руками: тот же текст с
// другими формами написания и новым заголовком. Здесь проверяется, что ротация
// (а) берёт то, что реально висит — финал, а не бот-версию, (б) не предлагает
// занятое название, (в) ничего не удаляет: прежняя запись остаётся с текстом,
// а новая только ссылается на неё. Плюс второй аккаунт: записи, заведённые
// руками, должны быть полноценными, иначе половина работы вне учёта.
import { openApp } from './lib.mjs';

const BOT   = 'Бот-версия описания. Оформляется в цифре. PS4 PS5';
const FINAL = 'Финальный текст, как он ушёл на Авито: свои слова, свой хвост про живого человека. PS4 PS5';
const ROT_JSON = JSON.stringify({
  variants: [{ id: 1, title: 'Прокрученный заголовок', description: 'Прокрученное описание. пс4 пс5',
               style: 'деловой', price_format: 'общая', hook: 'фича', structure: 'эмоция→содержимое' }],
});

// Запись Истории с заданными полями поверх разумных умолчаний
const REC = `(o = {}) => Object.assign({
  id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров',
  title: 'Бот-заголовок', description: ${JSON.stringify(BOT)},
  status: 'active', note: '', date: '01.09.2026', _category: 'gaming_sub', account: 'a1',
}, o)`;

export async function runRotate(browser, base, t) {
  t.section('rotate — возраст, степени ротации, аккаунты, учёт без генератора');

  // ── Возраст и порог ─────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(([mkSrc]) => {
      const mk = eval(mkSrc);
      const D = 86400000, now = Date.now();
      const out = {};
      state.settings.rotDays = 14;

      out.ageFromId = rotAgeDays(mk({ id: now - 20 * D }), now);
      // Дата публикации важнее момента нажатия: отметить размещение можно и задним числом
      out.ageFromPosted = rotAgeDays(mk({ id: now, postedAt: now - 5 * D }), now);

      out.dueOld   = rotDue(mk({ id: now - 20 * D }), now);
      out.dueFresh = rotDue(mk({ id: now - 3 * D }), now);
      out.dueEdge  = rotDue(mk({ id: now - 14 * D }), now);          // ровно порог — уже пора
      out.ownLonger = rotDue(mk({ id: now - 20 * D, rotDays: 30 }), now);
      out.ownShorter = rotDue(mk({ id: now - 5 * D, rotDays: 3 }), now);
      out.offNever = rotDue(mk({ id: now - 99 * D, rotOff: true }), now);
      out.removed  = rotDue(mk({ id: now - 99 * D, status: 'removed' }), now);
      out.paused   = rotDue(mk({ id: now - 99 * D, status: 'paused' }), now);

      // Список «пора обновить» строится по той же логике
      state.db = [mk({ id: now - 20 * D, _uid: 'a' }), mk({ id: now - 2 * D, _uid: 'b' }),
                  mk({ id: now - 40 * D, _uid: 'c', rotOff: true })];
      out.dueList = rotDueList(now).length;

      // Порог из настроек, а не зашитый
      state.settings.rotDays = 60;
      out.afterRaise = rotDue(mk({ id: now - 20 * D }), now);
      state.settings.rotDays = 14;
      return out;
    }, [REC]);

    t.eq('возраст считается от даты записи', r.ageFromId, 20);
    t.eq('правленая дата публикации важнее момента нажатия', r.ageFromPosted, 5);
    t.ok('выдохшееся объявление помечено', r.dueOld === true);
    t.ok('свежее не трогаем', r.dueFresh === false);
    t.ok('ровно порог — уже пора', r.dueEdge === true);
    t.ok('свой срок длиннее общего отодвигает напоминание', r.ownLonger === false);
    t.ok('свой срок короче общего приближает его', r.ownShorter === true);
    t.ok('«не ротировать» отменяет напоминание навсегда', r.offNever === false);
    t.ok('снятое объявление не напоминает', r.removed === false);
    t.ok('поставленное на паузу тоже', r.paused === false);
    t.eq('в списке «пора обновить» только просроченные', r.dueList, 1);
    t.ok('порог берётся из настроек', r.afterRaise === false);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Что крутим: финал важнее бот-версии ─────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(([mkSrc, fin]) => {
      const mk = eval(mkSrc);
      const out = {};
      out.noFinal = rotLiveText(mk());
      out.withFinal = rotLiveText(mk({ finalTitle: 'Мой заголовок', finalDesc: fin }));
      out.empty = rotLiveText(mk({ title: '', description: '' }));
      return out;
    }, [REC, FINAL]);

    t.eq('без финала крутим текст записи', r.noFinal.desc, BOT);
    t.eq('донесённый финал важнее бот-версии', r.withFinal.desc, FINAL);
    t.eq('и заголовок тоже финальный', r.withFinal.title, 'Мой заголовок');
    t.ok('пустая запись даёт пустой текст', !r.empty.title && !r.empty.desc);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Занятые названия: свой аккаунт и чужой ──────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(([mkSrc]) => {
      const mk = eval(mkSrc);
      const out = {};
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];
      state.db = [
        mk({ id: 1, _uid: 'u1', title: 'Заголовок А', account: 'a1' }),
        mk({ id: 2, _uid: 'u2', title: 'Заголовок Б', account: 'a1' }),
        mk({ id: 3, _uid: 'u3', title: 'Заголовок В', account: 'a2' }),
        mk({ id: 4, _uid: 'u4', title: 'Чужой товар', account: 'a1', product: 'EA Play' }),
        mk({ id: 5, _uid: 'u5', title: 'Бот', finalTitle: 'Правленый заголовок', account: 'a1' }),
      ];
      const rec = state.db[0];
      out.own   = rotUsedTitles(rec, false);
      out.cross = rotUsedTitles(rec, true);
      return out;
    }, [REC]);

    t.ok('названия своего аккаунта в списке занятых', r.own.includes('Заголовок А') && r.own.includes('Заголовок Б'));
    t.ok('название другого аккаунта туда НЕ попадает', !r.own.includes('Заголовок В'));
    t.ok('название другого товара не попадает', !r.own.includes('Чужой товар'));
    t.ok('правленый вручную заголовок тоже считается занятым', r.own.includes('Правленый заголовок'));
    t.ok('режим «по всем аккаунтам» добирает соседний профиль', r.cross.includes('Заголовок В'));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Промпты двух степеней ───────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(([fin]) => {
      const live = { title: 'Исходный заголовок', desc: fin };
      return {
        light: rotPrompt('light', live, ['Занятое имя']),
        mid:   rotPrompt('mid',   live, []),
      };
    }, [FINAL]);

    t.ok('лёгкая просит прокрутить, а не переписать', /ПРОКРУТИТЬ/.test(r.light));
    t.ok('лёгкая ограничивает объём правки', /треть/.test(r.light));
    t.ok('лёгкая велит сохранить структуру', /Структуру/.test(r.light));
    t.ok('лёгкая запрещает трогать факты', /цены, сроки, состояние/.test(r.light));
    t.ok('лёгкая бережёт личные куски продавца', /НЕ выбрасывать/.test(r.light));
    t.ok('занятое название уходит в промпт', r.light.includes('Занятое имя') && /ЗАПРЕЩЕНО/.test(r.light));
    t.ok('исходный текст уходит в промпт целиком', r.light.includes(FINAL));
    t.ok('средняя просит структурно другое', /СТРУКТУРНО ДРУГИМ/.test(r.mid));
    t.ok('средняя тоже не даёт выдумывать факты', /Факты .*НЕ менять/.test(r.mid));
    t.ok('без занятых названий блок запрета не появляется', !/ЗАПРЕЩЕНО \(дубль/.test(r.mid));
    t.ok('обе степени требуют 50 символов', /50 символов/.test(r.light) && /50 символов/.test(r.mid));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── doRotate: вызов, журнал, замок, запись без текста ────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, reply, fin]) => {
      const mk = eval(mkSrc);
      const out = {};
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); };
      window.__calls = [];
      window.callAI = async (messages, opts = {}) => {
        window.__calls.push({ text: messages[0].content, opts });
        return reply;
      };

      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];
      state.db = [mk({ id: 1, _uid: 'u1', finalDesc: fin, finalTitle: 'Мой заголовок' })];
      await doRotate(1, 'light');
      out.light = {
        calls: window.__calls.length,
        usedFinal: window.__calls[0].text.includes(fin),
        category: window.__calls[0].opts.category,
        title: state.rotResult.title, mode: state.rotResult.mode, recId: state.rotResult.recId,
        scan: !!state.rotResult.scan,
        gen: window.__jlog.find(x => x.ev === 'generated')?.data?.path,
        rot: window.__jlog.find(x => x.ev === 'rotate')?.data,
      };

      // Средняя степень — другой путь в журнале
      window.__jlog = []; window.__calls = [];
      await doRotate(1, 'mid');
      out.midPath = window.__jlog.find(x => x.ev === 'generated')?.data?.path;

      // Совпадение с названием соседнего аккаунта помечается, но не запрещается
      window.__calls = [];
      state.db.push(mk({ id: 2, _uid: 'u2', title: 'Прокрученный заголовок', account: 'a2' }));
      await doRotate(1, 'light');
      out.dupAcc = state.rotResult.dupAcc;

      // Запись без текста не должна стоить денег
      window.__calls = [];
      state.db.push(mk({ id: 3, _uid: 'u3', title: '', description: '' }));
      await doRotate(3, 'light');
      out.emptyCalls = window.__calls.length;

      // Ошибка вендора не роняет панель и не залипает замком
      window.callAI = async () => { throw new Error('Вендор недоступен'); };
      await doRotate(1, 'light');
      out.err = { error: !!state.rotResult.error, busy: state.rotBusy.size };

      window.jlog = origJ;
      return out;
    }, [REC, ROT_JSON, FINAL]);

    t.eq('ротация сходила к модели ровно один раз', r.light.calls, 1);
    t.ok('крутится именно финальный текст', r.light.usedFinal === true);
    t.eq('категория записи уехала в запрос', r.light.category, 'gaming_sub');
    t.eq('результат положен в state', r.light.title, 'Прокрученный заголовок');
    t.eq('и привязан к своей записи', r.light.recId, 1);
    t.ok('результат сразу проверен сканером', r.light.scan === true);
    t.eq('лёгкая пишется в журнал своим путём', r.light.gen, 'rotate');
    t.eq('средняя — своим', r.midPath, 'rotate_mid');
    t.ok('событие rotate несёт возраст и аккаунт', r.light.rot && r.light.rot.ageDays >= 0 && r.light.rot.account === 'a1');
    t.ok('и помечает, что крутили финал', r.light.rot.fromFinal === true);
    t.ok('совпадение с соседним аккаунтом помечено', r.dupAcc === true);
    t.eq('запись без текста не тратит генерацию', r.emptyCalls, 0);
    t.ok('ошибка показывается в панели', r.err.error === true);
    t.ok('и замок снимается', r.err.busy === 0);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Замок от двойного тапа ──────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, reply]) => {
      const mk = eval(mkSrc);
      window.__calls = 0;
      window.callAI = async () => { window.__calls++; await new Promise(res => setTimeout(res, 60)); return reply; };
      state.db = [mk()];
      const a = doRotate(1, 'light');
      const b = doRotate(1, 'light');   // нетерпеливый второй тап
      await Promise.all([a, b]);
      const first = window.__calls;
      // Разные степени друг друга не блокируют
      await Promise.all([doRotate(1, 'light'), doRotate(1, 'mid')]);
      return { first, total: window.__calls };
    }, [REC, ROT_JSON]);

    t.eq('двойной тап оплачивается один раз', r.first, 1);
    t.eq('лёгкая и средняя не блокируют друг друга', r.total, 3);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── «✓ Разместил»: новая запись, старая цела ────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, reply, fin]) => {
      const mk = eval(mkSrc);
      window.confirm = () => true;
      window.callAI = async () => reply;
      state.db = [mk({ id: 1, _uid: 'u1', finalDesc: fin, finalTitle: 'Мой заголовок', editShare: 0.4 })];
      state.tab = 'database'; render();
      await doRotate(1, 'light');
      // Светофор сканера — до размещения: после него панель очищается
      const badgeShown = !!document.querySelector('.scan-badge');
      document.querySelector('[data-act="db-rot-posted"]').click();

      const old = state.db.find(r => r._uid === 'u1');
      const fresh = state.db.find(r => r._uid !== 'u1');
      return {
        badgeShown, count: state.db.length,
        oldStatus: old.status, oldFinal: old.finalDesc, oldShare: old.editShare, oldTitle: old.finalTitle,
        freshTitle: fresh.title, freshDesc: fresh.description, freshStatus: fresh.status,
        freshFrom: fresh._rotFrom, freshUid: !!fresh._uid, freshAcc: fresh.account,
        freshProduct: fresh.product, freshRegion: fresh.region, freshCat: fresh._category,
      };
    }, [REC, ROT_JSON, FINAL]);

    t.ok('светофор сканера показан в панели', r.badgeShown === true);
    t.eq('появилась вторая запись, а не замена', r.count, 2);
    t.eq('прежняя переведена в «Снято»', r.oldStatus, 'removed');
    t.eq('её финал НЕ тронут', r.oldFinal, FINAL);
    t.eq('и доля правок тоже', r.oldShare, 0.4);
    t.eq('и финальный заголовок', r.oldTitle, 'Мой заголовок');
    t.eq('новая несёт прокрученный текст', r.freshTitle, 'Прокрученный заголовок');
    t.ok('и описание', /Прокрученное описание/.test(r.freshDesc));
    t.eq('новая активна', r.freshStatus, 'active');
    t.eq('и ссылается на предшественника', r.freshFrom, 'u1');
    t.ok('у новой свой постоянный _uid', r.freshUid === true);
    t.eq('аккаунт унаследован', r.freshAcc, 'a1');
    t.eq('товар унаследован', r.freshProduct, 'PS Plus Extra');
    t.eq('регион унаследован', r.freshRegion, 'Киров');
    t.eq('категория унаследована', r.freshCat, 'gaming_sub');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Учёт без генератора: ручная запись с текстом ─────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const out = {};
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];
      state.tab = 'database'; render();

      state.dbForm = { product: 'PS Plus Deluxe', region: 'Пермь', status: 'active', note: 'со второго',
                       account: 'a2', title: 'Ручной заголовок', desc: 'Ручное описание объявления, набранное без генератора.',
                       toRefs: true, postedAt: '2026-09-01' };
      document.querySelector('[data-act="db-add"]').click();
      const rec = state.db[0];
      out.rec = { product: rec.product, acc: rec.account, title: rec.title, desc: rec.description,
                  uid: !!rec._uid, posted: rotTsToInput(rec.postedAt) };
      out.refs = state.refs.length;
      out.refSource = state.refs[0]?.source;
      out.refDesc = state.refs[0]?.desc;
      out.formCleared = { title: state.dbForm.title, desc: state.dbForm.desc, acc: state.dbForm.account };

      // Тот же текст второй раз не двоит сырьё
      state.dbForm = { ...state.dbForm, product: 'PS Plus Deluxe', region: 'Омск',
                       title: 'Ручной заголовок', desc: 'Ручное описание объявления, набранное без генератора.', toRefs: true };
      document.querySelector('[data-act="db-add"]').click();
      out.refsAfter = state.refs.length;
      out.dbAfter = state.db.length;

      // Запись без текста остаётся простой строкой учёта
      state.dbForm = { product: 'EA Play', region: 'Уфа', status: 'active', note: '', account: 'a1',
                       title: '', desc: '', toRefs: true, postedAt: '' };
      document.querySelector('[data-act="db-add"]').click();
      const plain = state.db.find(r => r.product === 'EA Play');
      out.plain = { title: plain.title, refs: state.refs.length, acc: plain.account };

      // Правка: пустое поле текста не стирает уже сохранённое
      state.dbEditId = state.db[0].id;
      state.dbForm = { product: 'PS Plus Deluxe', region: 'Пермь', status: 'paused', note: '', account: 'a2',
                       title: '', desc: '', toRefs: false, postedAt: '' };
      renderDb();   // форма переключается в режим правки — кнопка становится db-save
      document.querySelector('[data-act="db-save"]').click();
      const kept = state.db[0];
      out.kept = { title: kept.title, status: kept.status };
      return out;
    });

    t.eq('ручная запись получила товар', r.rec.product, 'PS Plus Deluxe');
    t.eq('и второй аккаунт', r.rec.acc, 'a2');
    t.eq('и заголовок объявления', r.rec.title, 'Ручной заголовок');
    t.ok('и описание', /Ручное описание/.test(r.rec.desc));
    t.ok('и постоянный _uid', r.rec.uid === true);
    t.eq('дата публикации записана как указано', r.rec.posted, '2026-09-01');
    t.eq('текст ушёл в эталоны', r.refs, 1);
    t.eq('и помечен как свой голос', r.refSource, 'mine');
    t.ok('в эталон уехало описание целиком', /Ручное описание/.test(r.refDesc));
    t.ok('черновик текста очищен после добавления', !r.formCleared.title && !r.formCleared.desc);
    t.eq('а выбранный аккаунт запомнен', r.formCleared.acc, 'a2');
    t.eq('повтор того же текста не двоит эталоны', r.refsAfter, 1);
    t.eq('но вторая публикация в Истории учтена', r.dbAfter, 2);
    t.eq('запись без текста остаётся пустой строкой учёта', r.plain.title, undefined);
    t.eq('и ничего не кладёт в эталоны', r.plain.refs, 1);
    t.eq('аккаунт по умолчанию — выбранный в форме', r.plain.acc, 'a1');
    t.eq('пустое поле правки не стирает сохранённый текст', r.kept.title, 'Ручной заголовок');
    t.eq('а статус при этом меняется', r.kept.status, 'paused');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Аккаунты: миграция старых записей и защита от потери ─
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', {
      storage: {
        avito_db: [
          { id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров', status: 'active', note: '' },
          { id: 2, _uid: 'u2', product: 'EA Play', region: 'Пермь', status: 'active', note: '' },
        ],
      },
    });
    const r = await page.evaluate(() => {
      const out = {};
      out.migrated = state.db.every(r => r.account === 'a1');
      // Переименование аккаунта не перевешивает записи: id остаётся прежним
      state.settings.accounts = [{ id: 'a1', name: 'Рабочий' }];
      out.afterRename = state.db.every(r => accOf(r) === 'a1');
      out.nameShown = accName('a1');
      // Удалённый аккаунт не обезличивает записи
      state.settings.accounts = [{ id: 'a9', name: 'Другой' }];
      out.orphanKept = state.db[0].account;
      out.orphanLabel = accName(state.db[0].account);
      // Битый список настроек не должен ронять чтение
      state.settings.accounts = [];
      out.fallback = accFirstId();
      return out;
    });

    t.ok('записи до этой версии отнесены к первому аккаунту', r.migrated === true);
    t.ok('переименование аккаунта не трогает записи', r.afterRename === true);
    t.eq('новое имя показывается', r.nameShown, 'Рабочий');
    t.eq('удаление аккаунта не стирает метку у записи', r.orphanKept, 'a1');
    t.eq('но она честно помечена', r.orphanLabel, 'удалён');
    t.eq('пустой список аккаунтов не роняет чтение', r.fallback, 'a1');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Дата публикации: круговой ход через поле формы ──────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const ts = rotInputToTs('2026-03-08');
      const d = new Date(ts);
      return {
        back: rotTsToInput(ts),
        hour: d.getHours(),              // полдень: полночь при отрицательном поясе уехала бы на сутки
        day: d.getDate(), month: d.getMonth() + 1,
        empty: rotInputToTs(''), junk: rotInputToTs('08.03.2026'),
        emptyBack: rotTsToInput(0),
      };
    });

    t.eq('дата возвращается той же', r.back, '2026-03-08');
    t.eq('время полуденное', r.hour, 12);
    t.ok('день и месяц не съехали', r.day === 8 && r.month === 3);
    t.eq('пустое поле даёт ноль', r.empty, 0);
    t.eq('мусор не превращается в дату', r.junk, 0);
    t.eq('ноль обратно даёт пустую строку', r.emptyBack, '');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Интерфейс Истории: сводка, бейджи, фильтр ───────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(([mkSrc]) => {
      const mk = eval(mkSrc);
      const D = 86400000, now = Date.now();
      const out = {};
      state.settings.rotDays = 14;
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];
      state.db = [
        mk({ id: now - 30 * D, _uid: 'u1', region: 'Киров', account: 'a1' }),
        mk({ id: now - 2 * D,  _uid: 'u2', region: 'Пермь', account: 'a2' }),
      ];
      state.tab = 'database'; render();
      out.dueCard = !!document.querySelector('[data-act="db-show-due"]');
      out.dueText = document.body.innerText.includes('Пора обновить: 1');
      out.rows = document.querySelectorAll('tr[data-db-id]').length;
      out.accCol = document.body.innerText.includes('Второй');

      // Фильтр «только пора обновить»
      document.querySelector('[data-act="db-show-due"]').click();
      out.filtered = document.querySelectorAll('tr[data-db-id]').length;
      out.filteredIsOld = document.body.innerText.includes('Киров') && !document.body.innerText.includes('Пермь');

      // Панель ротации открывается и закрывается по той же кнопке
      state.dbFilter.due = false; renderDb();
      document.querySelector('tr[data-db-id] [data-act="db-rot-panel"]').click();
      out.panelOpen = !!document.querySelector('[data-act="db-rotate"]');
      document.querySelector('[data-act="db-rot-close"]').click();
      out.panelClosed = !document.querySelector('[data-act="db-rotate"]');

      // Один аккаунт — колонки и фильтра по аккаунтам нет, лишнего в интерфейсе не появляется
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }];
      render();
      out.noAccCol = !document.getElementById('db-filter-account');
      return out;
    }, [REC]);

    t.ok('сводка «пора обновить» показана', r.dueCard === true);
    t.ok('и считает только просроченные', r.dueText === true);
    t.eq('в таблице обе записи', r.rows, 2);
    t.ok('колонка аккаунта появилась при двух профилях', r.accCol === true);
    t.eq('фильтр оставляет только просроченное', r.filtered, 1);
    t.ok('и это именно старая запись', r.filteredIsOld === true);
    t.ok('панель ротации открывается', r.panelOpen === true);
    t.ok('и закрывается', r.panelClosed === true);
    t.ok('при одном аккаунте фильтр по аккаунтам не рисуется', r.noAccCol === true);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Находки код-ревью этой правки ───────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, reply]) => {
      const mk = eval(mkSrc);
      const out = {};

      // №1: список из битых записей (импорт настроек, правка хранилища руками)
      // раньше давал пустой массив — и accFirstId() ронял «✓ Размещено».
      state.settings.accounts = [{ name: 'без id' }, null];
      out.brokenList = accFirstId();
      out.brokenName = accName('a1');
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];

      // №9: удалённый аккаунт не должен уезжать в запись — форма показывает первый
      state.dbForm = { product: 'EA Play', region: 'Уфа', status: 'active', note: '',
                       account: 'a9', title: '', desc: '', toRefs: false, postedAt: '', refCat: '' };
      state.tab = 'database'; render();
      document.querySelector('[data-act="db-add"]').click();
      out.deadAcc = state.db[0].account;
      out.activeAcc = accActive();

      // №4: заглянуть в соседнюю запись — не потерять оплаченный результат
      window.callAI = async () => reply;
      state.db = [mk({ id: 1, _uid: 'u1' }), mk({ id: 2, _uid: 'u2', region: 'Пермь' })];
      renderDb();
      await doRotate(1, 'light');
      document.querySelector('tr[data-db-id="2"] [data-act="db-rot-panel"]').click();
      out.afterPeek = { kept: !!state.rotResult, shownAtOther: !!document.querySelector('[data-act="db-rot-posted"]') };
      document.querySelector('tr[data-db-id="1"] [data-act="db-rot-panel"]').click();
      out.backToOwn = !!document.querySelector('[data-act="db-rot-posted"]');

      // №6: копия из панели ротации уходит в журнал с атрибуцией
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, chain, data }); };
      jCopied(document.querySelector('[data-act="copy"][data-jrot]'));
      window.jlog = origJ;
      const cp = window.__jlog.find(x => x.ev === 'copied');
      out.copied = { product: cp?.data?.product, category: cp?.data?.category,
                     title: cp?.data?.title, from: cp?.data?.fromRotate, scan: cp?.data?.scan };
      return out;
    }, [REC, ROT_JSON]);

    t.eq('битый список аккаунтов не роняет чтение', r.brokenList, 'a1');
    t.eq('и не обезличивает записи', r.brokenName, 'Основной');
    t.eq('удалённый аккаунт в форме заменяется первым', r.deadAcc, 'a1');
    t.eq('accActive тоже не отдаёт мёртвый id', r.activeAcc, 'a1');
    t.ok('оплаченный результат переживает переход к соседней записи', r.afterPeek.kept === true);
    t.ok('но в чужой строке не показывается', r.afterPeek.shownAtOther === false);
    t.ok('и возвращается вместе со своей', r.backToOwn === true);
    t.eq('копия из ротации знает товар', r.copied.product, 'PS Plus Extra');
    t.eq('и категорию', r.copied.category, 'gaming_sub');
    t.eq('и сам текст', r.copied.title, 'Прокрученный заголовок');
    t.eq('и помечена степенью ротации', r.copied.from, 'light');
    t.ok('и несёт вердикт сканера', r.copied.scan !== null && r.copied.scan !== undefined);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Находки ревью: сохранность при правке и синхронизации ─
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, fin]) => {
      const mk = eval(mkSrc);
      const out = {};
      state.tab = 'database'; render();

      // №5: очистка ОДНОГО описания не должна стирать сохранённый текст —
      // с ним ушла бы база, от которой считается доля правок финала.
      state.db = [mk({ id: 1, _uid: 'u1', title: 'Заголовок', description: 'Описание записи',
                       finalDesc: fin, editShare: 0.3 })];
      renderDb();
      state.dbEditId = 1;
      state.dbForm = { product: 'PS Plus Extra', region: 'Киров', status: 'active', note: '',
                       account: 'a1', title: 'Новый заголовок', desc: '', toRefs: false, postedAt: '', refCat: '' };
      renderDb();
      document.querySelector('[data-act="db-save"]').click();
      out.clearedDesc = { title: state.db[0].title, desc: state.db[0].description, final: state.db[0].finalDesc };

      // №3: снятая галочка «не ротировать» пишется как false, а не удаляется —
      // иначе входящее true с соседнего устройства воскресило бы её.
      state.db = [mk({ id: 2, _uid: 'u2', rotOff: true, rotDays: 21 })];
      state.rotPanel = 2; renderDb();
      const off = document.querySelector('[data-rot-off="2"]');
      off.checked = false; off.dispatchEvent(new Event('change'));
      const days = document.querySelector('[data-rot-days="2"]');
      days.value = ''; days.dispatchEvent(new Event('change'));
      out.cleared = { rotOff: state.db[0].rotOff, rotDays: state.db[0].rotDays,
                      offIsFalse: state.db[0].rotOff === false, daysIsZero: state.db[0].rotDays === 0 };

      // №10: переименование аккаунта не должно править заводскую константу
      state.settings.accounts[0].name = 'Переименованный';
      out.defUntouched = DEF_SETTINGS.accounts[0].name;
      return out;
    }, [REC, FINAL]);

    t.eq('очистка описания не стирает сохранённый текст', r.clearedDesc.desc, 'Описание записи');
    t.eq('а заполненный заголовок обновляется', r.clearedDesc.title, 'Новый заголовок');
    t.eq('финал не тронут', r.clearedDesc.final, FINAL);
    t.ok('снятый выключатель ротации хранится как false', r.cleared.offIsFalse === true);
    t.ok('очищенный срок хранится нулём, а не отсутствием', r.cleared.daysIsZero === true);
    t.eq('заводской список аккаунтов не правится по месту', r.defUntouched, 'Основной');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Находка ревью №2: аккаунт расходится между устройствами ─
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', {
      storage: {
        // Запись заведена до этой версии: аккаунт ей проставит миграция
        avito_db: [{ id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров',
                     title: 'Заголовок', description: 'Описание', status: 'active', note: '' }],
        avito_admin_token: 'test-token',
      },
    });
    const r = await page.evaluate(async () => {
      const out = {};
      out.auto = { account: state.db[0].account, marked: state.db[0]._accAuto === true };

      // С другого устройства приходит та же запись, но с ЯВНО выбранным аккаунтом
      window.fetch = async (url, opts = {}) => {
        if ((opts.method || 'GET') !== 'GET') return { ok: true, status: 200, json: async () => ({ ok: true }) };
        const doc = String(url).split('/api/avito-sync/')[1] || '?';
        if (doc !== 'voice') return { ok: true, status: 200, json: async () => ({ ok: true, empty: true }) };
        return { ok: true, status: 200, json: async () => ({
          ok: true, updated: new Date().toISOString(), device: 'phone',
          data: { db: [{ id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров',
                         title: 'Заголовок', description: 'Описание', status: 'active', note: '',
                         account: 'a2', postedAt: 1757000000000 }], refs: [], favorites: [] },
        }) };
      };
      state.settings.accounts = [{ id: 'a1', name: 'Первый' }, { id: 'a2', name: 'Второй' }];
      await syncPullVoice();
      out.afterPull = { account: state.db[0].account, marked: state.db[0]._accAuto,
                        posted: state.db[0].postedAt, count: state.db.length };

      // Обратно: свой явный выбор входящее «авто» не перебивает
      state.db[0].account = 'a1'; delete state.db[0]._accAuto;
      await syncPullVoice();
      out.explicitKept = state.db[0].account;
      return out;
    });

    t.eq('миграция проставила первый аккаунт', r.auto.account, 'a1');
    t.ok('и пометила его как автоматический', r.auto.marked === true);
    t.eq('явный выбор с другого устройства доезжает', r.afterPull.account, 'a2');
    t.ok('метка автопростановки при этом снимается', !r.afterPull.marked);
    t.eq('дата публикации тоже подтягивается', r.afterPull.posted, 1757000000000);
    t.eq('запись не раздвоилась', r.afterPull.count, 1);
    t.eq('свой явный выбор входящим не перебивается', r.explicitKept, 'a1');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Категория эталона задаётся человеком ────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const out = {};
      state.form.category = 'gaming_sub';     // генератор стоит на подписках
      state.tab = 'database'; render();
      // …а вносим объявление физтовара со второго аккаунта
      state.dbForm = { product: 'DualSense', region: 'Омск', status: 'active', note: '', account: 'a1',
                       title: 'Геймпад с коробкой', desc: 'Описание геймпада, набранное руками.',
                       toRefs: true, postedAt: '', refCat: 'phys' };
      document.querySelector('[data-act="db-add"]').click();
      out.refCat = state.refs[0]?.category;

      // Селект в форме есть и по умолчанию показывает категорию генератора
      out.hasSelect = !!document.getElementById('db-f-refcat');
      return out;
    });

    t.eq('эталон уходит в выбранную категорию, а не в текущую форму генератора', r.refCat, 'phys');
    t.ok('селект категории эталона есть в форме', r.hasSelect === true);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Сохранность: ротация и удаление записи ──────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([mkSrc, reply, fin]) => {
      const mk = eval(mkSrc);
      const out = {};
      window.callAI = async () => reply;
      state.db = [mk({ id: 1, _uid: 'u1', finalDesc: fin })];
      state.tab = 'database'; render();
      await doRotate(1, 'light');

      // Отказ от подтверждения не должен ничего менять
      window.confirm = () => false;
      document.querySelector('[data-act="db-rot-posted"]').click();
      out.declined = { count: state.db.length, status: state.db[0].status };

      // Удаление записи закрывает её панель, чтобы результат не привязался к чужой строке
      window.confirm = () => true;
      state.rotPanel = 1;
      document.querySelector('tr[data-db-id="1"] [data-act="db-del"]').click();
      out.afterDel = { panel: state.rotPanel, result: state.rotResult, db: state.db.length };
      out.inTrash = syncTrash().some(x => x.rec && x.rec.finalDesc === fin);
      return out;
    }, [REC, ROT_JSON, FINAL]);

    t.eq('отказ от подтверждения не заводит запись', r.declined.count, 1);
    t.eq('и не снимает прежнюю', r.declined.status, 'active');
    t.ok('удаление записи закрывает её панель ротации', r.afterDel.panel === null);
    t.ok('и убирает чужой результат', r.afterDel.result === null);
    t.eq('запись удалена', r.afterDel.db, 0);
    t.ok('но её финал лёг в корзину', r.inTrash === true);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }
}
