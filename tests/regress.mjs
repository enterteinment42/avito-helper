// Регресс: движок категорий не должен задеть остальной инструмент.
import { openApp, VARIANTS_JSON } from './lib.mjs';

// Один стаб на все пути: отвечает по форме запроса (варианты / заголовки).
const stubAll = page => page.evaluate(v => {
  window.__aiCalls = [];
  window.callAI = async (messages, opts = {}) => {
    window.__aiCalls.push({ text: messages.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n'), opts });
    const asked = window.__aiCalls[window.__aiCalls.length - 1].text;
    if (/НАЗВАНИЙ|заголовк/i.test(asked) && !/полное описание/i.test(asked)) {
      return JSON.stringify({ titles: [{ title: 'Заголовок 1', hook: 'крючок' }, { title: 'Заголовок 2', hook: 'цена' }] });
    }
    return v;
  };
}, VARIANTS_JSON);

const FORMS = {
  gaming_sub: { category: 'gaming_sub', platforms: ['PS4', 'PS5'] },
  ai_sub: { category: 'ai_sub', aiFeatures: 'Claude Code' },
  digital: { category: 'digital', digitalName: 'Office', digitalDesc: 'Пакет', digitalPrice: '1500' },
  game: { category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], gamePrice: '2000', gameGenre: 'Шутер' },
};

export async function runRegress(browser, base, t) {
  t.section('regress — остальной инструмент');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    for (const tab of ['generator', 'covers', 'queue', 'database', 'scanner', 'settings']) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(30);
      t.ok(`вкладка ${tab} рендерится`, await page.locator('main').innerHTML().then(h => h.length > 200));
    }
    await page.click('[data-tab="generator"]');
    await stubAll(page);

    // Генерация по каждой категории: штампы и автопроверка сканером
    for (const [id, form] of Object.entries(FORMS)) {
      const r = await page.evaluate(async f => {
        state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...f }));
        state.results = []; state.extraResults = [];
        await doGenerate();
        return {
          n: state.results.length,
          cat: state.results[0]?._category,
          product: state.results[0]?._product,
          scan: !!state.results[0]?._scan,
          snap: state.resultsForm?.category,
        };
      }, form);
      t.eq(`[${id}] сгенерировано вариантов`, r.n, 3);
      t.eq(`[${id}] штамп категории`, r.cat, id);
      t.ok(`[${id}] штамп товара непустой`, !!r.product && r.product !== '', r.product);
      t.ok(`[${id}] сканер отработал сразу`, r.scan);
      t.eq(`[${id}] снимок формы сделан`, r.snap, id);
    }

    // «Ещё варианты» — id не пересекаются с основным набором (Bug #11)
    const more = await page.evaluate(async () => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'] }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      await doGenerateMore();
      const ids = [...state.results, ...state.extraResults].map(v => v.id);
      return { ids, uniq: new Set(ids).size, own: state.extraResults.every(v => findResult(v.id) === v) };
    });
    t.eq('id основного и «Ещё вариантов» не пересекаются', more.uniq, more.ids.length);
    t.ok('findResult отдаёт именно свой вариант (Bug #11 не вернулся)', more.own);

    // Воронка заголовков
    const titles = await page.evaluate(async () => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'gaming_sub', platforms: ['PS5'] }));
      await doGenTitlesOnly();
      const n = state.titleStep?.titles.length || 0;
      // Выбор по id заголовка, не по индексу. Описаний будет ровно столько,
      // сколько названий выбрано — приложение режет ответ по числу выбранных.
      state.titleStep.selected = Object.fromEntries(state.titleStep.titles.map(t => [t.id, true]));
      await doGenDescriptionsForTitles();
      return { n, res: state.results.length, cat: state.results[0]?._category };
    });
    t.eq('шаг заголовков вернул заголовки', titles.n, 2);
    t.eq('описания сгенерированы по каждому выбранному заголовку', titles.res, 2);
    t.eq('штамп категории на них верный', titles.cat, 'gaming_sub');

    // Пакет по регионам
    const batch = await page.evaluate(async () => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'] }));
      state.batchMode = true; state.batchRegions = ['Москва', 'Казань'];
      state.batchResults = [];
      await doBatchGenerate();
      state.batchMode = false;
      return { n: state.batchResults.length, regions: state.batchResults.map(x => x.region).join(',') };
    });
    t.eq('пакет собран по числу регионов', batch.n, 2);
    t.eq('регионы на месте', batch.regions, 'Москва,Казань');

    // Перегенерация карточки берёт промпт из снимка формы, а не из живой
    const regen = await page.evaluate(async () => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'] }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      const id = state.results[0].id;
      state.form.gameName = 'ДРУГАЯ ИГРА'; // живую форму увели в сторону
      window.__aiCalls = [];
      await doRegen(id);
      const asked = window.__aiCalls[0]?.text || '';
      return { fromSnap: asked.includes('Doom') && !asked.includes('ДРУГАЯ ИГРА'), stamp: findResult(id)?._product };
    });
    t.ok('↻ строит промпт из снимка формы', regen.fromSnap);
    t.eq('и сохраняет штамп товара', regen.stamp, 'Doom');

    // Сканер и инфографика по всем категориям
    // checkAds отдаёт { errors, warnings, ok }
    const scan = await page.evaluate(() => ({
      forbidden: checkAds('Продам аккаунт', 'Пишите в телеграм', 'game').errors.length > 0,
      clean: checkAds('Doom для PS5', 'Игра оформляется в цифре на PS5', 'game').errors.length,
    }));
    t.ok('сканер ловит запрещённое', scan.forbidden);
    t.eq('и не ругается на чистый текст', scan.clean, 0);

    const infog = await page.evaluate(forms => {
      const out = {};
      for (const [id, f] of Object.entries(forms)) {
        state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...f }));
        out[id] = cvInfogBuildLines();
      }
      return out;
    }, FORMS);
    for (const id of Object.keys(FORMS)) t.ok(`инфографика заполняется для ${id}`, infog[id].length > 0, JSON.stringify(infog[id]));
    t.ok('у игры в инфографике нет цены', !infog.game.some(l => /₽/.test(l)), JSON.stringify(infog.game));

    const names = await page.evaluate(forms => {
      const out = {};
      for (const [id, f] of Object.entries(forms)) out[id] = currentProductName({ ...DEF_FORM, ...f });
      return out;
    }, FORMS);
    t.eq('название товара: игра', names.game, 'Doom');
    t.eq('название товара: подписка', names.gaming_sub, 'PS Plus Extra');

    // Распознавание по фото не разъехалось с формой
    const vision = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify(DEF_FORM));
      visionApplyToForm({ category: 'game', fields: { gameName: 'Cyberpunk 2077', gamePlatforms: ['PS5'], gameGenre: 'RPG' } });
      return { cat: state.form.category, name: state.form.gameName, plats: state.form.gamePlatforms.join(',') };
    });
    t.eq('vision выставил категорию', vision.cat, 'game');
    t.eq('vision заполнил название', vision.name, 'Cyberpunk 2077');
    t.eq('vision заполнил платформы', vision.plats, 'PS5');

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
