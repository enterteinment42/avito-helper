// Этап 3: категория управляет Сканером, SYS-промптом, распознаванием по фото,
// инфографикой и штампом товара.
import { openApp, VARIANTS_JSON } from './lib.mjs';

// Категория из конструктора: физтовар-подобная, со снятым запретом слов оплаты.
const PHYS = {
  id: 'u_phys', label: '🧷 Физический товар', pName: 'Физический товар',
  visionHint: 'физический товар из рук: консоли, геймпады, диски в коробке, техника.',
  scanRules: { payment: false, price_label: false },
  scanRequire: ['самовывоз'],
  scanForbid: ['краденый'],
  fields: [
    { key: 'u_name',  type: 'text',   label: 'Что продаём', p: 'Название', req: true, reqText: 'название товара', isName: true },
    { key: 'u_state', type: 'select', label: 'Состояние', options: ['Новое', 'Отличное', 'Б/у'], p: 'Состояние' },
    { key: 'u_kit',   type: 'chips',  label: 'Комплект', options: ['Коробка', 'Провод', 'Документы'], p: 'Комплект' },
    { key: 'u_note',  type: 'area',   label: 'Дефекты', p: 'Дефекты' },
    { key: 'u_price', type: 'num',    label: 'Цена, ₽', isPrice: true },
  ],
};

const install = (page, cat) => page.evaluate(c => {
  state.catsCfg = { builtin: {}, custom: [c] };
  rebuildCats(); save();
}, cat);

