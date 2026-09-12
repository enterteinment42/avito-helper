// Секция history — сохранность записей Истории и финальных текстов с Авито.
// Три живых дефекта 12.09: диалог финала затирал донесённый текст бот-версией,
// если поле оставить пустым («открыл посмотреть» = потеря невосполнимого сырья);
// правка ✎ меняла ключ синхронизации, и прежняя версия возвращалась с сервера
// отдельной строкой; «✓ Размещено» без замка плодило вторые записи о публикации.
import { openApp } from './lib.mjs';

// Тот же стаб сервера, что в секции sync
const stubNet = page => page.evaluate(() => {
  window.__srv = {}; window.__calls = [];
  localStorage.setItem('avito_admin_token', 'test-token');
  window.fetch = async (url, opts = {}) => {
    const doc = String(url).split('/api/avito-sync/')[1] || '?';
    window.__calls.push({ doc, method: opts.method || 'GET' });
    if ((opts.method || 'GET') === 'GET') {
      const d = window.__srv[doc];
      return { ok: true, status: 200, json: async () => (d ? { ok: true, ...d } : { ok: true, empty: true }) };
    }
    const body = JSON.parse(opts.body);
    window.__srv[doc] = { updated: new Date().toISOString(), device: body.device, data: body.data };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
});

const BOT = 'Сгенерированное описание. Оформляется в цифре. PS4 PS5';
const MINE = 'Мой финальный текст, переписанный руками почти целиком: другой порядок, свои слова, свой хвост про живого человека.';

export async function runHistory(browser, base, t) {
  t.section('history — финалы с Авито, правка записи, повторное размещение');

  // ── Диалог финала: первый донос ─────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([bot, mine]) => {
      const out = {};
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      const mk = () => {
        state.db = [{ id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров', title: 'Бот-заголовок',
          description: bot, status: 'active', note: '', date: '12.09.2026', _category: 'gaming_sub' }];
        return state.db[0];
      };

      // Вставили свой текст — он и становится финалом
      let rec = mk();
      showFinalDialog(1);
      document.getElementById('final-desc').value = mine;
      document.getElementById('final-save').click();
      out.pasted = { desc: rec.finalDesc, share: rec.editShare, logged: window.__jlog.filter(x => x.ev === 'edited').length,
        descPasted: window.__jlog.find(x => x.ev === 'edited')?.data?.descPasted };

      // Пустое поле у записи БЕЗ финала означает «описание не менял» — прежнее поведение
      window.__jlog = [];
      rec = mk();
      showFinalDialog(1);
      document.getElementById('final-save').click();
      out.skipped = { desc: rec.finalDesc, share: rec.editShare };

      window.jlog = origJ;
      return out;
    }, [BOT, MINE]);

    t.eq('вставленный финал сохранён как есть', r.pasted.desc, MINE);
    t.ok('доля правок посчитана', r.pasted.share > 0.5, 'editShare: ' + r.pasted.share);
    t.eq('событие edited записано один раз', r.pasted.logged, 1);
    t.ok('и помечено как вставленное руками', r.pasted.descPasted === true);
    t.eq('пустое поле у записи без финала берёт бот-версию', r.skipped.desc, BOT);
    t.eq('и доля правок нулевая', r.skipped.share, 0);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Повторное открытие уже донесённого финала ───────────
  // Ровно тот сценарий, который стоил бы сырья: «открыл посмотреть».
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([bot, mine]) => {
      const out = {};
      window.__jlog = []; window.__toasts = [];
      const origJ = window.jlog, origToast = window.toast;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      window.toast = m => { window.__toasts.push(String(m)); };
      const mk = () => {
        state.db = [{ id: 1, _uid: 'u1', product: 'PS Plus Extra', region: 'Киров', title: 'Бот-заголовок',
          description: bot, finalTitle: 'Мой заголовок', finalDesc: mine, editShare: 0.61,
          status: 'active', note: '', date: '12.09.2026' }];
        return state.db[0];
      };

      // Поля предзаполнены сохранённым финалом, а не бот-версией
      let rec = mk();
      showFinalDialog(1);
      out.prefilled = {
        desc: document.getElementById('final-desc').value,
        title: document.getElementById('final-title').value,
        hint: /Финал уже сохранён/.test(document.getElementById('final-overlay').textContent),
      };

      // Просто закрыли — вопроса «закрыть без сохранения?» быть не должно
      window.confirm = () => { out.askedOnClose = true; return true; };
      document.getElementById('final-skip').click();
      out.closed = !document.getElementById('final-overlay');

      // Открыли и нажали «Сохранить», ничего не меняя
      window.__jlog = [];
      showFinalDialog(1);
      document.getElementById('final-save').click();
      out.resaved = { desc: rec.finalDesc, share: rec.editShare, logged: window.__jlog.filter(x => x.ev === 'edited').length,
        toast: window.__toasts[window.__toasts.length - 1] };

      // Очистили поле и сохранили — финал ДОЛЖЕН остаться
      showFinalDialog(1);
      document.getElementById('final-desc').value = '';
      document.getElementById('final-save').click();
      out.cleared = { desc: rec.finalDesc, share: rec.editShare };

      // Правка поверх — новый финал, новое событие
      window.__jlog = [];
      showFinalDialog(1);
      document.getElementById('final-desc').value = mine + ' Ещё одна правка.';
      document.getElementById('final-save').click();
      out.edited = { desc: rec.finalDesc, logged: window.__jlog.filter(x => x.ev === 'edited').length,
        descPasted: window.__jlog.find(x => x.ev === 'edited')?.data?.descPasted };

      window.jlog = origJ; window.toast = origToast;
      return out;
    }, [BOT, MINE]);

    t.eq('поле описания предзаполнено сохранённым финалом', r.prefilled.desc, MINE);
    t.eq('и заголовок — финальным, а не бот-версией', r.prefilled.title, 'Мой заголовок');
    t.ok('в диалоге сказано, что финал уже сохранён', r.prefilled.hint);
    t.ok('просмотр и закрытие не спрашивают про потерю текста', !r.askedOnClose);
    t.ok('диалог закрылся', r.closed);
    t.eq('повторное сохранение без правок финал не тронуло', r.resaved.desc, MINE);
    t.eq('и долю правок не сбросило', r.resaved.share, 0.61);
    t.eq('и второго события edited не создало', r.resaved.logged, 0);
    t.ok('о том, что ничего не изменилось, сказано вслух', /не изменился/i.test(r.resaved.toast || ''), 'тост: ' + r.resaved.toast);
    t.eq('ОЧИЩЕННОЕ поле НЕ затирает донесённый финал', r.cleared.desc, MINE);
    t.eq('доля правок при этом сохранена', r.cleared.share, 0.61);
    t.eq('правка поверх сохраняется', r.edited.desc, MINE + ' Ещё одна правка.');
    t.eq('и пишет одно событие edited', r.edited.logged, 1);
    t.ok('помеченное как донесённое руками', r.edited.descPasted === true);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Правка ✎ не раздваивает запись ──────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await stubNet(page);
    const r = await page.evaluate(async ([bot, mine]) => {
      const out = {};
      // Старая запись — заведена до появления _uid, опознаётся по содержимому
      const old = { id: 7, product: 'PS Plus Extra', region: 'Киров', title: 'Бот-заголовок',
        description: bot, finalDesc: mine, editShare: 0.61, status: 'active', note: '', date: '12.09.2026' };
      state.db = [JSON.parse(JSON.stringify(old))];
      state.refs = []; state.favorites = [];
      save();
      await syncPush(true);                       // серверная копия — со старым ключом
      out.onServer = window.__srv.voice.data.db.length;
      out.keyBefore = syncDbKey(state.db[0]);

      // Правим регион через ✎
      state.dbEditId = 7;
      state.dbForm = { product: 'PS Plus Extra', region: 'Сыктывкар', status: 'active', note: '' };
      document.querySelector('[data-act="db-save"]')?.click() ??
        (await (async () => { // кнопки может не быть на текущей вкладке — зовём обработчик через клик по синтетическому узлу
          const b = document.createElement('button');
          b.dataset.act = 'db-save';
          document.body.appendChild(b); b.click(); b.remove();
        })());
      out.uid = !!state.db[0]._uid;
      out.keyAfter = syncDbKey(state.db[0]);
      out.region = state.db[0].region;
      out.finalKept = state.db[0].finalDesc === mine;

      // Забираем с сервера: прежняя версия вернуться НЕ должна
      await syncPullVoice();
      out.rows = state.db.length;
      out.regions = state.db.map(x => x.region);
      out.finals = state.db.filter(x => x.finalDesc).length;

      // Ключ записи с _uid от правки полей больше не зависит
      const k1 = syncDbKey(state.db[0]);
      state.db[0].product = 'Другой товар'; state.db[0].region = 'Москва';
      out.stableKey = syncDbKey(state.db[0]) === k1;
      return out;
    }, [BOT, MINE]);

    t.eq('исходная запись уехала на сервер', r.onServer, 1);
    t.ok('после правки у записи появился постоянный _uid', r.uid);
    t.ok('ключ записи сменился один раз — на постоянный', r.keyAfter !== r.keyBefore && /^db#/.test(r.keyAfter), JSON.stringify(r));
    t.eq('правка применилась', r.region, 'Сыктывкар');
    t.ok('и финал при правке не потерялся', r.finalKept);
    t.eq('прежняя версия с сервера НЕ воскресла отдельной строкой', r.rows, 1);
    t.eq('в Истории остался только правленый регион', JSON.stringify(r.regions), '["Сыктывкар"]');
    t.eq('финал на месте ровно один', r.finals, 1);
    t.ok('у записи с _uid правка полей ключ не меняет', r.stableKey);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Повторное «✓ Размещено» ─────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async () => {
      const out = {};
      window.callAI = async () => JSON.stringify({ variants: [{ id: 1, title: 'Заголовок варианта', description: 'Текст. Оформляется в цифре. PS5' }] });
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'] }));
      state.db = []; state.results = [];
      await doGenerate();
      const btn = () => document.querySelector('[data-act="mark-posted"]');
      window.prompt = () => 'Москва';

      out.hasBtn = !!btn();
      let asked = 0;
      window.confirm = () => { asked++; return true; };
      btn().click();                       // первое размещение — вопросов быть не должно
      out.firstAsked = asked;
      out.afterFirst = state.db.length;
      out.uid = !!state.db[0]?._uid;

      // Второе нажатие по той же карточке: отказ не должен создавать запись
      asked = 0;
      window.confirm = () => { asked++; return false; };
      btn().click();
      out.secondAsked = asked;
      out.afterRefuse = state.db.length;

      // Согласие — это сценарий «то же объявление в другом регионе»
      window.confirm = () => true;
      window.prompt = () => 'Киров';
      btn().click();
      out.afterAgree = state.db.length;
      out.regions = state.db.map(x => x.region);
      out.uids = new Set(state.db.map(x => x._uid)).size;
      return out;
    });

    t.ok('кнопка «✓ Размещено» на карточке есть', r.hasBtn);
    t.eq('первое размещение ничего не переспрашивает', r.firstAsked, 0);
    t.eq('запись создана', r.afterFirst, 1);
    t.ok('и несёт постоянный _uid', r.uid);
    t.eq('повторное нажатие переспрашивает', r.secondAsked, 1);
    t.eq('отказ второй записи не создаёт', r.afterRefuse, 1);
    t.eq('согласие создаёт запись для другого региона', r.afterAgree, 2);
    t.eq('регионы разные', JSON.stringify(r.regions), '["Москва","Киров"]');
    t.eq('и личности записей тоже разные', r.uids, 2);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }
}
