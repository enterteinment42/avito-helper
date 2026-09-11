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
      state.refs = [a]; save();
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
      return { onServer: window.__srv.voice.data.refs.length, posts: window.__calls.filter(c => c.doc === 'voice' && c.method === 'POST').length };
    }, [REF_A]);
    t.eq('сырьё на сервере цело', r.onServer, 1);
    t.eq('пустой документ вообще не отправлялся', r.posts, 0);
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
}
