// Направление 2б: «товар в интерьере». Фото товара уходит в /api/image, обратно
// приходит та же вещь на живом фоне — ось антидубля для обложек.
//
// Что здесь проверяется в первую очередь: (1) промпт запрещает перерисовывать
// товар — перерисованная консоль другой ревизии превращает объявление в обман
// покупателя; (2) разбор ответа терпим к форме — на момент написания форма ответа
// вендора живьём не подтверждена; (3) 503 (нет ключа на сервере) НЕ трогает
// админ-токен, иначе Денис вводил бы его заново на каждый клик.
import { openApp } from './lib.mjs';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Ставим фото в state, минуя выбор файла (загрузка файла проверена в uncertain.mjs)
const withPhoto = page => page.evaluate(url => {
  state.vision.dataUrl = url;
  state.vision.media = { media_type: 'image/png', data: url.slice(url.indexOf(',') + 1) };
}, PNG_1x1);

// Подменяем fetch на границе сети и ловим, что именно уходит на сервер.
// jlog тоже перехватываем: журнал — часть поведения, а не побочный эффект.
const stubFetch = (page, resp) => page.evaluate(r => {
  window.__req = [];
  window.__jlog = [];
  const origJ = window.jlog;
  window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
  window.fetch = async (url, opts = {}) => {
    window.__req.push({ url, headers: opts.headers || {}, body: JSON.parse(opts.body || '{}') });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => (typeof r.text === 'string' ? r.text : JSON.stringify(r.json)),
    };
  };
}, resp);

const gen = page => page.evaluate(async () => {
  await doStagedPhoto();
  const st = state.vision.staged;
  return {
    img: st.img ? { head: st.img.dataUrl.slice(0, 40), scene: st.img.scene, quality: st.img.quality } : null,
    error: st.error, count: st.count, loading: st.loading,
    req: window.__req[0] || null,
    logged: window.__jlog.map(x => ({ ev: x.ev, data: x.data })),
    token: localStorage.getItem('avito_admin_token'),
  };
});

