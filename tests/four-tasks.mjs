import { openApp, VARIANTS_JSON } from './lib.mjs';

export async function runFourTasks(browser, base, t) {
  t.section('four-tasks — снимок формы, синхронизация, финал и каталог');
  const { page, ctx, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    const snapshots = await page.evaluate(async variants => {
      const original = { ...DEF_FORM, category: 'game', gameName: 'GTA VI', gamePlatforms: ['PS5'], count: 3 };
      const other = { ...DEF_FORM, category: 'ai_sub', aiService: 'Claude Pro' };
      const calls = [];
      const regions = ['A', 'B', 'C', 'D', 'E'];
      window.callAI = async ([message], opts) => {
        calls.push([message.content, opts.category]);
        state.form = structuredClone(other);
        state.batchRegions.splice(0);
        return /только названия/.test(message.content)
          ? '{"titles":[{"title":"GTA VI","hook":"сюжет"}]}' : variants;
      };
      state.form = structuredClone(original);
      await doGenerate();
      const main = [state.resultsForm.gameName, state.results[0]._product, state.results[0]._category];
      state.form = structuredClone(original);
      await doGenTitlesOnly();
      const titles = state.titleStep.form.gameName;
      state.form = structuredClone(original);
      state.batchRegions = [...regions];
      await doBatchGenerate();
      const batch = state.batchResults.map(row => row.region);
      return { main, titles, batch, firstForm: calls.every(([msg, cat]) => msg.includes('GTA VI') && cat === 'game') };
    }, VARIANTS_JSON);
    t.eq('смена формы не меняет штамп основного результата', snapshots.main.join('|'), 'GTA VI|GTA VI|game');
    t.eq('шаг заголовков хранит начальную форму', snapshots.titles, 'GTA VI');
    t.eq('пакет хранит исходный список регионов', snapshots.batch.join(','), 'A,B,C,D,E');
    t.ok('все запросы, в том числе второй чанк, используют одну форму', snapshots.firstForm);

    const overlap = await page.evaluate(async variants => {
      state.batchMode = false;
      state.batchResults = [];
      state.results = [{ id: 1, title: 'GTA VI', description: 'Исходник', _category: 'game', _product: 'GTA VI' }];
      state.resultsForm = { ...DEF_FORM, category: 'game', gameName: 'GTA VI', gamePlatforms: ['PS5'] };
      state.form = { ...DEF_FORM, category: 'ai_sub' };
      let resolve;
      let calls = 0;
      window.callAI = () => {
        calls++;
        return new Promise(done => { resolve = done; });
      };
      const more = doGenerateMore();
      await doGenerate();
      await doGenTitlesOnly();
      resolve(variants);
      await more;
      const added = state.extraResults[0]._product;
      const regen = doRegen(1);
      state.results[0].description = 'Ручная правка во время запроса';
      resolve(variants);
      await regen;
      const kept = state.results[0].description;
      const anotherRegen = doRegen(1);
      state.results = [{ id: 1, title: 'Claude Pro', _product: 'Claude Pro' }];
      resolve(variants);
      await anotherRegen;
      return { calls, added, kept, separate: state.extraResults.length, current: state.results[0].title };
    }, VARIANTS_JSON);
    t.eq('новый набор и шаг заголовков ждут занятую карточку', overlap.calls, 3);
    t.eq('дополнительный вариант относится к исходному товару', overlap.added, 'GTA VI');
    t.eq('перегенерация сохраняет введённую во время запроса правку', overlap.kept, 'Ручная правка во время запроса');
    t.eq('ответ после ручной правки добавлен отдельно', overlap.separate, 4);
    t.eq('поздний ответ не трогает новый вариант с тем же номером', overlap.current, 'Claude Pro');

    const unsafeRerender = await page.evaluate(async () => {
      let iteration = 0;
      syncFetch = async () => ({
        updated: String(++iteration),
        data: { db: [{ id: iteration, _uid: 'remote-' + iteration, product: 'Товар с телефона', title: 'Тест', region: 'Москва' }] },
      });
      state.tab = 'settings';
      render();
      const sys = document.getElementById('sys-prompt');
      sys.value = 'Несохранённый промпт';
      await syncPullVoice({ inPush: true });
      const promptKept = document.getElementById('sys-prompt') === sys && sys.value === 'Несохранённый промпт';
      state.tab = 'scanner';
      render();
      const scan = document.getElementById('scan-title');
      scan.value = 'Черновик для проверки';
      await syncPullVoice({ inPush: true });
      return { promptKept, scanKept: document.getElementById('scan-title') === scan && scan.value === 'Черновик для проверки',
        merged: state.db.some(row => row._uid === 'remote-2') };
    });
    t.ok('обновление истории не перерисовывает промпт настроек', unsafeRerender.promptKept);
    t.ok('обновление истории не перерисовывает Сканер', unsafeRerender.scanKept);
    t.ok('серверная запись при этом добавлена', unsafeRerender.merged);

    const publication = await page.evaluate(() => {
      state.batchResults = [];
      state.titleStep = null;
      state.db = [];
      state.results = [{ id: 1, title: 'Исходник', description: 'Текст модели', _product: 'GTA VI', _category: 'game' }];
      state.tab = 'generator';
      render();
      const editor = document.querySelector('[data-result-editor="1"]');
      const title = editor.querySelector('[data-result-edit="title"]');
      const desc = editor.querySelector('[data-result-edit="description"]');
      title.value = 'Я'.repeat(51);
      title.dispatchEvent(new Event('input', { bubbles: true }));
      desc.value = 'Текст Дениса';
      desc.dispatchEvent(new Event('input', { bubbles: true }));
      const copy = editor.querySelector('[data-j="desc"]').dataset.text;
      const scan = editor.querySelector('[data-edit-scan]').textContent;
      window.prompt = () => 'Москва';
      editor.querySelector('[data-act="mark-posted"]').click();
      const record = state.db[0];
      const recordBeforeDialog = [record.title, record.description, record.finalTitle, record.finalDesc];
      document.getElementById('final-desc').value = 'Поправлено в Авито';
      document.getElementById('final-save').click();
      const older = { ...record, finalDesc: 'Старый финал', _finalAt: record._finalAt - 1 };
      dbFillFrom(older, record);
      dbFillFrom(record, { ...older, finalDesc: 'Старая копия', _finalAt: record._finalAt - 2 });
      return { copy, scan, recordBeforeDialog, merged: older.finalDesc, kept: record.finalDesc };
    });
    t.eq('кнопка копирует текст редактора', publication.copy, 'Текст Дениса');
    t.ok('Сканер показывает красную причину до публикации', publication.scan.includes('51/50'));
    t.eq('исходник и финал сохраняются отдельно при красном Сканере', publication.recordBeforeDialog.join('|'),
      'Исходник|Текст модели|' + 'Я'.repeat(51) + '|Текст Дениса');
    t.eq('позднее уточнение финала доезжает в старую запись', publication.merged, 'Поправлено в Авито');
    t.eq('старая копия не затирает уточнение', publication.kept, 'Поправлено в Авито');

    const savedAlternatives = await page.evaluate(() => {
      const record = state.db[0];
      const sameTime = { ...record, finalTitle: 'Финал с телефона', finalDesc: 'Параллельная ручная правка' };
      dbFillFrom(record, sameTime);
      dbFillFrom(record, sameTime);
      const found = finalVersions(record).filter(item => item.desc === sameTime.finalDesc);
      showFinalDialog(record.id);
      const versions = document.getElementById('final-versions');
      versions.value = String(finalVersions(record).findIndex(item => item.desc === sameTime.finalDesc));
      versions.dispatchEvent(new Event('change'));
      document.getElementById('final-save').click();
      return { copies: found.length, active: record.finalDesc, previous: finalVersions(record).some(item => item.desc === 'Поправлено в Авито') };
    });
    t.eq('параллельный финал сохранён ровно одной версией', savedAlternatives.copies, 1);
    t.eq('параллельную версию можно сделать текущей из диалога', savedAlternatives.active, 'Параллельная ручная правка');
    t.ok('при выборе другого финала прежний доступен', savedAlternatives.previous);

    const session = await page.evaluate(async () => {
      const variant = { id: 1, title: 'Название избранного', description: 'Описание избранного', _fid: 42 };
      state.favorites = [variant];
      state.postQueue = [
        { id: 1, source: 'fav', favId: 42, product: 'Товар', region: 'Москва' },
        { id: 2, source: 'batch', variant, product: 'Товар', region: 'Казань' },
      ];
      await doStartSession();
      const change = value => {
        const field = document.querySelector('#session-overlay [data-result-edit="description"]');
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      change('Правка избранного в сессии');
      document.querySelector('[data-act="session-skip"]').click();
      change('Правка пакета в сессии');
      const effective = state.postSession.items[1].variant.description;
      document.querySelector('[data-act="session-close"]').click();
      return [state.favorites[0].description, state.postQueue[1].variant.description, effective];
    });
    t.eq('правки сессии не меняют избранное и исходник очереди', session.join('|'),
      'Описание избранного|Описание избранного|Правка пакета в сессии');

    const duplicate = await page.evaluate(() => {
      const published = { title: 'Особый комплект', description: 'Футбольная коллекция с чемпионатом и сборными' };
      state.results = [{ id: 1, ...published }];
      state.extraResults = [];
      state.favorites = [];
      state.db = [{ title: 'Совсем другой черновик', description: 'Картина маслом о море',
        finalTitle: published.title, finalDesc: published.description, region: 'Москва' }];
      return dupCheck(1, null).some(hit => hit.label.includes('История') && hit.score === 1);
    });
    t.ok('проверка дублей находит опубликованный финал', duplicate);

    const header = await page.evaluate(() => {
      return ['game', 'ai_sub', 'digital', 'gaming_sub', 'phys'].map(category => {
        const variant = { title: 'Текст', description: 'Тело объявления' };
        attachDigitalHeader(variant, category, false);
        attachDigitalHeader(variant, category, false);
        const physical = { description: 'Тело объявления' };
        attachDigitalHeader(physical, category, true);
        return [variant.description.split(DIGITAL_HEADER).length - 1, physical.description.startsWith(DIGITAL_HEADER)];
      });
    });
    t.eq('шапка один раз и только в трёх цифровых категориях', JSON.stringify(header),
      '[[1,false],[1,false],[1,false],[0,false],[0,false]]');

    const catalog = await page.evaluate(async () => {
      const product = 'Claude Pro';
      const remote = { prices: { '1 месяц': 2600 }, features: 'Projects' };
      const local = { prices: { '1 месяц': 2800 }, features: 'Claude Code' };
      state.form = { ...DEF_FORM, category: 'ai_sub', aiService: product, aiPrice: '1999', aiFeatures: 'Черновик' };
      catalogFormIsNew = false;
      syncFetch = async (doc, body) => !body ? { updated: 'rev-1', data: { products: { [product]: remote } } } : { conflict: true };
      saveCatalogPending(product, { before: remote, value: local });
      await syncProductCatalog();
      const active = state.form.aiPrice;
      const pending = readCatalogPending(product)?.value.prices['1 месяц'];
      forgetCatalogPending(product, readCatalogPending(product));
      const fresh = { ...state.form };
      applyCatalogProduct(fresh);
      const missing = { ...fresh, aiService: 'Claude Max' };
      applyCatalogProduct(missing);
      const other = { prices: { '1 месяц': 7300 }, features: 'Другая позиция' };
      let sent;
      syncFetch = async (doc, body) => {
        if (!body) return { updated: 'rev-2', data: { products: { [product]: remote, 'Claude Max': other } } };
        sent = body;
        return { updated: 'rev-3' };
      };
      saveCatalogPending(product, { before: remote, value: local });
      await syncProductCatalog();
      const stale = generationForm(fresh);
      const withOwn = generationForm({ ...fresh, aiPrice: '9999' });
      return { active, pending, fresh: [fresh.aiPrice, fresh.aiFeatures], missing: [missing.aiPrice, missing.aiFeatures],
        base: sent?.base, retained: sent?.data.products['Claude Max'].features, cleared: !readCatalogPending(product),
        stale: [stale.aiPrice, stale.aiFeatures], own: [withOwn.aiPrice, withOwn.aiFeatures] };
    });
    t.eq('обновление каталога не переписывает открытую форму', catalog.active, '1999');
    t.eq('отклонённая сервером правка остаётся в браузере', catalog.pending, 2800);
    t.eq('подстановка берёт подтверждённое предложение', catalog.fresh.join('|'), '2600|Projects');
    t.eq('у неизвестной позиции цена и характеристики пустые', catalog.missing.join('|'), '|');
    t.eq('сохранение отправляет прочитанную версию каталога', catalog.base, 'rev-2');
    t.eq('запись одного товара сохраняет соседний товар', catalog.retained, 'Другая позиция');
    t.ok('после подтверждённой записи очередь очищается', catalog.cleared);
    t.eq('прежняя подстановка обновляется при следующей генерации', catalog.stale.join('|'), '2800|Claude Code');
    t.eq('обновление сохраняет ручную цену и подтягивает свежие условия', catalog.own.join('|'), '9999|Claude Code');

    const sibling = await ctx.newPage();
    try {
      await sibling.goto(`${base}/avito-helper.html`, { waitUntil: 'domcontentloaded' });
      const value = { prices: { '1 месяц': 2500 } };
      await page.evaluate(item => saveCatalogPending('Claude Pro', { before: null, value: item }), value);
      await sibling.evaluate(item => saveCatalogPending('PS Plus Extra', { before: null, value: item }), value);
      const fromBoth = await page.evaluate(() => ['Claude Pro', 'PS Plus Extra'].map(name => readCatalogPending(name)?.value.prices['1 месяц']));
      t.eq('две вкладки сохраняют разные товары без перезаписи', fromBoth.join('|'), '2500|2500');
    } finally {
      await sibling.close();
    }
    t.eq('консоль чистая', consoleErrors.join('\n'), '');
  } finally {
    await ctx.close();
  }
}
