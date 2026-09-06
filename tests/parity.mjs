// Паритет промпта: текущая версия против git HEAD на 12 формах.
// Промпты генерации вылизаны десятком сессий — рефакторинг движка категорий
// не имеет права изменить в них ни байта, пока это не сделано осознанно.
import { openApp } from './lib.mjs';

const CATALOG = {
  'PS Plus Extra': {
    core: ['GTA 5 | ГТА 5', 'Человек Паук 2 | Spider-Man 2'],
    masking: ['Doom Eternal', 'Far Cry 6', 'Hogwarts Legacy', 'Skyrim'],
  },
};

export const CASES = [
  { name: 'gaming_sub: полная', form: { category: 'gaming_sub', platforms: ['PS4', 'PS5'] } },
  { name: 'gaming_sub: без цен', form: { category: 'gaming_sub', platforms: ['PS5'], durations: [{ period: '1 месяц', price: '' }] } },
  { name: 'gaming_sub: пустая', form: { category: 'gaming_sub', platforms: [], durations: [], games: '' } },
  { name: 'gaming_sub: с каталогом', form: { category: 'gaming_sub', platforms: ['PS4'] }, catalogs: CATALOG },
  { name: 'gaming_sub: каталог + пустой games', form: { category: 'gaming_sub', platforms: ['PS4'], games: '' }, catalogs: CATALOG },
  { name: 'ai_sub: полная', form: { category: 'ai_sub', aiFeatures: 'Claude Code, Projects, Artifacts' } },
  { name: 'ai_sub: без фич', form: { category: 'ai_sub', aiFeatures: '' } },
  { name: 'ai_sub: без цены', form: { category: 'ai_sub', aiPrice: '', aiFeatures: 'Deep Research' } },
  { name: 'digital: полная', form: { category: 'digital', digitalName: 'Office 2024', digitalDesc: 'Полный пакет', digitalPrice: '1500' } },
  { name: 'digital: пустая', form: { category: 'digital', digitalName: '', digitalDesc: '', digitalPrice: '' } },
  { name: 'game: полная', form: { category: 'game', gameName: 'Cyberpunk 2077', gamePlatforms: ['PS4', 'PS5'], gamePrice: '2500', gameGenre: 'RPG' } },
  { name: 'game: предзаказ', form: { category: 'game', gameName: 'GTA 6', gamePlatforms: ['PS5'], gamePrice: '5000', gameGenre: 'Экшн', isPreorder: true } },
  { name: 'game: пустая', form: { category: 'game', gameName: '', gamePlatforms: [], gamePrice: '', gameGenre: '' } },
  { name: 'неизвестная категория', form: { category: 'нет-такой' } },
];

// Осознанные отличия от baseline. Всё, чего здесь нет, обязано совпадать
// байт-в-байт: список правится только вместе с решением изменить поведение.
const EXPECTED_SYS_LINES = [
  // Запрет штампа «Продаю…» — по прямому решению Дениса (2026-09-07)
  '- «Продаю», «продам», «продаётся» — ЗАПРЕЩЕНО и в названии, и в описании. Так начинает половина Авито, объявление сразу теряется. Начинай с самого товара, выгоды или живой детали',
];
const EXPECTED_SCAN_LABELS = [
  '«Продаю»/«продам» — штамп: начинай сразу с товара и его пользы',
];

// Тексты для сравнения Сканера: каждый бьёт по своему правилу.
const SCAN_CASES = [
  ['Doom для PS5', 'Игра оформляется в цифре на PS5. Отличный шутер.'],
  ['Продам аккаунт PS Plus', 'Пишите в телеграм, дам профиль. Цена: 3000'],
  ['PS Plus Extra 12 мес 3000 руб', 'Платишь один раз, подарок другу. https://example.com'],
  ['Cyberpunk 2077 пс5 — 2500₽', 'Оформляется в цифре. Стоит 2500 рублей.'],
  ['', ''],
];

// Системный промпт: категория теперь может выключать запреты, но при заводских
// настройках текст обязан остаться прежним байт-в-байт.
function sysSnapshot(page, cats) {
  return page.evaluate(ids => {
    const out = {};
    for (const id of ids) {
      // Старая версия не знает buildSys — там просто SYS
      out[id] = typeof buildSys === 'function' ? buildSys(id) : SYS;
    }
    out.__none = typeof buildSys === 'function' ? buildSys(null) : SYS;
    return out;
  }, cats);
}

