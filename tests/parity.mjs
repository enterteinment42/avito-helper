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
    t.ok('консоль чистая (текущая версия)', cur.consoleErrors.length === 0, cur.consoleErrors.join('\n'));
  } finally {
    await cur.ctx.close(); await old.ctx.close();
  }
}
