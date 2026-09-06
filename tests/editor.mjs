// Конструктор категорий (этап 2): реальные клики по редактору в Настройках.
import { openApp } from './lib.mjs';

const go = async (page, tab) => { await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(30); };
const pickCat = async (page, id) => { await page.selectOption('#cat-ed-sel', id); await page.waitForTimeout(30); };
const setDraft = (page, k, v) => page.fill(`#cat-editor-box [data-act="catd"][data-k="${k}"]`, v);
const fieldIdx = (page, key) => page.evaluate(k => state.catDraft.fields.findIndex(f => f.key === k), key);
const save = async (page) => { await page.click('[data-act="cat-ed-save"]'); await page.waitForTimeout(50); };
const stubDialogs = (page, { prompt = 'X', confirm = true } = {}) =>
  page.evaluate(([p, c]) => { window.prompt = () => p; window.confirm = () => c; }, [prompt, confirm]);

// Промпт по текущей форме — то, что реально уедет в модель
const promptFor = (page, form) => page.evaluate(f => {
  Math.random = () => 0.42;
  state.catalogs = {}; state.favorites = [];
  state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...f }));
  return { info: catInfoBlock(state.form), miss: validateForm().join(' | ') };
}, form);

export async function runEditor(browser, base, t) {
  t.section('editor — конструктор категорий');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // Число встроенных категорий берём из приложения: добавление новой (физтовар
    // на этапе 4) не должно ронять стенд на зашитой константе
    const BUILTIN = await page.evaluate(() => BUILTIN_CATS.length);

    await go(page, 'settings');
    t.ok('карточка «Категории товаров» на вкладке Настроек',
      await page.locator('#cat-editor-box').count() === 1);
    t.eq('в редакторе все встроенные категории',
      await page.locator('#cat-ed-sel option').count(), BUILTIN);

    // ── Правка встроенной категории ─────────────────────────
    await pickCat(page, 'game');
    await setDraft(page, 'label', '🕹️ Игра (диск)');
    await save(page);
    t.eq('переименование встроенной попало в CATS',
      await page.evaluate(() => CATS.find(c => c.id === 'game').label), '🕹️ Игра (диск)');
    t.eq('патч хранит только отличие',
      await page.evaluate(() => JSON.stringify(state.catsCfg.builtin.game)), '{"label":"🕹️ Игра (диск)"}');
    t.eq('pName в промпте не изменился',
      (await promptFor(page, { category: 'game', gameName: 'Doom' })).info.split('\n')[0], 'Категория: Игра');

    // Скрыть необязательное поле (жанр)
    await go(page, 'settings'); await pickCat(page, 'game');
    let i = await fieldIdx(page, 'gameGenre');
    await page.check(`[data-act="catf"][data-i="${i}"][data-k="hidden"]`);
    await save(page);
    const afterHide = await promptFor(page, { category: 'game', gameName: 'Doom', gameGenre: 'Шутер' });
    t.ok('скрытое поле ушло из промпта', !afterHide.info.includes('Жанр:'), afterHide.info);
    t.eq('скрытое поле не рисуется в форме',
      await page.evaluate(() => { state.form.category = 'game'; return (formHTML().match(/data-k="gameGenre"/g) || []).length; }), 0);

    // Снять обязательность
    await go(page, 'settings'); await pickCat(page, 'game');
    i = await fieldIdx(page, 'gamePlatforms');
    await page.uncheck(`[data-act="catf"][data-i="${i}"][data-k="req"]`);
    await save(page);
    t.eq('снятая обязательность убрала пункт из «Заполните…»',
      (await promptFor(page, { category: 'game', gameName: 'Doom', gamePlatforms: [] })).miss, '');

    // Обязательность у поля с кодовой проверкой снять нельзя
    await go(page, 'settings'); await pickCat(page, 'gaming_sub');
    i = await fieldIdx(page, 'durations');
    t.ok('чекбокс обязательности «Сроки и цены» заблокирован',
      await page.isDisabled(`[data-act="catf"][data-i="${i}"][data-k="req"]`));
    t.ok('кодовое поле нельзя скрыть',
      await page.locator(`[data-act="catf"][data-i="${i}"][data-k="hidden"]`).count() === 0);

    // Порядок полей
    await go(page, 'settings'); await pickCat(page, 'digital');
    i = await fieldIdx(page, 'digitalPrice');
    await page.click(`[data-act="cat-fld-up"][data-i="${i}"]`); await page.waitForTimeout(30);
    await save(page);
    t.eq('порядок полей изменился в дескрипторе',
      await page.evaluate(() => CATS.find(c => c.id === 'digital').fields.map(f => f.key).join(',')),
      'digitalName,digitalPrice,digitalDesc');
    const ord = await promptFor(page, { category: 'digital', digitalName: 'A', digitalDesc: 'B', digitalPrice: '10' });
    t.eq('порядок строк промпта следует порядку полей',
      ord.info, 'Категория: Цифровой товар\nНазвание: A\nЦена: 10 руб\nОписание: B');

    // Своё поле к встроенной категории
    await go(page, 'settings'); await pickCat(page, 'game');
    await page.click('[data-act="cat-fld-add"]'); await page.waitForTimeout(30);
    const last = await page.evaluate(() => state.catDraft.fields.length - 1);
    await page.selectOption(`[data-act="catf"][data-i="${last}"][data-k="type"]`, 'select');
    await page.waitForTimeout(30);
    await page.fill(`[data-act="catf"][data-i="${last}"][data-k="label"]`, 'Состояние');
    await page.fill(`[data-act="catf"][data-i="${last}"][data-k="options"]`, 'Новое\nБ/у');
    await save(page);
    const addedKey = await page.evaluate(() => CATS.find(c => c.id === 'game').fields.slice(-1)[0].key);
    const withExtra = await promptFor(page, { category: 'game', gameName: 'Doom', [addedKey]: 'Б/у' });
    t.ok('своё поле встроенной категории попало в промпт', withExtra.info.includes('Состояние: Б/у'), withExtra.info);
    t.ok('своё поле рисуется в форме',
      await page.evaluate(k => { state.form.category = 'game'; return formHTML().includes(`data-k="${k}"`); }, addedKey));

    // Сброс к заводской возвращает всё разом
    await go(page, 'settings'); await pickCat(page, 'game');
    await stubDialogs(page, { confirm: true });
    await page.click('[data-act="cat-reset"]'); await page.waitForTimeout(50);
    t.eq('сброс убрал патч', await page.evaluate(() => !!(state.catsCfg.builtin || {}).game), false);
    const reset = await promptFor(page, { category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], gameGenre: 'Шутер' });
    t.eq('после сброса промпт заводской',
      reset.info, 'Категория: Игра\nНазвание: Doom\nПлатформы: PS5\nЖанр: Шутер');
    t.eq('после сброса вернулась обязательность',
      (await promptFor(page, { category: 'game', gameName: '', gamePlatforms: [] })).miss, 'название игры | платформы');

    // ── Новая категория целиком ─────────────────────────────
    await go(page, 'settings');
    await stubDialogs(page, { prompt: '🧷 Физический товар' });
    await page.click('[data-act="cat-new"]'); await page.waitForTimeout(50);
    const newId = await page.evaluate(() => state.catEditId);
    t.ok('новая категория появилась в CATS', await page.evaluate(() => CATS.length) === BUILTIN + 1);
    await page.click('[data-act="cat-fld-add"]'); await page.waitForTimeout(30);
    const j = await page.evaluate(() => state.catDraft.fields.length - 1);
    await page.selectOption(`[data-act="catf"][data-i="${j}"][data-k="type"]`, 'chips');
    await page.waitForTimeout(30);
    await page.fill(`[data-act="catf"][data-i="${j}"][data-k="label"]`, 'Состояние');
    await page.fill(`[data-act="catf"][data-i="${j}"][data-k="options"]`, 'Новое\nОтличное\nБ/у');
    await page.check(`[data-act="catf"][data-i="${j}"][data-k="req"]`);
    await save(page);
    const custom = await promptFor(page, { category: newId, u_name: 'PS5 Slim', [await page.evaluate(id => CATS.find(c => c.id === id).fields[1].key, newId)]: ['Отличное'] });
    t.eq('промпт новой категории собран из её полей',
      custom.info, 'Категория: Физический товар\nНазвание: PS5 Slim\nСостояние: Отличное');
    t.eq('обязательные поля новой категории проверяются',
      (await promptFor(page, { category: newId, u_name: '' })).miss, 'название товара | состояние');
    t.ok('новая категория в селекте Генератора',
      await page.evaluate(id => { state.form.category = id; return formHTML().includes('Состояние'); }, newId));

    // Персист
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    t.eq('категория пережила reload', await page.evaluate(() => CATS.length), BUILTIN + 1);
    t.eq('её поля тоже', await page.evaluate(id => CATS.find(c => c.id === id).fields.length, newId), 2);

    // ── Экспорт / импорт JSON ───────────────────────────────
    await go(page, 'settings');
    const dl = page.waitForEvent('download');
    await page.click('[data-act="cat-json-export"]');
    const file = await dl;
    t.ok('экспорт отдаёт файл категорий', /avito-categories-\d{4}-\d{2}-\d{2}\.json/.test(file.suggestedFilename()),
      file.suggestedFilename());

    const exported = await page.evaluate(() => JSON.stringify(state.catsCfg));
    await page.evaluate(() => { state.catsCfg = { builtin: {}, custom: [] }; rebuildCats(); save(); render(); });
    t.eq('перед импортом остались только встроенные', await page.evaluate(() => CATS.length), BUILTIN);
    await stubDialogs(page, { confirm: true });
    await page.setInputFiles('#cat-json-file', { name: 'cats.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await page.waitForTimeout(80);
    t.eq('импорт вернул категории', await page.evaluate(() => CATS.length), BUILTIN + 1);
    t.ok('импорт вернул именно ту категорию', await page.evaluate(id => CATS.some(c => c.id === id), newId));

    // ── Удаление ────────────────────────────────────────────
    await go(page, 'settings'); await pickCat(page, newId);
    await page.evaluate(id => { state.form.category = id; save(); }, newId);
    await stubDialogs(page, { confirm: true });
    await page.click('[data-act="cat-del"]'); await page.waitForTimeout(50);
    t.eq('категория удалена', await page.evaluate(() => CATS.length), BUILTIN);
    t.ok('форма ушла с удалённой категории',
      await page.evaluate(id => state.form.category !== id, newId));

    // ── Находки код-ревью этапа 1 ───────────────────────────
    const stale = await page.evaluate(() => {
      state.form.category = 'gaming_sub';
      state.form.subType = 'Снятая с продажи подписка';
      const html = formHTML();
      return { warn: html.includes('больше не в списке'), disabled: html.includes('selected disabled') };
    });
    t.ok('select со значением не из списка предупреждает, а не подменяет молча', stale.warn && stale.disabled,
      JSON.stringify(stale));

    const unknown = await page.evaluate(() => {
      state.catsCfg.custom = [{ id: 'u_unk', label: 'Из будущего', pName: 'Из будущего',
        fields: [{ key: 'u_a', type: 'geopicker', label: 'Карта', req: true, p: 'Карта' }] }];
      rebuildCats();
      state.form.category = 'u_unk';
      return { html: formHTML().includes('не поддерживается этой версией'), miss: validateForm().join('|'), info: catInfoBlock(state.form) };
    });
    t.ok('неизвестный тип поля виден в форме плашкой', unknown.html);
    t.eq('и не требуется валидацией', unknown.miss, '');
    t.ok('и не уходит в промпт', !unknown.info.includes('Карта'), unknown.info);

    const shadow = await page.evaluate(() => {
      state.catsCfg.custom = [{ id: 'game', label: 'Подделка', fields: [] }];
      rebuildCats();
      return { len: CATS.length, gameLabel: CATS.find(c => c.id === 'game').label };
    });
    t.eq('пользовательская категория не затеняет встроенную', shadow.gameLabel, '🕹️ Игра');
    t.eq('и не добавляется дубликатом', shadow.len, BUILTIN);

    const broken = await page.evaluate(() => {
      state.catsCfg.custom = [{ id: 'u_broken', label: 'Битая' }]; // без fields
      rebuildCats();
      state.form.category = 'u_broken';
      return { fields: catDef('u_broken').fields.length, html: formHTML().length > 0, miss: validateForm().length };
    });
    t.eq('дескриптор без fields не роняет форму', broken.fields, 0);
    t.ok('форма всё равно рендерится', broken.html);

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
