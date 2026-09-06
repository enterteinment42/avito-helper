// Этап 4: встроенная категория «Физический товар» поверх готового движка.
// Своих веток в коде у неё нет — проверяем, что дескриптор действительно
// собирает форму, промпт, Сканер, SYS, инфографику и распознавание.
import { openApp, VARIANTS_JSON } from './lib.mjs';

const FULL = {
  category: 'phys', physName: 'Геймпад DualSense', physState: 'Хорошее',
  physKit: ['Коробка', 'Провода'], physDefects: 'Потёртость на левом стике',
  physWarranty: 'осталось 8 месяцев', physReason: 'перешёл на PS5',
  physPrice: '4500', physBargain: true, physDelivery: false,
};

const promptFor = (page, form) => page.evaluate(f => {
  Math.random = () => 0.42;
  state.catalogs = {}; state.favorites = [];
  state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...f }));
  return { info: catInfoBlock(state.form), miss: validateForm().join(' | ') };
}, form);

export async function runPhys(browser, base, t) {
  t.section('phys — категория «Физический товар»');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // ── Есть ли она вообще ──────────────────────────────────
    t.ok('категория встроена в CATS', await page.evaluate(() => CATS.some(c => c.id === 'phys')));
    t.eq('и не требует ничего в localStorage',
      await page.evaluate(() => localStorage.getItem('avito_cats')), null);

    const form = await page.evaluate(() => {
      state.form.category = 'phys';
      const html = formHTML();
      return {
        keys: CATS.find(c => c.id === 'phys').fields.map(f => f.key),
        rendered: CATS.find(c => c.id === 'phys').fields.every(f => html.includes(`data-k="${f.key}"`)),
        hasStates: html.includes('Б/у с дефектами'),
        hasKit: html.includes('Гарантийный талон'),
      };
    });
    t.eq('поля категории на месте', form.keys.join(','),
      'physName,physState,physKit,physDefects,physWarranty,physReason,physPrice,physBargain,physDelivery');
    t.ok('все поля рисуются формой', form.rendered);
    t.ok('варианты состояния подставлены', form.hasStates);
    t.ok('варианты комплектации подставлены', form.hasKit);

    // ── Промпт ──────────────────────────────────────────────
    const full = await promptFor(page, FULL);
    t.ok('название в промпте', full.info.includes('Название: Геймпад DualSense'), full.info);
    t.ok('состояние в промпте', full.info.includes('Состояние: Хорошее'), full.info);
    t.ok('комплектация склеена', full.info.includes('Комплектация: Коробка, Провода'), full.info);
    t.ok('дефекты в промпте', full.info.includes('Дефекты и износ: Потёртость на левом стике'), full.info);
    t.ok('гарантия и причина продажи', full.info.includes('Гарантия: осталось 8 месяцев') && full.info.includes('Причина продажи: перешёл на PS5'));
    t.ok('включённый торг даёт строку', full.info.includes('Торг: уместен'), full.info);
    t.ok('выключенная доставка строки не даёт', !full.info.includes('Авито-доставка'), full.info);
    t.ok('цена в промпт НЕ идёт', !/4500/.test(full.info), full.info);
    t.ok('правило категории приложено', full.info.includes('ФИЗИЧЕСКАЯ ВЕЩЬ ИЗ РУК В РУКИ'), full.info.slice(-300));
    t.ok('и запрещает «оформляется»', full.info.includes('НЕ используй «оформляется»'));

    const empty = await promptFor(page, { category: 'phys', physName: '', physState: '', physKit: [] });
    t.eq('обязательны название и состояние', empty.miss, 'название товара | состояние');
    t.ok('пустые дефекты подсказывают не выдумывать',
      empty.info.includes('Дефекты и износ: (продавец не указал — не выдумывай)'), empty.info);

    // ── Сканер ──────────────────────────────────────────────
    const scan = await page.evaluate(() => ({
      pay: checkAds('Геймпад DualSense', 'Можно купить сегодня, оплата при встрече.', 'phys'),
      price: checkAds('Геймпад DualSense за 4500₽', 'Отдам за 4500 руб.', 'phys'),
      plain: checkAds('Геймпад DualSense', 'Пользовался год, потёртость на стике. Заберёшь на районе.', 'phys'),
      acc: checkAds('Геймпад', 'Отдам, аккаунт не нужен', 'phys'),
      gamePay: checkAds('Doom пс5', 'Можно купить сегодня, оплата при встрече.', 'game'),
    }));
    t.eq('слова оплаты в физтоваре разрешены',
      scan.pay.warnings.filter(w => /Слова оплаты/.test(w)).length, 0);
    t.ok('в игре они по-прежнему замечание', scan.gamePay.warnings.some(w => /Слова оплаты/.test(w)));
    t.ok('цена в названии — ошибка', scan.price.errors.some(e => /Цена в названии/.test(e)), JSON.stringify(scan.price.errors));
    t.ok('и формулировка не про игры', scan.price.errors.some(e => /в этой категории ЗАПРЕЩЕНА/.test(e)), JSON.stringify(scan.price.errors));
    t.ok('цена в описании — ошибка', scan.price.errors.some(e => /Цена в описании/.test(e)), JSON.stringify(scan.price.errors));
    t.eq('платформа не требуется',
      scan.plain.warnings.filter(w => /Платформа не упомянута/.test(w)).length, 0);
    t.eq('«оформляется в цифре» не требуется',
      scan.plain.warnings.filter(w => /оформляется в цифре/.test(w)).length, 0);
    t.eq('чистое объявление проходит без замечаний', scan.plain.errors.length + scan.plain.warnings.length, 0,
      JSON.stringify([scan.plain.errors, scan.plain.warnings]));
    t.ok('«аккаунт» остаётся ошибкой и здесь', scan.acc.errors.some(e => /аккаунт/i.test(e)));

    // Косвенные падежи «аккаунта» и «профиля» — раньше проходили мимо Сканера
    const cases = await page.evaluate(() => {
      const hit = (t, d) => checkAds(t, d, 'phys').errors.join(' | ');
      return {
        acc2: hit('Геймпад', 'Продам вместе с аккаунтом'),
        acc3: hit('Геймпад', 'Без передачи аккаунта'),
        acc4: hit('Геймпад', 'Свои аккаунты не отдаю'),
        rec:  hit('Геймпад', 'Данные учётной записи не передаю'),
        prof: hit('Геймпад', 'Доступ к профилю не даю'),
        // Ложные срабатывания: эти слова к продаже аккаунтов отношения не имеют
        falseProf: hit('Труба', 'Профилактика раз в год, профильная труба 40х20'),
      };
    });
    t.ok('«аккаунтом» ловится', /аккаунт/.test(cases.acc2), cases.acc2);
    t.ok('«аккаунта» ловится', /аккаунт/.test(cases.acc3), cases.acc3);
    t.ok('«аккаунты» ловится', /аккаунт/.test(cases.acc4), cases.acc4);
    t.ok('«учётной записи» ловится', /Учётная запись/.test(cases.rec), cases.rec);
    t.ok('«профилю» ловится', /профиль/.test(cases.prof), cases.prof);
    t.eq('«профилактика» и «профильная» не ложатся в ошибки', cases.falseProf, '');

    // ── SYS ─────────────────────────────────────────────────
    const sys = await page.evaluate(() => buildSys('phys'));
    t.ok('в SYS физтовара нет запрета слов оплаты', !/Слова оплаты/.test(sys));
    t.ok('запрет «аккаунта» остался', /КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО/.test(sys));
    t.ok('запрет «подарка» остался', /«В подарок»/.test(sys));

    // ── Штамп, инфографика ──────────────────────────────────
    t.eq('штамп товара из physName',
      await page.evaluate(f => currentProductName({ ...DEF_FORM, ...f }), FULL), 'Геймпад DualSense');

    const infog = await page.evaluate(f => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...f }));
      return cvInfogBuildLines();
    }, FULL);
    t.eq('инфографика начинается с товара', infog[0], '📦 Геймпад DualSense');
    t.eq('и заканчивается ценой', infog[infog.length - 1], '💲 4500₽');
    t.ok('состояние попало в плашки', infog.some(l => l === '✔️ Хорошее'), JSON.stringify(infog));

    // ── Распознавание по фото ───────────────────────────────
    const vs = await page.evaluate(() => visionSys());
    t.ok('промпт распознавания знает физтовар', vs.includes('"phys"'));
    t.ok('и объясняет, что это вещь из рук', vs.includes('ФИЗИЧЕСКАЯ вещь из рук в руки'));
    t.ok('перечисляет состояния', vs.includes('Б/у с дефектами'));
    t.ok('«цифровой товар» больше не про физические вещи',
      /"digital" — ЦИФРОВОЙ товар/.test(vs) && !/"digital"[^]*?включая физические/.test(vs));
    t.ok('поле цены физтовара в промпт не идёт', !vs.includes('physPrice'));
    t.ok('тумблеры в промпт распознавания не идут', !vs.includes('physBargain'));

    const applied = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify(DEF_FORM));
      const warn = visionApplyToForm({
        category: 'phys',
        fields: {
          physName: 'Геймпад DualSense белый', physState: 'Хорошее',
          physKit: ['Коробка', 'Ключи от машины'], physDefects: 'Потёрт стик',
        },
      });
      return { warn, f: state.form };
    });
    t.eq('форма переключилась на физтовар', applied.f.category, 'phys');
    t.eq('название заполнено', applied.f.physName, 'Геймпад DualSense белый');
    t.eq('состояние — из списка', applied.f.physState, 'Хорошее');
    t.eq('лишнее из комплектации отброшено', applied.f.physKit.join(','), 'Коробка');
    t.eq('предупреждения нет', applied.warn, '');

    t.eq('рыночная цена ложится в physPrice', await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'phys' }));
      visionApplyPrice('4200');
      return state.form.physPrice;
    }), '4200');

    // ── Генерация целиком ───────────────────────────────────
    const gen = await page.evaluate(async v => {
      window.__calls = [];
      window.callAI = async (m, opts = {}) => {
        window.__calls.push({ text: m.map(x => x.content).join('\n'), opts });
        return v;
      };
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'phys', physName: 'Геймпад DualSense' }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      return {
        n: state.results.length, cat: state.results[0]?._category, product: state.results[0]?._product,
        passed: window.__calls[0]?.opts.category, scan: !!state.results[0]?._scan,
        asked: window.__calls[0]?.text || '',
      };
    }, VARIANTS_JSON);
    t.eq('генерация по физтовару отработала', gen.n, 3);
    t.eq('штамп категории', gen.cat, 'phys');
    t.eq('штамп товара', gen.product, 'Геймпад DualSense');
    t.eq('категория доехала до callAI', gen.passed, 'phys');
    t.ok('автопроверка сканером прошла', gen.scan);
    t.ok('промпт содержит блок категории', gen.asked.includes('Категория: Физический товар'));

    // ── Правка и сброс ──────────────────────────────────────
    const patched = await page.evaluate(() => {
      state.catsCfg.builtin = { phys: { fields: { physReason: { hidden: true } }, scanRules: { gift: false } } };
      rebuildCats(); save();
      return {
        fields: CATS.find(c => c.id === 'phys').fields.length,
        gift: scanRuleOn('phys', 'gift'),
        pay: scanRuleOn('phys', 'payment'), // заводское значение не должно потеряться
      };
    });
    t.eq('скрытое поле убралось', patched.fields, 8);
    t.eq('снятое правило снято', patched.gift, false);
    t.eq('а заводское снятие слов оплаты уцелело', patched.pay, false);

    const restored = await page.evaluate(() => {
      delete state.catsCfg.builtin.phys;
      rebuildCats(); save();
      return { fields: CATS.find(c => c.id === 'phys').fields.length, gift: scanRuleOn('phys', 'gift') };
    });
    t.eq('сброс вернул поле', restored.fields, 9);
    t.eq('и правило', restored.gift, true);

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
