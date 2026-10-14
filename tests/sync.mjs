// Секция sync — синхронизация с сервером (сессия 2026-09-11).
// Сырьё невосполнимо, поэтому проверяем не «работает ли», а «не теряет ли»:
// пустой клиент не стирает сервер, битый ответ не трогает локальное, удалённое
// не возвращается и не участвует в генерации, настройки не заменяются молча.
import { openApp } from './lib.mjs';

// Заглушка сети ставится внутри страницы: сервер отвечает из window.__srv
const stubNet = page => page.evaluate(() => {
  window.__srv = {};          // документы «на сервере»
  window.__calls = [];
  window.__fail = null;       // 'http' | 'throw' | null
  localStorage.setItem('avito_admin_token', 'test-token');
  window.fetch = async (url, opts = {}) => {
    const doc = String(url).split('/api/avito-sync/')[1] || '?';
    window.__calls.push({ doc, method: opts.method || 'GET' });
    if (window.__fail === 'throw') throw new Error('сеть недоступна');
    if (window.__fail === 'http') return { ok: false, status: 500, json: async () => ({}) };
    if ((opts.method || 'GET') === 'GET') {
      const d = window.__srv[doc];
      return { ok: true, status: 200, json: async () => (d ? { ok: true, ...d } : { ok: true, empty: true }) };
    }
    const body = JSON.parse(opts.body);
    (window.__bodies = window.__bodies || []).push({ doc, body });
    window.__srv[doc] = { updated: new Date().toISOString(), device: body.device, data: body.data };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
});

const REF_A = { id: 1, source: 'mine', category: 'phys', title: 'A', desc: 'ТЕКСТ А' };
const REF_B = { id: 2, source: 'mine', category: 'phys', title: 'B', desc: 'ТЕКСТ Б' };

export async function runSync(browser, base, t) {
  t.section('sync — синхронизация сырья с сервером');

  // ── Отправка: подпись документа отсекает лишние запросы ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a, b]) => {
      state.refs = [a];
      state.settings.pageName = 'Своя страница';  // иначе заводские настройки не отправляются
      save();
      await syncPush(true);
      const first = window.__srv.voice?.data?.refs?.length;
      const callsAfterFirst = window.__calls.filter(c => c.method === 'POST').length;
      await syncPush();                       // ничего не менялось
      const callsNoChange = window.__calls.filter(c => c.method === 'POST').length;
      state.refs = [a, b]; save();
      await syncPush();                       // изменилось — должно уйти
      return {
        first, callsAfterFirst, callsNoChange,
        callsAfterChange: window.__calls.filter(c => c.method === 'POST').length,
        onServer: window.__srv.voice.data.refs.length,
        docs: Object.keys(window.__srv).sort(),
      };
    }, [REF_A, REF_B]);
    t.eq('сырьё уехало на сервер', r.first, 1);
    t.eq('без изменений повторный запрос не уходит', r.callsNoChange, r.callsAfterFirst);
    t.ok('после изменения уходит', r.callsAfterChange > r.callsNoChange, JSON.stringify(r));
    t.eq('на сервере оба эталона', r.onServer, 2);
    t.eq('документа два — сырьё и настройки', r.docs.join(','), 'settings,voice');
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Пустой клиент НЕ стирает сырьё на сервере ───────────
  // Так выглядит первый запуск в новом браузере до того, как он успел забрать данные
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'pc', data: { refs: [a], favorites: [], db: [] } };
      state.refs = []; state.favorites = []; state.db = []; save();
      await syncPush(true);
      const empties = (window.__bodies || []).filter(b => b.doc === 'voice')
        .filter(b => !b.body.data.refs.length && !b.body.data.favorites.length && !b.body.data.db.length).length;
      return { onServer: window.__srv.voice.data.refs.length, local: state.refs.length, empties,
               firstCall: window.__calls.find(c => c.doc === 'voice')?.method };
    }, [REF_A]);
    t.eq('сырьё на сервере цело', r.onServer, 1);
    t.eq('пустой документ voice не отправлялся ни разу', r.empties, 0);
    // С F21 отправка сначала забирает серверное и шлёт объединение, а не пустоту
    t.eq('пустой клиент сначала забрал сервер (первый запрос — GET)', r.firstCall, 'GET');
    t.eq('эталон с сервера появился локально', r.local, 1);
    await ctx.close();
  }

  // ── Получение и слияние ─────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a, b]) => {
      state.refs = [a]; save();
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone', data: {
        refs: [a, b],   // один общий, один новый
        favorites: [{ _fid: 1, title: 'Ф', description: 'ИЗБРАННОЕ С СЕРВЕРА' }],
        db: [{ id: 5, product: 'PS5', region: 'М', title: 'Т', description: 'Д', date: '01.09.2026' }],
      } };
      const res = await syncPullVoice();
      return {
        added: res?.added, refs: state.refs.length,
        titles: state.refs.map(x => x.title).sort().join(','),
        favs: state.favorites.length, db: state.db.length,
        persisted: JSON.parse(localStorage.getItem('avito_refs')).length,
      };
    }, [REF_A, REF_B]);
    t.eq('дубль не задвоился, новый добавлен', r.refs, 2);
    t.eq('именно те эталоны', r.titles, 'A,B');
    t.eq('избранное приехало', r.favs, 1);
    t.eq('История приехала', r.db, 1);
    t.eq('и всё это сохранено на диск', r.persisted, 2);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Удаление: не возвращается, но и не теряется ─────────
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a, b]) => {
      state.refs = [a, b]; save();
      state.tab = 'database'; render();
      window.confirm = () => true;
      document.querySelector('[data-act="ref-del"][data-id="1"]')?.click();
      const afterDel = state.refs.map(x => x.title);
      const trash = JSON.parse(localStorage.getItem('avito_trash') || '[]');
      // Сервер всё ещё держит старую версию с удалённым эталоном
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone', data: { refs: [a, b], favorites: [], db: [] } };
      await syncPullVoice();
      return {
        afterDel, afterPull: state.refs.map(x => x.title),
        trashKeeps: trash.length, trashText: trash[0]?.rec?.desc || '',
        tombs: JSON.parse(localStorage.getItem('avito_deleted') || '[]').length,
      };
    }, [REF_A, REF_B]);
    t.eq('после удаления остался один', r.afterDel.join(','), 'B');
    t.eq('удалённое НЕ вернулось с сервера', r.afterPull.join(','), 'B');
    t.eq('ключ удалённого записан', r.tombs, 1);
    t.eq('но сам текст сохранён в корзине', r.trashKeeps, 1);
    t.eq('и он не потерян', r.trashText, 'ТЕКСТ А');
    await ctx.close();
  }

  // ── Корзина не участвует в генерации ────────────────────
  // Прямое требование владельца: удалённое сырьё в промпт попадать не должно
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a, b]) => {
      state.refs = [a, b]; state.favorites = []; state.db = []; save();
      state.tab = 'database'; render();
      window.confirm = () => true;
      document.querySelector('[data-act="ref-del"][data-id="1"]')?.click();
      const f = { ...DEF_FORM, category: 'phys', physName: 'A' };
      const blocks = Array.from({ length: 10 }, () => fewShotBlock(f)).join('\n');
      return { inPrompt: blocks.includes('ТЕКСТ А'), other: blocks.includes('ТЕКСТ Б'),
        trash: JSON.parse(localStorage.getItem('avito_trash') || '[]').length };
    }, [REF_A, REF_B]);
    t.ok('удалённый эталон в промпт не попадает', !r.inPrompt, 'текст из корзины уехал в генерацию');
    t.ok('а оставшийся попадает', r.other);
    t.eq('при этом он лежит в корзине', r.trash, 1);
    await ctx.close();
  }

  // ── Сбои сети не трогают локальное ──────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      const out = {};
      window.__fail = 'http';
      out.pullHttp = await syncPullVoice();
      out.afterHttp = state.refs.length;
      window.__fail = 'throw';
      out.pullThrow = await syncPullVoice();
      out.afterThrow = state.refs.length;
      await syncPush(true);                       // не должно бросить наружу
      window.__fail = null;
      // Пустой ответ сервера тоже не имеет права стирать локальное
      window.__srv = {};
      await syncPullVoice();
      out.afterEmpty = state.refs.length;
      // И битый документ
      window.__srv.voice = { ok: true, empty: true, corrupt: true };
      await syncPullVoice();
      out.afterCorrupt = state.refs.length;
      return out;
    }, [REF_A]);
    t.eq('ошибка 5xx не тронула сырьё', r.afterHttp, 1);
    t.eq('брошенное исключение тоже', r.afterThrow, 1);
    t.eq('пустой сервер не стирает локальное', r.afterEmpty, 1);
    t.eq('битый документ тоже', r.afterCorrupt, 1);
    t.ok('в консоль ничего не улетело', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Без токена и при выключенном тумблере — тишина ──────
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      localStorage.removeItem('avito_admin_token');
      window.__calls = [];
      await syncPush(true); await syncPullVoice();
      const noToken = window.__calls.length;
      localStorage.setItem('avito_admin_token', 'test-token');
      localStorage.setItem('avito_sync_off', '1');
      window.__calls = [];
      await syncPush(true); await syncPullVoice();
      return { noToken, off: window.__calls.length };
    }, [REF_A]);
    t.eq('без токена запросов нет', r.noToken, 0);
    t.eq('с выключенным тумблером тоже', r.off, 0);
    await ctx.close();
  }

  // ── Настройки: уезжают сами, возвращаются только по кнопке ──
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      state.settings.pageName = 'ЛОКАЛЬНАЯ'; state.catsCfg = { builtin: {}, custom: [] }; save();
      await syncPush(true);
      const onServer = window.__srv.settings?.data?.settings?.pageName;
      // На сервере появилась чужая версия — сама она применяться НЕ должна
      window.__srv.settings = { updated: '2026-09-11T12:00:00Z', device: 'phone', data: {
        settings: { pageName: 'СЕРВЕРНАЯ' }, cats: { builtin: {}, custom: [{ id: 'x', label: 'Чужая', fields: [] }] },
      } };
      await syncPullVoice();                       // старт синхронизирует только сырьё
      const afterStart = state.settings.pageName;
      window.confirm = () => false;                // человек отказался
      await syncPullSettings();
      const afterDecline = state.settings.pageName;
      window.confirm = () => true;                 // человек согласился
      await syncPullSettings();
      return { onServer, afterStart, afterDecline, afterAccept: state.settings.pageName,
        customCats: state.catsCfg.custom.length };
    });
    t.eq('настройки уехали на сервер', r.onServer, 'ЛОКАЛЬНАЯ');
    t.eq('при старте серверные настройки НЕ применяются', r.afterStart, 'ЛОКАЛЬНАЯ');
    t.eq('отказ ничего не меняет', r.afterDecline, 'ЛОКАЛЬНАЯ');
    t.eq('согласие применяет серверные', r.afterAccept, 'СЕРВЕРНАЯ');
    t.eq('и категории тоже', r.customCats, 1);
    await ctx.close();
  }

  // ── Находки код-ревью синхронизации ─────────────────────
  // 1. Объединённый набор ОБЯЗАН уехать обратно: после слияния локальное богаче
  //    серверного, и без этого записи, заведённые только здесь, остались бы на
  //    одном устройстве навсегда.
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a, b]) => {
      state.refs = [b]; save();                      // локально только B
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone', data: { refs: [a], favorites: [], db: [] } };
      await syncPullVoice();
      await new Promise(res => setTimeout(res, 60)); // отправка идёт следом
      return {
        local: state.refs.map(x => x.title).sort().join(','),
        onServer: (window.__srv.voice.data.refs || []).map(x => x.title).sort().join(','),
      };
    }, [REF_A, REF_B]);
    t.eq('после слияния локально оба', r.local, 'A,B');
    t.eq('и на сервер уехало объединение, а не половина', r.onServer, 'A,B');
    await ctx.close();
  }

  // 2. Повторно заведённая запись не должна исчезать от старой метки удаления
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      state.tab = 'database'; render();
      window.confirm = () => true;
      document.querySelector('[data-act="ref-del"][data-id="1"]')?.click();
      const afterDel = state.refs.length;
      // Завели заново тот же текст — id новый, то есть позже удаления
      state.refs.push({ ...a, id: Date.now() + 1000 });
      save();
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone',
        data: { refs: [], favorites: [], db: [], deleted: JSON.parse(localStorage.getItem('avito_deleted') || '[]') } };
      await syncPullVoice();
      return { afterDel, afterPull: state.refs.length,
        tombs: JSON.parse(localStorage.getItem('avito_deleted') || '[]').length };
    }, [REF_A]);
    t.eq('после удаления пусто', r.afterDel, 0);
    t.eq('заведённый заново эталон пережил синхронизацию', r.afterPull, 1);
    t.eq('и метка удаления снята', r.tombs, 0);
    await ctx.close();
  }

  // 3. Финал догоняет уже известную запись Истории — ключ от него не меняется
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      const rec = { id: 5, product: 'PS5', region: 'М', title: 'Т', description: 'Бот-версия', date: '01.09.2026' };
      state.db = [rec]; state.refs = []; save();
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone', data: {
        refs: [], favorites: [],
        db: [{ ...rec, finalTitle: 'Рука', finalDesc: 'ФИНАЛ С ТЕЛЕФОНА', editShare: 0.4, _category: 'phys' }],
      } };
      const res = await syncPullVoice();
      return { n: state.db.length, final: state.db[0].finalDesc, share: state.db[0].editShare,
        cat: state.db[0]._category, reported: res?.finals };
    });
    t.eq('запись не задвоилась', r.n, 1);
    t.eq('финал догнал существующую запись', r.final, 'ФИНАЛ С ТЕЛЕФОНА');
    t.eq('вместе с долей правок', r.share, 0.4);
    t.eq('и категорией — без неё финал не попал бы в примеры', r.cat, 'phys');
    t.eq('слияние это заметило', r.reported, 1);
    await ctx.close();
  }

  // 4. Переключение голоса не должно плодить копии на других устройствах
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [{ ...a, source: 'other' }]; save();
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone',
        data: { refs: [{ ...a, source: 'mine' }], favorites: [], db: [] } };  // там метку уже переключили
      await syncPullVoice();
      return { n: state.refs.length, sources: state.refs.map(x => x.source).join(',') };
    }, [REF_A]);
    t.eq('копия не появилась', r.n, 1);
    t.ok('метка голоса в ключ не входит', !r.sources.includes(','), r.sources);
    await ctx.close();
  }

  // 5. Пустой браузер не стирает настройки на сервере
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      window.__srv.settings = { updated: '2026-09-11T09:00:00Z', device: 'pc', data: {
        cats: { builtin: {}, custom: [{ id: 'my', label: 'Моя', fields: [] }] },
        settings: { pageName: 'НАСТОЯЩАЯ' }, presets: [], queue: [], catalogs: {}, cv: null,
      } };
      // Чистый браузер: своих категорий нет, пресетов нет, очередь пуста
      state.catsCfg = { builtin: {}, custom: [] }; state.presets = []; state.postQueue = [];
      state.catalogs = {}; state.settings = { ...DEF_SETTINGS };
      localStorage.removeItem('avito_cv');
      save();
      await syncPush(true);
      return { custom: window.__srv.settings.data.cats.custom.length, name: window.__srv.settings.data.settings.pageName };
    });
    t.eq('своя категория на сервере цела', r.custom, 1);
    t.eq('и настройки тоже', r.name, 'НАСТОЯЩАЯ');
    await ctx.close();
  }

  // 6. Кнопка «↑ Отправить сейчас» не должна врать про сохранность
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      const ok = await syncPush(true);
      window.__fail = 'throw';
      const offline = await syncPush(true);
      window.__fail = null;
      localStorage.setItem('avito_sync_off', '1');
      const disabled = await syncPush(true);
      localStorage.removeItem('avito_sync_off');
      return { ok, offline, disabled };
    }, [REF_A]);
    t.eq('успешная отправка сообщает об успехе', r.ok, true);
    t.eq('офлайн честно сообщает о неудаче', r.offline, false);
    t.eq('выключенная синхронизация тоже', r.disabled, false);
    await ctx.close();
  }

  // 7. Возврат из корзины через интерфейс — иначе обещание в подтверждении пустое
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      state.tab = 'database'; render();
      window.confirm = () => true;
      document.querySelector('[data-act="ref-del"][data-id="1"]')?.click();
      state.tab = 'settings'; render();
      const btn = document.querySelector('[data-act="trash-restore"]');
      const hadBtn = !!btn;
      btn?.click();
      await new Promise(res => setTimeout(res, 30));
      // И после возврата синхронизация не должна его снова убить
      window.__srv.voice = { updated: '2026-09-11T10:00:00Z', device: 'phone',
        data: { refs: [], favorites: [], db: [], deleted: JSON.parse(localStorage.getItem('avito_deleted') || '[]') } };
      await syncPullVoice();
      return { hadBtn, refs: state.refs.length, text: state.refs[0]?.desc,
        trash: syncTrash().length };
    }, [REF_A]);
    t.ok('кнопка возврата есть в Настройках', r.hadBtn);
    t.eq('эталон вернулся', r.refs, 1);
    t.eq('с тем же текстом', r.text, 'ТЕКСТ А');
    t.eq('и убран из корзины', r.trash, 0);
    await ctx.close();
  }

  // 8. Подпись документа ловит правку той же длины
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      const a = { refs: [{ id: 1, title: 'Аб', desc: 'Текст' }] };
      const b = { refs: [{ id: 1, title: 'Ба', desc: 'Текст' }] };
      return { same: syncStamp(a) === syncStamp(a), diff: syncStamp(a) !== syncStamp(b) };
    });
    t.ok('одинаковые документы дают одну подпись', r.same);
    t.ok('перестановка символов подпись меняет', r.diff, 'подпись не заметила правку той же длины');
    await ctx.close();
  }

  // 9. Правка во время отправки не теряется
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([a]) => {
      state.refs = [a]; save();
      window.__busyCalls = 0;
      // Пока «идёт отправка», второй вызов обязан перевзвести таймер, а не выйти молча
      _syncBusy = true;
      const during = await syncPush(true);
      _syncBusy = false;
      const armed = !!_syncT;
      return { during, armed };
    }, [REF_A]);
    t.eq('во время отправки повторный запрос не уходит', r.during, false);
    t.ok('но отправка перевзведена, а не потеряна', r.armed);
    await ctx.close();
  }

  // 10. Корзина ограничена байтами: она уезжает в каждой отправке и делит квоту
  //     localStorage с живыми данными продавца
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 400; i++) {
        syncTrashSave([...syncTrash(), { key: 'k' + i, kind: 'ref', at: '2026-09-11', rec: { id: i, title: 'T' + i, desc: 'x'.repeat(1800) } }]);
      }
      return { bytes: (localStorage.getItem('avito_trash') || '').length, n: syncTrash().length };
    });
    t.ok('корзина не разрастается без предела', r.bytes <= 210000, `${r.bytes} байт, записей ${r.n}`);
    t.ok('но она не пуста', r.n > 0, JSON.stringify(r));
    await ctx.close();
  }

  // ── Карточка в Настройках ───────────────────────────────
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async () => {
      state.tab = 'settings'; render();
      const has = id => !!document.getElementById(id);
      const before = syncEnabled();
      document.getElementById('sync-toggle')?.click();
      const after = syncEnabled();
      document.getElementById('sync-toggle')?.click();
      return { toggle: has('sync-toggle'), now: has('sync-now'), pull: has('sync-pull-settings'),
        status: (document.getElementById('sync-status')?.textContent || '').length > 0,
        before, after, back: syncEnabled() };
    });
    t.ok('тумблер на месте', r.toggle);
    t.ok('кнопка отправки на месте', r.now);
    t.ok('кнопка возврата настроек на месте', r.pull);
    t.ok('статус показывается', r.status);
    t.ok('тумблер переключается', r.before !== r.after && r.back === r.before, JSON.stringify(r));
    await ctx.close();
  }

  // ── F21: сервер не затирается устройством, которое ничего не забрало ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    // Тела POST и подмена ответа 409 — поверх общей заглушки
    await page.evaluate(() => {
      const inner = window.fetch;
      window.__posts = []; window.__conflictOnce = false;
      window.fetch = async (url, opts = {}) => {
        if (opts.method === 'POST' && String(url).includes('/voice')) {
          window.__posts.push(JSON.parse(opts.body));
          if (window.__conflictOnce || window.__conflictAlways) {
            window.__conflictOnce = false; window.__calls.push({ doc: 'voice', method: 'POST' });
            return { ok: false, status: 409, json: async () => ({ error: 'conflict', updated: 'X', reason: 'stale' }) };
          }
        }
        return inner(url, opts);
      };
    });
    const FAV = { _fid: 77, title: 'Одно избранное', description: 'Текст' };
    const SRV = (refs) => ({ updated: '2026-10-15T10:00:00.000Z', device: 'phone', data: { refs, favorites: [], db: [] } });

    // 1. Новый браузер: забрать не вышло (сеть) — сырьё не отправляется вовсе
    const r1 = await page.evaluate(async ([fav, srv]) => {
      _voicePullAt = 0;
      window.__srv.voice = srv;
      state.refs = []; state.db = []; state.favorites = [fav]; save();
      window.__fail = 'throw';
      const sent = await syncPush(true);
      window.__fail = null;
      return { sent, posts: window.__posts.length, onServer: window.__srv.voice.data.refs.length };
    }, [FAV, SRV([REF_A, REF_B])]);
    t.ok('F21: забрать не вышло — voice не отправлен, сервер цел', r1.posts === 0 && r1.onServer === 2, JSON.stringify(r1));

    // 2. Сеть есть: отправка сначала забирает и шлёт объединение, а не одно избранное
    const r2 = await page.evaluate(async () => {
      window.__calls = [];
      await syncPush(true);
      const v = window.__srv.voice.data;
      return { first: window.__calls[0], refs: v.refs.length, favs: v.favorites.length, base: window.__posts[window.__posts.length - 1]?.base };
    });
    t.ok('F21: первый запрос отправки — GET', r2.first && r2.first.doc === 'voice' && r2.first.method === 'GET', JSON.stringify(r2.first));
    t.ok('F21: на сервере и 2 эталона, и новое избранное', r2.refs === 2 && r2.favs === 1, JSON.stringify(r2));
    t.eq('F21: в отправке — версия сервера, поверх которой слито (base)', r2.base, '2026-10-15T10:00:00.000Z');

    // 3. Свежее забирание (< 2 мин) — лишнего GET нет
    const r3 = await page.evaluate(async () => {
      window.__calls = [];
      state.favorites = [...state.favorites, { _fid: 78, title: 'Ещё', description: 'Т' }]; save();
      await syncPush();
      return window.__calls.filter(c => c.doc === 'voice').map(c => c.method).join(',');
    });
    t.eq('F21: в окне свежести отправка без повторного GET', r3, 'POST');

    // 4. Вкладка, пролежавшая неделю: с телефона пришёл эталон — не затирается
    const r4 = await page.evaluate(async (c) => {
      const v = window.__srv.voice;
      v.data = { ...v.data, refs: [...v.data.refs, c] }; v.updated = '2026-10-22T10:00:00.000Z';
      _voicePullAt = Date.now() - 3 * 60 * 1000;     // окно свежести истекло
      state.favorites = [...state.favorites, { _fid: 79, title: 'Старая вкладка', description: 'Т' }]; save();
      await syncPush();
      return { refs: window.__srv.voice.data.refs.map(r => r.title), local: state.refs.length };
    }, { id: 3, source: 'mine', category: 'phys', title: 'С телефона', desc: 'ТЕКСТ В' });
    t.ok('F21: эталон с телефона остался на сервере и пришёл во вкладку', r4.refs.includes('С телефона') && r4.local === 3, JSON.stringify(r4));

    // 5. 409 — сервер новее: не считаем отправленным, следующая отправка заберёт заново
    const r5 = await page.evaluate(async () => {
      window.__conflictOnce = true;
      const before = syncMeta().voiceStamp;
      state.favorites = [...state.favorites, { _fid: 80, title: 'Конфликт', description: 'Т' }]; save();
      const sent = await syncPush();
      return { sent, pullAt: _voicePullAt, stampKept: syncMeta().voiceStamp === before };
    });
    t.ok('F21: 409 — отправка не засчитана, окно свежести сброшено', r5.sent === false && r5.pullAt === 0 && r5.stampKept, JSON.stringify(r5));
    const r5b = await page.evaluate(async () => {
      window.__calls = [];
      await syncPush();
      return { methods: window.__calls.filter(c => c.doc === 'voice').map(c => c.method).join(','), has: window.__srv.voice.data.favorites.some(f => f.title === 'Конфликт') };
    });
    t.ok('F21: после 409 — GET, затем POST, правка доехала', r5b.methods === 'GET,POST' && r5b.has, JSON.stringify(r5b));

    // 6. Ввод токена и возврат на вкладку забирают сразу
    const r6 = await page.evaluate(async () => {
      _voicePullAt = 0; window.__calls = [];
      localStorage.removeItem('avito_admin_token');
      window.prompt = () => 'новый-токен';
      getProxyToken();
      await new Promise(r => setTimeout(r, 50));
      const afterToken = window.__calls.filter(c => c.doc === 'voice' && c.method === 'GET').length;
      _voicePullAt = 0; window.__calls = [];
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 50));
      const afterVisible = window.__calls.filter(c => c.doc === 'voice' && c.method === 'GET').length;
      return { afterToken, afterVisible };
    });
    t.ok('F21: ввод токена сразу забирает сырьё', r6.afterToken === 1, JSON.stringify(r6));
    t.ok('F21: возврат на вкладку с устаревшим забиранием — забирает', r6.afterVisible === 1, JSON.stringify(r6));

    // ── Ревью 15.10 ──
    // 409 раз за разом: после SYNC_CONFLICT_MAX — стоп, тревога, без вечного GET+POST
    const r7 = await page.evaluate(async () => {
      window.__conflictAlways = true; _voiceConflicts = 0; _voiceLast = ''; _voiceAlarmAt = 0;
      document.getElementById('toast').textContent = '';
      for (let i = 0; i < SYNC_CONFLICT_MAX; i++) {
        clearTimeout(_syncT); _voicePullAt = 0;
        state.favorites = [...state.favorites, { _fid: 200 + i, title: 'Конфликт ' + i, description: 'Т' }]; save();
        await syncPush();
      }
      const last = _voiceLast, toastText = document.getElementById('toast').textContent;
      clearTimeout(_syncT);
      window.__calls = [];
      state.favorites = [...state.favorites, { _fid: 299, title: 'После стопа', description: 'Т' }]; save();
      clearTimeout(_syncT);
      await syncPush();
      const quiet = window.__calls.filter(c => c.doc === 'voice').length;
      window.__conflictAlways = false;
      window.__calls = [];
      const forced = await syncPush(true);
      return { last, toastText, quiet, forced, after: _voiceLast, calls: window.__calls.filter(c => c.doc === 'voice').map(c => c.method).join(',') };
    });
    t.eq('ревью: 409 подряд → состояние «stuck»', r7.last, 'stuck');
    t.ok('ревью: тревога «обнови страницу»', /обнови страницу/.test(r7.toastText), r7.toastText);
    t.eq('ревью: после стопа сами не долбим сервер (ни GET, ни POST)', r7.quiet, 0);
    t.ok('ревью: «↑ Отправить сейчас» (force) пробует снова и отправляет', r7.forced === true && r7.after === 'sent' && r7.calls === 'GET,POST', JSON.stringify(r7));

    // Ушли одни настройки, а сырьё нет — это не «отправлено»
    const r8 = await page.evaluate(async () => {
      _voicePullAt = 0;
      state.favorites = [...state.favorites, { _fid: 300, title: 'Без сети', description: 'Т' }];
      state.settings.pageName = 'Своя ' + Date.now(); save(); clearTimeout(_syncT);
      // GET сырья падает, POST настроек проходит
      const inner = window.fetch;
      window.fetch = async (url, opts = {}) => {
        if ((opts.method || 'GET') === 'GET' && String(url).includes('/voice')) throw new Error('сеть недоступна');
        return inner(url, opts);
      };
      const sent = await syncPush(true);
      window.fetch = inner;
      return { sent, last: _voiceLast, status: syncStatusText() };
    });
    t.ok('ревью: забрать не вышло → syncPush не «отправлено», даже если ушли настройки', r8.sent === false && r8.last === 'nopull', JSON.stringify(r8));
    t.ok('ревью: статус синхронизации предупреждает', /сервер недоступен/.test(r8.status), r8.status);

    // Старое забирание не затирает свежий base из ответа POST
    const r9 = await page.evaluate(async () => {
      const inner = window.fetch;
      let release;
      window.fetch = async (url, opts = {}) => {
        if ((opts.method || 'GET') === 'GET' && String(url).includes('/voice')) {
          await new Promise(r => { release = r; });
          return { ok: true, status: 200, json: async () => ({ ok: true, updated: 'T1-старое', data: window.__srv.voice.data }) };
        }
        if (opts.method === 'POST' && String(url).includes('/voice')) return { ok: true, status: 200, json: async () => ({ ok: true, updated: 'T2-свежее' }) };
        return inner(url, opts);
      };
      _voicePullAt = 0;
      const pull = syncPullVoice();            // GET висит
      await new Promise(r => setTimeout(r, 20));
      _voicePullAt = Date.now();               // как будто свежо — отправка без своего GET
      state.favorites = [...state.favorites, { _fid: 400, title: 'Гонка', description: 'Т' }]; save(); clearTimeout(_syncT);
      await syncPush();
      const afterPost = _voiceBase;
      release(); await pull;
      window.fetch = inner;
      return { afterPost, final: _voiceBase };
    });
    t.ok('ревью: поздний ответ GET не откатывает base к старой версии', r9.afterPost === 'T2-свежее' && r9.final === 'T2-свежее', JSON.stringify(r9));

    // Забирание посреди генерации не перерисовывает экран
    const r10 = await page.evaluate(async () => {
      let renders = 0; const origRender = window.render;
      window.render = () => { renders++; return origRender(); };
      window.__srv.voice.data.refs = [...window.__srv.voice.data.refs, { id: 9, source: 'mine', category: 'game', title: 'Во время генерации', desc: 'Т' }];
      state.loading = true; _voicePullAt = 0;
      await syncPullVoice({ inPush: true });
      state.loading = false; window.render = origRender;
      return { renders, got: state.refs.some(r => r.title === 'Во время генерации') };
    });
    t.ok('ревью: при генерации забирание данные берёт, но экран не перерисовывает', r10.renders === 0 && r10.got, JSON.stringify(r10));
    t.ok('F21: консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }
}