function scanSnapshot(page, cases, drop = []) {
  return page.evaluate(([cs, skip]) => {
    const out = [];
    for (const id of ['gaming_sub', 'ai_sub', 'digital', 'game']) {
      for (const [title, desc] of cs) {
        const r = checkAds(title, desc, id);
        const keep = arr => arr.filter(x => !skip.includes(x));
        out.push(`${id} | ${title} :: E[${keep(r.errors).join('; ')}] W[${keep(r.warnings).join('; ')}] OK[${keep(r.ok).join('; ')}]`);
      }
    }
    return out;
  }, [cases, drop]);
}

// Снимаем промпт и валидацию настоящими функциями приложения.
async function snapshot(page) {
  return page.evaluate(cases => {
    // Каталог игр и few-shot рандомизируются — фиксируем, иначе сравнивать нечего
    Math.random = () => 0.42;
    const out = [];
    for (const c of cases) {
      state.catalogs = c.catalogs ? JSON.parse(JSON.stringify(c.catalogs)) : {};
      state.favorites = [];
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, ...c.form }));
      out.push({
        name: c.name,
        info: catInfoBlock(state.form),
        msg: buildMsg(),
        miss: validateForm().join(' | '),
      });
    }
    return out;
  }, cases_serializable());
}

function cases_serializable() { return CASES.map(c => ({ name: c.name, form: c.form, catalogs: c.catalogs || null })); }

export async function runParity(browser, base, t) {
  t.section('parity — промпт и валидация против git HEAD');
  const cur = await openApp(browser, `${base}/avito-helper.html`);
  const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
  try {
    const a = await snapshot(cur.page);
    const b = await snapshot(old.page);
    t.eq('число форм совпало', a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      t.ok(`[${a[i].name}] блок категории идентичен`, a[i].info === b[i].info,
        `новый:\n${a[i].info}\n---\nстарый:\n${b[i].info}`);
      t.ok(`[${a[i].name}] полный промпт идентичен`, a[i].msg === b[i].msg,
        `новый:\n${a[i].msg}\n---\nстарый:\n${b[i].msg}`);
      t.ok(`[${a[i].name}] валидация идентична`, a[i].miss === b[i].miss,
        `новая: ${a[i].miss}\n        старая: ${b[i].miss}`);
    }
    // Системный промпт при заводских настройках категорий
    const ids = ['gaming_sub', 'ai_sub', 'digital', 'game'];
    const sysA = await sysSnapshot(cur.page, ids);
    const sysB = await sysSnapshot(old.page, ids);
    for (const id of [...ids, '__none']) {
      // Из нового промпта вычитаем строки, которые добавлены осознанно, —
      // всё остальное обязано совпасть дословно
      const stripped = sysA[id].split('\n').filter(l => !EXPECTED_SYS_LINES.includes(l)).join('\n');
      t.ok(`[SYS ${id}] системный промпт идентичен (кроме заявленных строк)`, stripped === sysB[id],
        `длины: новый ${stripped.length}, старый ${sysB[id]?.length}`);
      t.ok(`[SYS ${id}] заявленная строка действительно добавлена`,
        EXPECTED_SYS_LINES.every(l => sysA[id].includes(l)));
    }

    // Сканер: набор правил стал категорийным, но заводское поведение обязано совпасть
    const scanA = await scanSnapshot(cur.page, SCAN_CASES, EXPECTED_SCAN_LABELS);
    const scanB = await scanSnapshot(old.page, SCAN_CASES);
    t.eq('число проверок сканера совпало', scanA.length, scanB.length);
    let scanDiff = 0;
    for (let i = 0; i < scanA.length; i++) if (scanA[i] !== scanB[i]) scanDiff++;
    t.ok('вердикты Сканера идентичны во всех категориях', scanDiff === 0,
      scanA.filter((s, i) => s !== scanB[i]).map((s, i) => `новый: ${s}`).join('\n        '));

    t.ok('консоль чистая (текущая версия)', cur.consoleErrors.length === 0, cur.consoleErrors.join('\n'));
  } finally {
    await cur.ctx.close(); await old.ctx.close();
  }
}