export async function runStaged(browser, base, t) {
  t.section('staged — «товар в интерьере» (направление 2б)');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // Токен кладём заранее: getProxyToken иначе полез бы в prompt() и подвесил стенд
    await page.evaluate(() => localStorage.setItem('avito_admin_token', 'test-token'));

    // ── Карточка появляется только при наличии фото ──────────
    const noPhoto = await page.evaluate(() => ({
      card: stagedCardHTML(),
      inForm: formHTML().includes('Товар в интерьере'),
    }));
    t.eq('без фото карточка не рисуется', noPhoto.card, '');
    t.eq('и в форме её нет', noPhoto.inForm, false);

    await withPhoto(page);
    const shown = await page.evaluate(() => ({
      inForm: formHTML().includes('Товар в интерьере'),
      chips: (stagedCardHTML().match(/data-act="staged-scene"/g) || []).length,
      on: (stagedCardHTML().match(/class="chip on" data-act="staged-scene"/g) || []).length,
      genBtn: stagedCardHTML().includes('🏠 Поставить в интерьер'),
      noCovers: !stagedCardHTML().includes('staged-covers'),
      scenes: STAGED_SCENES.length,
    }));
    t.ok('с фото карточка встроена в форму', shown.inForm);
    t.eq('чипов сцен — по числу сцен', shown.chips, shown.scenes);
    t.eq('ровно одна сцена выбрана по умолчанию', shown.on, 1);
    t.ok('кнопка генерации показана', shown.genBtn);
    t.ok('кнопок результата пока нет', shown.noCovers);

    // ── Промпт: товар не перерисовывать ─────────────────────
    const prompt = await page.evaluate(() => {
      state.form.category = 'phys';
      state.form.physName = 'PlayStation 5 Slim';
      state.vision.staged.scene = 'shelf';
      state.vision.staged.extra = '';
      const bare = stagedPrompt();
      state.vision.staged.extra = 'рядом положи диск';
      const withExtra = stagedPrompt();
      state.vision.staged.scene = 'studio';
      const studio = stagedPrompt();
      return { bare, withExtra, studio };
    });
    t.ok('товар переносится с фото без изменений', /перенеси с фото БЕЗ изменений/.test(prompt.bare), prompt.bare);
    t.ok('запрещено заменять похожим', /Ничего не «улучшай» и не заменяй похожим/.test(prompt.bare));
    t.ok('запрещено добавлять комплектацию', /Комплектацию не добавляй/.test(prompt.bare));
    t.ok('запрещены надписи, водяные знаки и ценники', /Никаких надписей, водяных знаков, логотипов магазинов, ценников/.test(prompt.bare));
    t.ok('требуется фотореалистичность', /Фотореалистично/.test(prompt.bare));
    t.ok('сцена попала в промпт', /на деревянной полке стеллажа/.test(prompt.bare));
    t.ok('название товара дано как подсказка, а не как задание',
      /На фото: PlayStation 5 Slim\. Это подсказка — все детали бери с фото/.test(prompt.bare), prompt.bare);
    t.ok('уточнение человека попало в промпт', /Дополнительно: рядом положи диск/.test(prompt.withExtra));
    t.ok('пустое уточнение строки не добавляет', !/Дополнительно:/.test(prompt.bare));
    t.ok('смена сцены меняет промпт', /студийном фоне/.test(prompt.studio) && !/полке стеллажа/.test(prompt.studio));

    // ── Что уходит на сервер ────────────────────────────────
    await stubFetch(page, { status: 200, json: { data: [{ b64_json: 'QUJD', media_type: 'image/png' }] } });
    const okRun = await gen(page);
    t.ok('запрос ушёл на /api/image', /\/api\/image$/.test(okRun.req.url), okRun.req && okRun.req.url);
    // Имена в ЕДИНСТВЕННОМ числе: множественные вендор молча выбрасывал и отдавал
    // квадрат дефолтного качества (замер 13.09). Проверяем и то, что старых имён
    // в теле больше нет — иначе сервер ответит своим 400.
    t.eq('соотношение сторон вертикальное', okRun.req.body.aspect_ratio, '3:4');
    t.eq('качество по умолчанию черновое', okRun.req.body.quality, 'medium');
    t.ok('множественных имён в теле нет',
      okRun.req.body.aspect_ratios === undefined && okRun.req.body.qualities === undefined,
      JSON.stringify([okRun.req.body.aspect_ratios, okRun.req.body.qualities]));
    t.eq('исходное фото передано одним референсом', okRun.req.body.input_references.length, 1);
    t.eq('в форме, которую ждёт вендор', okRun.req.body.input_references[0].type, 'image_url');
    t.eq('и это именно наше фото', okRun.req.body.input_references[0].image_url.url, PNG_1x1);
    t.ok('модель клиентом НЕ выбирается', okRun.req.body.model === undefined, JSON.stringify(okRun.req.body.model));
    t.ok('множитель цены n клиентом не передаётся', okRun.req.body.n === undefined);
    t.eq('админ-токен приложен', okRun.req.headers.Authorization, 'Bearer test-token');

    // ── Результат и журнал ──────────────────────────────────
    t.ok('картинка разобрана из b64_json', okRun.img && okRun.img.head.startsWith('data:image/png;base64,QUJD'), JSON.stringify(okRun.img));
    t.eq('сцена запомнена вместе с картинкой', okRun.img.scene, 'studio');
    t.eq('счётчик попыток вырос', okRun.count, 1);
    t.eq('флаг загрузки снят', okRun.loading, false);
    const ev = okRun.logged.find(x => x.ev === 'staged');
    t.ok('событие журнала записано', !!ev);
    t.eq('со сценой', ev && ev.data.scene, 'studio');
    t.eq('и соотношением сторон', ev && ev.data.aspect, '3:4');
    t.eq('и номером попытки', ev && ev.data.attempt, 1);
    t.eq('и качеством', ev && ev.data.quality, 'medium');
    // Без phase генерацию от скачивания пришлось бы отличать по ОТСУТСТВИЮ поля
    t.eq('фаза названа явно', ev && ev.data.phase, 'generate');

    // ── Качество: черновик по умолчанию, финал по кнопке ────
    const qUI = await page.evaluate(() => ({
      chips: (stagedCardHTML().match(/data-act="staged-quality"/g) || []).length,
      on: (stagedCardHTML().match(/class="chip on" data-act="staged-quality"/g) || []).length,
      draftFirst: STAGED_QUALITIES[0].id,
    }));
    t.eq('чипов качества два', qUI.chips, 2);
    t.eq('ровно одно выбрано', qUI.on, 1);
    t.eq('по умолчанию — черновик', qUI.draftFirst, 'medium');
    await stubFetch(page, { status: 200, json: { data: [{ b64_json: 'QUJD', media_type: 'image/png' }] } });
    const hiRun = await page.evaluate(async () => {
      state.vision.staged.quality = 'high';
      await doStagedPhoto();
      return {
        sent: window.__req[0].body.quality,
        stamped: state.vision.staged.img.quality,
        ev: (window.__jlog.find(x => x.ev === 'staged') || {}).data,
      };
    });
    t.eq('выбор финала уходит на сервер', hiRun.sent, 'high');
    t.eq('и штампуется на картинке', hiRun.stamped, 'high');
    t.eq('и попадает в журнал', hiRun.ev && hiRun.ev.quality, 'high');

    // ── Атрибуция журнала: снимок ДО await ──────────────────
    // Форма во время генерации не заблокирована, а генерация идёт до минуты:
    // если читать категорию на завершении, в журнал уедет не та, по которой
    // строился промпт, и разбор «что работает» будет считать по чужой категории.
    await stubFetch(page, { status: 200, json: { data: [{ b64_json: 'QUJD', media_type: 'image/png' }] } });
    const attrib = await page.evaluate(async () => {
      state.form.category = 'phys';
      state.form.physName = 'Xbox Series X';
      const p = doStagedPhoto();              // не ждём: имитируем правку формы «во время»
      state.form.category = 'game';
      state.form.gameName = 'совсем другая игра';
      await p;
      return (window.__jlog.find(x => x.ev === 'staged') || {}).data;
    });
    t.eq('в журнале категория на момент запроса', attrib && attrib.category, 'phys');
    t.eq('и товар на момент запроса', attrib && attrib.product, 'Xbox Series X');
    const uiAfter = await page.evaluate(() => ({
      covers: stagedCardHTML().includes('staged-covers'),
      dl: stagedCardHTML().includes('staged-download'),
      again: stagedCardHTML().includes('↻ Ещё вариант'),
      warn: stagedCardHTML().includes('Сверьте с исходным фото'),
    }));
    t.ok('кнопка «в обложки» появилась', uiAfter.covers);
    t.ok('кнопка скачивания появилась', uiAfter.dl);
    t.ok('генерация превратилась в «Ещё вариант»', uiAfter.again);
    t.ok('человека просят сверить товар с исходным фото', uiAfter.warn);

    // ── Терпимый разбор ответа ──────────────────────────────
    const shapes = await page.evaluate(() => {
      const run = d => { try { return { ok: true, v: stagedExtractImage(d) }; } catch (e) { return { ok: false, v: e.message }; } };
      return {
        b64:   run({ data: [{ b64_json: 'QQ==', media_type: 'image/jpeg' }] }),
        noMt:  run({ data: [{ b64_json: 'QQ==' }] }),
        webp:  run({ data: [{ b64_json: 'QQ==', media_type: 'image/webp' }] }),
        evil:  run({ data: [{ b64_json: 'QQ==', media_type: 'image/png"><img src=x onerror=alert(1)>' }] }),
        weird: run({ data: [{ b64_json: 'QQ==', media_type: 'text/html' }] }),
        url:   run({ data: [{ url: 'https://x/y.png' }] }),
        imgUrl: run({ data: [{ image_url: { url: 'https://x/z.png' } }] }),
        chat:  run({ choices: [{ message: { images: [{ image_url: { url: 'https://x/c.png' } }] } }] }),
        empty: run({ data: [] }),
        junk:  run({ error: { message: 'no credits' }, id: 'abc' }),
        nul:   run(null),
      };
    });
    t.eq('b64_json + media_type', shapes.b64.v, 'data:image/jpeg;base64,QQ==');
    t.eq('без media_type подставляется png', shapes.noMt.v, 'data:image/png;base64,QQ==');
    t.eq('webp — тоже свой', shapes.webp.v, 'data:image/webp;base64,QQ==');
    // media_type — строка ОТ ВЕНДОРА, а результат идёт в <img src="..."> без esc:
    // без белого списка «image/png"><img onerror=…>» стало бы разметкой
    t.ok('разметка в media_type не проходит', !/onerror/.test(shapes.evil.v), shapes.evil.v);
    t.eq('и подменяется безопасным png', shapes.evil.v, 'data:image/png;base64,QQ==');
    t.eq('неизображение тоже не проходит', shapes.weird.v, 'data:image/png;base64,QQ==');
    // Удалённых URL этот маршрут не отдаёт (замер 13.09: четыре модели, все b64).
    // Принять такой URL значило бы испортить канвас обложки: cross-origin картинка
    // делает toDataURL() недоступным, и скачивание JPEG молча падает.
    t.eq('прямая ссылка не принимается', shapes.url.ok, false);
    t.eq('вложенный image_url не принимается', shapes.imgUrl.ok, false);
    t.eq('форма chat-completions не принимается', shapes.chat.ok, false);
    t.ok('в отказе видно, что пришло', /url/.test(shapes.url.v), shapes.url.v);
    t.eq('пустой data — ошибка', shapes.empty.ok, false);
    // Главное: при промахе видно, ЧТО пришло — иначе первая живая проба даст
    // «не получилось» без зацепок, уже после списания за генерацию
    t.ok('в ошибке перечислены ключи ответа', /error, id/.test(shapes.junk.v), shapes.junk.v);
    t.ok('null не роняет разбор', shapes.nul.ok === false);

    // ── Ошибки сервера ──────────────────────────────────────
    await stubFetch(page, { status: 503, text: '{"error":"OPENROUTER_AVITO_KEY не задан на сервере"}' });
    const noKey = await gen(page);
    t.ok('503 объясняется по-человечески', /Ключ OpenRouter не заведён на сервере/.test(noKey.error), noKey.error);
    t.eq('и админ-токен НЕ сбрасывается', noKey.token, 'test-token');
    t.ok('ошибка попала в журнал', noKey.logged.some(x => x.ev === 'error' && x.data.stage === 'staged_photo'));
    t.eq('флаг загрузки снят и после ошибки', noKey.loading, false);

    await stubFetch(page, { status: 500, text: 'upstream вернул не JSON' });
    const err500 = await gen(page);
    t.ok('5xx показывает статус', /Картинка 500/.test(err500.error), err500.error);
    t.eq('токен цел и на 500', err500.token, 'test-token');

    await stubFetch(page, { status: 401, text: 'Unauthorized' });
    const err401 = await gen(page);
    t.eq('401 сбрасывает админ-токен (F13)', err401.token, null);
    await page.evaluate(() => localStorage.setItem('avito_admin_token', 'test-token'));

    // Прежняя картинка при ошибке остаётся — терять оплаченный результат нельзя
    const kept = await page.evaluate(() => !!state.vision.staged.img);
    t.ok('ошибка не выбрасывает прежнюю картинку', kept);

    // ── Смена фото: сцена остаётся, картинка уходит ─────────
    // Файл должен быть НАСТОЯЩИМ png: на битом visionPrepFile уходит в onerror,
    // visionPick падает в catch и до сброса не доходит — фото при этом остаётся
    // прежним, так что и картинке сцены сбрасываться незачем. Первая версия
    // этого теста подсовывала обрубок в 4 байта и «ловила» ровно это.
    const swapped = await page.evaluate(async b64 => {
      state.vision.staged.extra = 'рядом диск';
      const before = { scene: state.vision.staged.scene, extra: state.vision.staged.extra };
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await visionPick(new File([bin], 'x.png', { type: 'image/png' }));
      return { before, img: state.vision.staged.img, scene: state.vision.staged.scene,
               extra: state.vision.staged.extra, count: state.vision.staged.count,
               err: state.vision.error };
    }, PNG_1x1.slice(PNG_1x1.indexOf(',') + 1));
    t.eq('новое фото прочитано', swapped.err, '');
    t.eq('интерьер прежнего товара убран', swapped.img, null);
    t.eq('выбранная сцена сохранена', swapped.scene, swapped.before.scene);
    t.eq('уточнение сохранено', swapped.extra, 'рядом диск');
    t.eq('счётчик попыток обнулён', swapped.count, 0);

    // ── freshVision: «убрать фото» не роняет карточку ───────
    // Регресс: набор полей vision раньше дублировался в state и в visionClear,
    // и поле, добавленное в одну копию, роняло бы visionBusy() после очистки.
    const cleared = await page.evaluate(() => {
      visionClear();
      return { hasStaged: !!state.vision.staged, busy: visionBusy(), card: stagedCardHTML(), form: formHTML().length };
    });
    t.ok('после «убрать фото» staged на месте', cleared.hasStaged);
    t.eq('visionBusy не падает', cleared.busy, false);
    t.eq('карточка снова пуста', cleared.card, '');
    t.ok('форма продолжает рендериться', cleared.form > 0);

    // ── Занятость: фото не сменить во время генерации ───────
    const busy = await page.evaluate(() => {
      state.vision.dataUrl = 'data:image/png;base64,AA';
      state.vision.staged.loading = true;
      const r = { busy: visionBusy(), disabled: stagedCardHTML().includes('disabled'), guard: jActBusy('staged-gen', null) };
      state.vision.staged.loading = false;
      return r;
    });
    t.ok('генерация считается занятостью карточки', busy.busy);
    t.ok('контролы заблокированы', busy.disabled);
    t.ok('повторный клик не идёт в перепись', busy.guard);

    // ── Перенос в обложки ───────────────────────────────────
    const toCovers = await page.evaluate(async url => {
      cv.mode = 'collage'; cv.images = [];
      state.vision.dataUrl = url;
      state.vision.staged.img = { dataUrl: url, scene: 'desk' };
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      stagedToCovers();
      await new Promise(r => setTimeout(r, 300));
      const log = window.__jlog.find(x => x.ev === 'cv_images');
      return { count: cv.images.length, tab: state.tab, source: log && log.data.source, scene: log && log.data.scene };
    }, PNG_1x1);
    t.eq('картинка добавлена в конструктор', toCovers.count, 1);
    t.eq('и открыта вкладка обложек', toCovers.tab, 'covers');
    t.eq('журнал знает источник', toCovers.source, 'staged');
    t.eq('и сцену', toCovers.scene, 'desk');

    // ── Ничего из этого не персистится ──────────────────────
    // Картинка — сотни КБ base64; журнал самообучения делит квоту с реальными
    // данными продавца и всегда им уступает, здесь то же правило.
    const persisted = await page.evaluate(() => {
      save();
      const keys = Object.keys(localStorage);
      const big = keys.filter(k => (localStorage.getItem(k) || '').includes('base64'));
      return { staged: keys.filter(k => /staged|vision/i.test(k)), big };
    });
    t.eq('в localStorage нет ключей staged/vision', persisted.staged.length, 0, JSON.stringify(persisted.staged));
    t.eq('и ни одного base64', persisted.big.length, 0, JSON.stringify(persisted.big));

    // Три ошибки выше вызваны нарочно (503/500/401), и doStagedPhoto печатает их
    // в консоль осознанно — как это делает и распознавание. Фильтр узкий: любая
    // другая запись в консоли по-прежнему валит секцию.
    const unexpected = consoleErrors.filter(e =>
      !/Ключ OpenRouter не заведён на сервере/.test(e) &&
      !/Картинка (500|401):/.test(e));
    t.eq('нарочные ошибки действительно залогированы', consoleErrors.length - unexpected.length, 3);
    t.ok('других ошибок в консоли нет', unexpected.length === 0, unexpected.join('\n'));
  } finally {
    await ctx.close();
  }
}
