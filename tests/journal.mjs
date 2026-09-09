// Секция journal — доставка событий: ключ идемпотентности, пауза после неудач,
// честность переписи кликов, устойчивость к недоступному localStorage.
// Закрывает отложенные находки ревью 2026-09-06 (правки 2026-09-09).
import { openApp } from './lib.mjs';

// Заглушка прокси ставится внутри страницы: jFlush читает у ответа только ok/status

export async function runJournal(browser, base, t) {
  t.section('journal — доставка событий журнала');
  const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');

  // ── Ключ идемпотентности ────────────────────────────────
  // Без eid дедуп при разборе идёт по ts+device+event и схлопывает два разных
  // клика, попавших в одну миллисекунду, в одно событие.
  const eids = await page.evaluate(() => {
    _jBuf.length = 0;
    jlog('ui', null, { act: 'test-a' });
    jlog('ui', null, { act: 'test-b' });
    clearTimeout(_jFlushT); // отложенная отправка в тесте не нужна
    return _jBuf.map(e => e.eid);
  });
  t.eq('у события есть ключ eid', eids.length, 2);
  t.ok('eid непустые', eids.every(x => typeof x === 'string' && x.length >= 8), JSON.stringify(eids));
  t.ok('и различаются у соседних событий', eids[0] !== eids[1], JSON.stringify(eids));

  // Тот же клик дважды подряд — разные события, а не один дубль
  const sameActEids = await page.evaluate(() => {
    _jBuf.length = 0;
    jlog('ui', null, { act: 'test-same' });
    jlog('ui', null, { act: 'test-same' });
    clearTimeout(_jFlushT);
    return _jBuf.map(e => e.eid);
  });
  t.ok('одинаковые клики различимы по eid', sameActEids[0] !== sameActEids[1], JSON.stringify(sameActEids));

  // ── Пауза после неудач ──────────────────────────────────
  // Находка: _jOldestAt сбрасывается только при опустевшем буфере, поэтому после
  // 30с неудач «пора слать» становится вечным и POST уходит на каждый клик.
  const fail1 = await page.evaluate(async (status) => {
    // Заглушка отвечает тем статусом, который положили в window.__status
    window.__status = status;
    window.__calls = 0;
    window.fetch = async () => {
      window.__calls++;
      const s = window.__status;
      return { ok: s >= 200 && s < 300, status: s, json: async () => ({ ok: true }) };
    };
    localStorage.setItem('avito_admin_token', 'test-token');
    _jBuf.length = 0; _jFails = 0; _jQuietUntil = 0;
    jlog('ui', null, { act: 'test-fail' });
    clearTimeout(_jFlushT);
    await jFlush();
    return { calls: window.__calls, fails: _jFails, quiet: _jQuietUntil - Date.now(), buf: _jBuf.length };
  }, 500);
  t.eq('при 500 запрос ушёл один раз', fail1.calls, 1);
  t.eq('неудача засчитана', fail1.fails, 1);
  t.ok('назначена пауза', fail1.quiet > 0, `осталось ${fail1.quiet}мс`);
  t.eq('буфер цел — событие не потеряно', fail1.buf, 1);

  const fail2 = await page.evaluate(async () => {
    await jFlush();                       // сразу же, пока пауза не вышла
    jlog('ui', null, { act: 'test-fail2' }); // и клик во время паузы
    clearTimeout(_jFlushT);
    await jFlush();
    return { calls: window.__calls, buf: _jBuf.length };
  });
  t.eq('во время паузы повторных запросов нет', fail2.calls, 1);
  t.eq('события во время паузы копятся, а не теряются', fail2.buf, 2);

  const grow = await page.evaluate(async () => {
    const first = _jQuietUntil - Date.now();
    _jQuietUntil = 0;                     // имитируем истёкшую паузу
    await jFlush();                       // снова 500
    return { first, second: _jQuietUntil - Date.now(), fails: _jFails, calls: window.__calls };
  });
  t.eq('после паузы попытка повторяется', grow.calls, 2);
  t.ok('пауза растёт со второй неудачей', grow.second > grow.first, `было ${grow.first}мс, стало ${grow.second}мс`);

  const okFlush = await page.evaluate(async (status) => {
    window.__status = status;
    _jQuietUntil = 0;
    await jFlush();
    return { fails: _jFails, quiet: _jQuietUntil, buf: _jBuf.length };
  }, 200);
  t.eq('успех сбрасывает счётчик неудач', okFlush.fails, 0);
  t.eq('и снимает паузу', okFlush.quiet, 0);
  t.eq('отправленные события удалены из буфера', okFlush.buf, 0);

  // Отвергнутый батч — связь жива, паузу растить незачем, но батч выбрасываем
  const rejected = await page.evaluate(async (status) => {
    window.__status = status;
    _jBuf.length = 0; _jFails = 0; _jQuietUntil = 0;
    jlog('ui', null, { act: 'test-reject' });
    clearTimeout(_jFlushT);
    await jFlush();
    return { fails: _jFails, quiet: _jQuietUntil, buf: _jBuf.length };
  }, 400);
  t.eq('отвергнутый батч выброшен', rejected.buf, 0);
  t.eq('и паузу не растит', rejected.fails, 0);
  t.eq('пауза не назначена', rejected.quiet, 0);

  // Журнал без токена молчит и ничего не теряет
  const noToken = await page.evaluate(async () => {
    localStorage.removeItem('avito_admin_token');
    window.__calls = 0;
    _jBuf.length = 0; _jFails = 0; _jQuietUntil = 0;
    jlog('ui', null, { act: 'test-notoken' });
    clearTimeout(_jFlushT);
    await jFlush();
    return { calls: window.__calls, buf: _jBuf.length };
  });
  t.eq('без токена запрос не уходит', noToken.calls, 0);
  t.eq('и событие ждёт в буфере', noToken.buf, 1);

  // ── Честность переписи кликов ───────────────────────────
  // Находка: гард смотрел только state.loading, а половина кнопок блокируется
  // своими флагами — их холостые клики попадали в перепись.
  const busy = await page.evaluate(() => {
    const snap = {
      loading: state.loading, extra: state.extraLoading, regen: state.regenId,
      alt: state.altTitlesLoading, refs: state._refTricksLoading,
      vl: state.vision.loading, vp: state.vision.priceLoading,
    };
    const out = {};
    state.loading = true;
    out.gen = jActBusy('gen');
    out.genMoreViaLoading = jActBusy('gen-more');
    state.loading = false;
    state.extraLoading = true;  out.genMore = jActBusy('gen-more');   state.extraLoading = false;
    state.regenId = 7;          out.regen = jActBusy('regen');        state.regenId = null;
    state.altTitlesLoading = 7; out.alt = jActBusy('alt-titles');     state.altTitlesLoading = null;
    state._refTricksLoading = true; out.refs = jActBusy('ref-tricks'); state._refTricksLoading = false;
    state.vision.loading = true;    out.vrec = jActBusy('vision-recognize'); state.vision.loading = false;
    state.vision.priceLoading = true; out.vprice = jActBusy('vision-price'); state.vision.priceLoading = false;
    out.freeGen = jActBusy('gen');
    out.other = jActBusy('dup-check');
    Object.assign(state, { loading: snap.loading, extraLoading: snap.extra, regenId: snap.regen,
      altTitlesLoading: snap.alt, _refTricksLoading: snap.refs });
    state.vision.loading = snap.vl; state.vision.priceLoading = snap.vp;
    return out;
  });
  t.ok('«Ещё варианты» во время своей загрузки — занято', busy.genMore);
  t.ok('и во время основной генерации тоже', busy.genMoreViaLoading);
  t.ok('перегенерация карточки — занято', busy.regen);
  t.ok('↻×5 — занято', busy.alt);
  t.ok('разбор приёмов — занято', busy.refs);
  t.ok('распознавание по фото — занято', busy.vrec);
  t.ok('поиск цены — занято', busy.vprice);
  t.ok('генерация — занято', busy.gen);
  t.ok('свободная кнопка не считается занятой', busy.freeGen === false);
  t.ok('действие без своей загрузки всегда свободно', busy.other === false);

  // Интеграционно: реальный клик по свободной кнопке в перепись попадает
  const clicked = await page.evaluate(async () => {
    _jBuf.length = 0;
    const btn = document.querySelector('[data-act="scan-check"], [data-act="toggle-batch"], [data-act="preset-save"]');
    if (!btn) return { skipped: true };
    btn.click();
    clearTimeout(_jFlushT);
    const act = btn.getAttribute('data-act');
    return { act, logged: _jBuf.some(e => e.event === 'ui' && e.act === act) };
  });
  t.ok('клик по живой кнопке попадает в перепись', clicked.skipped || clicked.logged,
    JSON.stringify(clicked));

  // ── Недоступный localStorage ────────────────────────────
  // В приватном режиме сам доступ бросает исключение, а чтение стоит прямо
  // в разметке настроек и панели AI внутри формы генератора.
  const denied = await page.evaluate(() => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function () { throw new Error('access denied'); };
    const out = {};
    try { out.raw = lsRaw('avito_admin_token'); } catch (e) { out.rawThrew = e.message; }
    try { out.settingsLen = settingsHTML().length; } catch (e) { out.settingsThrew = e.message; }
    try { out.tabLen = settingsTabHTML().length; } catch (e) { out.tabThrew = e.message; }
    Storage.prototype.getItem = orig;
    return out;
  });
  t.eq('lsRaw возвращает null вместо исключения', denied.raw, null);
  t.ok('панель AI в форме генератора рендерится', !denied.settingsThrew && denied.settingsLen > 100,
    denied.settingsThrew || `длина ${denied.settingsLen}`);
  t.ok('вкладка настроек рендерится', !denied.tabThrew && denied.tabLen > 100,
    denied.tabThrew || `длина ${denied.tabLen}`);

  // Сообщение про отвергнутый батч печатает сам код — этого мы и добивались тестом
  // с 400; глушим только его, любая другая ошибка в консоли остаётся провалом.
  const unexpected = consoleErrors.filter(e => !/батч отвергнут сервером \(400\)/.test(e));
  t.ok('в консоли только ожидаемое сообщение об отвергнутом батче',
    unexpected.length === 0, unexpected.join('\n'));
  await ctx.close();
}