export async function runStage3(browser, base, t) {
  t.section('stage3 — категория правит Сканер, SYS, vision и инфографику');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await install(page, PHYS);

    // ── Сканер по правилам категории ────────────────────────
    const scan = await page.evaluate(() => {
      const bad = 'Платишь при встрече, купишь дёшево. Цена: 5000';
      return {
        phys: checkAds('Геймпад DualSense', bad + ' Самовывоз', 'u_phys'),
        game: checkAds('Геймпад DualSense', bad, 'game'),
        forbidden: checkAds('Геймпад', 'Не краденый, самовывоз', 'u_phys'),
        missing: checkAds('Геймпад', 'Отдам из рук в руки', 'u_phys'),
      };
    });
    t.ok('слова оплаты в физтоваре больше не замечание',
      !scan.phys.warnings.some(w => /Слова оплаты/.test(w)), JSON.stringify(scan.phys.warnings));
    t.ok('«Цена: N» в физтоваре тоже снята',
      !scan.phys.warnings.some(w => /Цена: N/.test(w)), JSON.stringify(scan.phys.warnings));
    t.ok('в игре те же слова по-прежнему ловятся',
      scan.game.warnings.some(w => /Слова оплаты/.test(w)), JSON.stringify(scan.game.warnings));
    t.ok('своё запрещённое слово категории ловится',
      scan.forbidden.errors.some(e => /краденый/.test(e)), JSON.stringify(scan.forbidden.errors));
    t.ok('своя обязательная фраза: есть — в «ок»',
      scan.forbidden.ok.some(o => /самовывоз/.test(o)), JSON.stringify(scan.forbidden.ok));
    t.ok('своя обязательная фраза: нет — предупреждение',
      scan.missing.warnings.some(w => /самовывоз/.test(w)), JSON.stringify(scan.missing.warnings));

    // Правило, выключенное по умолчанию, можно включить
    const forced = await page.evaluate(() => {
      state.catsCfg.custom[0].scanRules = { digital_phrase: true };
      rebuildCats();
      return checkAds('Геймпад', 'Обычное описание', 'u_phys').warnings;
    });
    t.ok('включённое вручную правило начинает работать',
      forced.some(w => /оформляется в цифре/.test(w)), JSON.stringify(forced));
    await install(page, PHYS); // возвращаем исходную настройку

    // ── SYS-промпт следует тем же галочкам ──────────────────
    const sys = await page.evaluate(() => ({
      phys: buildSys('u_phys'),
      game: buildSys('game'),
    }));
    t.ok('в SYS физтовара нет запрета слов оплаты', !/Слова оплаты/.test(sys.phys));
    t.ok('и нет запрета «цена» как ценника', !/Слово «цена» как ценник/.test(sys.phys));
    t.ok('но запрет «аккаунта» остался', /КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО/.test(sys.phys));
    t.ok('в SYS игры запрет слов оплаты на месте', /Слова оплаты/.test(sys.game));

    // Категория реально доезжает до вызова модели
    const passed = await page.evaluate(async v => {
      window.__calls = [];
      window.callAI = async (m, opts = {}) => { window.__calls.push(opts); return v; };
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'u_phys', u_name: 'DualSense' }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      return window.__calls[0]?.category;
    }, VARIANTS_JSON);
    t.eq('генерация передаёт категорию в callAI', passed, 'u_phys');

    // ── Штамп товара ────────────────────────────────────────
    const names = await page.evaluate(() => ({
      phys: currentProductName({ ...DEF_FORM, category: 'u_phys', u_name: 'DualSense v2' }),
      empty: currentProductName({ ...DEF_FORM, category: 'u_phys', u_name: '' }),
      game: currentProductName({ ...DEF_FORM, category: 'game', gameName: 'Doom' }),
    }));
    t.eq('название товара берётся из поля с флажком', names.phys, 'DualSense v2');
    t.eq('пустое поле — прежний фолбэк', names.empty, 'Товар');
    t.eq('встроенные категории не изменились', names.game, 'Doom');

    // ── Инфографика ─────────────────────────────────────────
    const infog = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify({
        ...DEF_FORM, category: 'u_phys', u_name: 'DualSense', u_state: 'Отличное',
        u_kit: ['Коробка', 'Провод'], u_note: 'Небольшая потёртость', u_price: '4500',
      }));
      return cvInfogBuildLines();
    });
    t.ok('инфографика собрана по дескриптору', infog.length >= 3, JSON.stringify(infog));
    t.eq('первая строка — название товара', infog[0], '📦 DualSense');
    t.eq('последняя строка — цена из поля с флажком', infog[infog.length - 1], '💲 4500₽');
    t.ok('чипы склеены через слэш', infog.some(l => l === '✔️ Коробка / Провод'), JSON.stringify(infog));

    // ── Распознавание по фото ───────────────────────────────
    const vs = await page.evaluate(() => visionSys());
    t.ok('промпт распознавания знает новую категорию', vs.includes('"u_phys"'));
    t.ok('и её подсказку', vs.includes('физический товар из рук'));
    t.ok('и перечисляет её поля с вариантами', /u_state \(Состояние\) — строго одно из: Новое, Отличное, Б\/у/.test(vs), vs.slice(0, 400));
    t.ok('поле цены в промпт распознавания не попадает', !vs.includes('u_price'));
    t.ok('встроенные категории тоже на месте', vs.includes('"gaming_sub"') && vs.includes('"game"'));

    const applied = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify(DEF_FORM));
      const warn = visionApplyToForm({
        category: 'u_phys',
        fields: { u_name: 'Геймпад DualSense', u_state: 'Б/у', u_kit: ['Коробка', 'Чужое'], u_note: 'Потёрт стик', u_price: 9999 },
      });
      return { warn, f: state.form };
    });
    t.eq('форма переключилась на новую категорию', applied.f.category, 'u_phys');
    t.eq('текстовое поле заполнено', applied.f.u_name, 'Геймпад DualSense');
    t.eq('select — из списка', applied.f.u_state, 'Б/у');
    t.eq('чипы отфильтрованы по списку', applied.f.u_kit.join(','), 'Коробка');
    // Ключа цены в форме просто не появляется — модель её не заполняет вовсе
    t.ok('цену модель подставить не может', !applied.f.u_price, String(applied.f.u_price));
    t.eq('предупреждения нет — поля заполнены', applied.warn, '');

    const price = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'u_phys' }));
      visionApplyPrice('4200');
      const phys = state.form.u_price;
      state.form.category = 'gaming_sub';
      return { phys, canSub: !!catPriceField('gaming_sub'), canPhys: !!catPriceField('u_phys') };
    });
    t.eq('рыночная цена ложится в поле с флажком', price.phys, '4200');
    t.eq('у подписки поля цены нет — кнопка не показывается', price.canSub, false);
    t.eq('у физтовара есть', price.canPhys, true);

    // ── Сканер: селект категорий ────────────────────────────
    await page.click('[data-tab="scanner"]');
    await page.waitForTimeout(50);
    const builtin = await page.evaluate(() => BUILTIN_CATS.length);
    t.eq('в селекте Сканера все категории', await page.locator('#scan-cat option').count(), builtin + 1);
    const optText = await page.locator('#scan-cat option[value="u_phys"]').innerText();
    t.ok('и видно, что у физтовара слова оплаты разрешены', /слова оплаты разрешены/.test(optText), optText);

    // ── Персист ─────────────────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const after = await page.evaluate(() => ({
      rule: scanRuleOn('u_phys', 'payment'),
      sys: /Слова оплаты/.test(buildSys('u_phys')),
      hint: visionSys().includes('физический товар из рук'),
    }));
    t.eq('правило пережило reload', after.rule, false);
    t.eq('SYS после reload тоже', after.sys, false);
    t.ok('подсказка распознавания пережила reload', after.hint);

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
