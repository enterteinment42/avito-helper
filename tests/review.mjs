// Находки код-ревью этапов 2-4 — каждая закреплена тестом, чтобы не вернулась.
import { openApp } from './lib.mjs';

export async function runReview(browser, base, t) {
  t.section('review — закрытые находки код-ревью');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // 1. Пользовательский toggle не должен слать «Торг: false» в промпт
    const toggle = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [{
        id: 'u_t', label: 'С тумблером', pName: 'С тумблером',
        fields: [
          { key: 'u_name', type: 'text', label: 'Название', p: 'Название', isName: true },
          { key: 'u_flag', type: 'toggle', label: 'Торг', p: 'Торг' },
        ],
      }] };
      rebuildCats();
      const off = catInfoBlock({ ...DEF_FORM, category: 'u_t', u_name: 'Вещь', u_flag: false });
      const on  = catInfoBlock({ ...DEF_FORM, category: 'u_t', u_name: 'Вещь', u_flag: true });
      const name = currentProductName({ ...DEF_FORM, category: 'u_t', u_name: 'Вещь', u_flag: false });
      return { off, on, name };
    });
    t.ok('выключенный тумблер не пишет «false» в промпт', !/false/.test(toggle.off), toggle.off);
    t.ok('и вообще молчит', !/Торг/.test(toggle.off), toggle.off);
    t.ok('включённый тумблер называет себя', /Торг: да/.test(toggle.on), toggle.on);
    t.eq('штамп товара не подменяется булевым полем', toggle.name, 'Вещь');

    // 2. Название категории — пользовательский текст, в разметку идёт экранированным
    const esc = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [{
        id: 'u_x', label: '<img src=x onerror="window.__pwned=1">', pName: 'X',
        fields: [{ key: 'u_n', type: 'text', label: 'Имя', p: 'Имя', isName: true }],
      }] };
      rebuildCats();
      state.form.category = 'u_x';
      render();
      return {
        pwned: !!window.__pwned,
        imgs: document.querySelectorAll('#form-box img').length,
        inSelect: !!document.querySelector('[data-act="cat"] option[value="u_x"]'),
      };
    });
    t.eq('скрипт из названия категории не выполнился', esc.pwned, false);
    t.eq('и разметка не вставилась', esc.imgs, 0);
    t.ok('категория при этом в селекте есть', esc.inSelect);

    // 3. Очистка pName / подсказки распознавания у встроенной категории применяется
    const cleared = await page.evaluate(() => {
      state.catsCfg = { builtin: { game: { pName: '', visionHint: '' } }, custom: [] };
      rebuildCats();
      const draft = catDraftFor('game');
      return {
        vision: visionSys().includes('ЦИФРОВАЯ игра (обложка игры'),
        draftHint: draft.visionHint,
        draftPName: draft.pName,
        // pName пуст — в промпте остаётся видимое имя категории, а не заводское
        info: catInfoBlock({ ...DEF_FORM, category: 'game', gameName: 'Doom' }).split('\n')[0],
      };
    });
    t.eq('очищенная подсказка распознавания не возвращается', cleared.vision, false);
    t.eq('редактор показывает её пустой, а не заводской', cleared.draftHint, '');
    t.eq('очищенный pName тоже остаётся пустым', cleared.draftPName, '');
    t.ok('промпт при этом не ломается', cleared.info.startsWith('Категория:'), cleared.info);

    // 4. Инфографика не рисует цену там, где категория запрещает её в тексте
    const infog = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [{
        id: 'u_p', label: 'С ценой', pName: 'С ценой',
        scanRules: { game_price: true },
        fields: [
          { key: 'u_n', type: 'text', label: 'Имя', p: 'Имя', isName: true },
          { key: 'u_pr', type: 'num', label: 'Цена', isPrice: true },
        ],
      }] };
      rebuildCats();
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'u_p', u_n: 'Вещь', u_pr: '900' }));
      const banned = cvInfogBuildLines();
      state.catsCfg.custom[0].scanRules = { game_price: false };
      rebuildCats();
      const allowed = cvInfogBuildLines();
      return { banned, allowed };
    });
    t.ok('цена не идёт на обложку при запрете', !infog.banned.some(l => /₽/.test(l)), JSON.stringify(infog.banned));
    t.ok('и идёт, когда категория её разрешает', infog.allowed.some(l => l === '💲 900₽'), JSON.stringify(infog.allowed));

    // 5. Значение select вне списка не уезжает в промпт и блокирует генерацию
    const stale = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [] };
      rebuildCats();
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'gaming_sub', subType: 'Снятая подписка', platforms: ['PS5'] }));
      return {
        info: catInfoBlock(state.form),
        miss: validateForm().join(' | '),
        warned: formHTML().includes('больше не в списке'),
      };
    });
    t.ok('устаревшее значение не уходит в промпт', !/Снятая подписка/.test(stale.info), stale.info);
    t.ok('форма о нём предупреждает', stale.warned);

    // Если такое поле обязательное — генерация не запускается вовсе
    const staleReq = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [{
        id: 'u_s', label: 'С выбором', pName: 'С выбором',
        fields: [{ key: 'u_st', type: 'select', label: 'Состояние', options: ['Новое', 'Б/у'],
          p: 'Состояние', req: true, reqText: 'состояние' }],
      }] };
      rebuildCats();
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'u_s', u_st: 'Убранное значение' }));
      return { miss: validateForm().join(' | '), info: catInfoBlock(state.form) };
    });
    t.eq('обязательное поле с чужим значением считается незаполненным', staleReq.miss, 'состояние');
    t.ok('и в промпт оно тоже не идёт', !/Убранное значение/.test(staleReq.info), staleReq.info);

    // Валидное значение по-прежнему проходит насквозь
    const okVal = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'gaming_sub', platforms: ['PS5'] }));
      return { info: catInfoBlock(state.form), miss: validateForm().join(' | ') };
    });
    t.ok('обычное значение select в промпте', /Тип: PS Plus Extra/.test(okVal.info), okVal.info);
    t.eq('и валидация молчит', okVal.miss, '');

    // 6. Запрет штампа «Продаю…» (решение Дениса после живой проверки 2026-09-07)
    const selling = await page.evaluate(() => {
      state.catsCfg = { builtin: {}, custom: [] };
      rebuildCats();
      const w = (title, desc, cat) => checkAds(title, desc, cat).warnings.join(' | ');
      return {
        sell:  w('Продаю PS5', 'Отличная консоль', 'phys'),
        sell2: w('PS5 недорого', 'Продам сегодня', 'game'),
        sell3: w('PS5', 'Продаётся консоль', 'gaming_sub'),
        // Соседние слова того же корня — не штамп, ругаться не должны
        clean: w('PS5 белая', 'В продаже есть и другие игры, продавец на связи. Распродаю библиотеку.', 'phys'),
        sys:   buildSys('phys'),
        sysGame: buildSys('game'),
      };
    });
    t.ok('«Продаю» в названии — предупреждение', /штамп/.test(selling.sell), selling.sell);
    t.ok('«Продам» в описании тоже', /штамп/.test(selling.sell2), selling.sell2);
    t.ok('«Продаётся» тоже', /штамп/.test(selling.sell3), selling.sell3);
    t.ok('«в продаже», «продавец», «распродаю» — не штамп', !/штамп/.test(selling.clean), selling.clean);
    t.ok('запрет попал в SYS физтовара', /«Продаю», «продам», «прода/.test(selling.sys));
    t.ok('и в SYS игры', /«Продаю», «продам», «прода/.test(selling.sysGame));

    // 7. Распознавание: версию, различимую по корпусу, называть можно
    const vs = await page.evaluate(() => visionSys());
    t.ok('промпт разрешает называть различимую ревизию', /не ленись разглядывать/.test(vs));
    t.ok('и по-прежнему запрещает выдумывать невидимое', /НЕ додумывай объём памяти/.test(vs));
    t.ok('требует сначала описать увиденное, потом назвать модель', /СНАЧАЛА опиши в recognized/.test(vs));
    t.ok('признак PS5 Pro доехал до промпта', /ТРИ чёрные полосы-прорези/.test(vs));
    t.ok('Slim отделён от Pro явным условием', /Slim» пиши, только если стык виден, а прорезей нет/.test(vs));
    t.ok('и есть выход «не разглядеть — не угадывай»', /не угадывай между версиями/.test(vs));
    t.ok('подсказка приехала из дескриптора категории, а не из кода промпта',
      await page.evaluate(() => BUILTIN_CATS.find(c => c.id === 'phys').visionHint.includes('ТРИ чёрные полосы')));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
