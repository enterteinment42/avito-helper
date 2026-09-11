// Секция backup — полный бэкап (v3) и обратная совместимость импорта.
// Сырьё эталонов невосполнимо: localStorage живёт до чистки данных сайта и не
// существует на втором устройстве. Проверяем, что в файл попадает ВСЁ накопленное,
// что токен туда не попадает, и что импорт восстанавливает это на чистом браузере,
// не ломая два старых формата файла (голый массив и {db, refs}).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp } from './lib.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'avito-backup-'));

// Данные «рабочего» устройства: по одной штуке каждого вида + секрет
const SEED = {
  avito_db: [{ id: 1, product: 'PS Plus Extra', region: 'Москва', title: 'Т1', description: 'Д1', status: 'active', note: '', date: '01.09.2026' }],
  avito_refs: [
    { id: 11, source: 'mine',  category: 'gaming_sub', title: 'Моё объявление', desc: 'Мой текст', date: '01.09.2026' },
    { id: 12, source: 'other', category: 'game', title: 'Чужое', desc: 'Чужой текст', tricks: ['начинает с вопроса'], date: '01.09.2026' },
  ],
  avito_favorites: [{ _fid: 21, title: 'Избранный', description: 'Текст избранного', _category: 'gaming_sub' }],
  avito_presets: [{ id: 31, name: 'Пресет А', form: { category: 'game', gameName: 'GTA 5' }, date: '01.09.2026' }],
  avito_queue: [{ id: 41, product: 'PS Plus Extra', region: 'Казань', source: 'fav', favId: 21, form: null }],
  avito_cats: { builtin: { game: { label: '🎮 Игры (правлено)' } }, custom: [{ id: 'my_cat', label: 'Моя категория', fields: [] }] },
  avito_catalogs: { 'PS Plus Extra': 'GTA 5\nHogwarts' },
  avito_settings: { provider: 'claude', model: 'claude-sonnet-5', pageName: 'Рабочая страница' },
  avito_cv: { bg: '#123456', padding: 33, ratio: '1:1' },
  avito_admin_token: 'SECRET-TOKEN-12345',
};

// Ответы на confirm() по порядку: [слить/заменить, восстановить настройки?]
async function answerConfirms(page, answers) {
  await page.evaluate(a => {
    window.__answers = a.slice();
    window.confirm = () => (window.__answers.length ? window.__answers.shift() : false);
  }, answers);
}

async function importFile(page, name, payload, answers) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  await answerConfirms(page, answers);
  // Импорт живёт на вкладке Истории — до неё надо дойти, как доходит человек
  await page.click('[data-tab="database"]');
  await page.setInputFiles('#db-import-file', file);
  // FileReader асинхронный: ждём, пока обработчик отработает (или окажется, что нечего ждать)
  await page.waitForTimeout(250);
}

export async function runBackup(browser, base, t) {
  t.section('backup — полный бэкап и импорт');

  // ── Экспорт: что попадает в файл ─────────────────────────
  const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html', { storage: SEED });
  const payload = await page.evaluate(() => backupPayload());

  t.eq('версия формата', payload.v, 3);
  t.eq('история в бэкапе', payload.db.length, 1);
  t.eq('эталоны в бэкапе', payload.refs.length, 2);
  t.eq('избранное в бэкапе', payload.favorites.length, 1);
  t.eq('пресеты в бэкапе', payload.presets.length, 1);
  t.eq('очередь в бэкапе', payload.queue.length, 1);
  t.ok('категории в бэкапе', !!payload.cats && payload.cats.custom.length === 1, JSON.stringify(payload.cats));
  t.ok('каталоги игр в бэкапе', !!payload.catalogs && !!payload.catalogs['PS Plus Extra'], JSON.stringify(payload.catalogs));
  t.eq('настройки в бэкапе', payload.settings?.pageName, 'Рабочая страница');
  t.eq('настройки обложек в бэкапе', payload.cv?.bg, '#123456');
  t.ok('приёмы чужого эталона сохранены', payload.refs.find(r => r.source === 'other')?.tricks?.length === 1, JSON.stringify(payload.refs));

  // Главное: файл уезжает в облако и пересылается — ключа к платному API в нём быть не должно
  const dump = JSON.stringify(payload);
  t.ok('админ-токена в бэкапе НЕТ', !dump.includes('SECRET-TOKEN-12345'), 'токен утёк в файл бэкапа');
  t.ok('транзитных результатов генерации в бэкапе нет',
    !('results' in payload) && !('extraResults' in payload) && !('batchResults' in payload),
    Object.keys(payload).join(', '));

  // Кнопка реально отдаёт файл (проверяем через событие скачивания, а не вызов функции)
  await page.click('[data-tab="database"]');
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    page.click('[data-act="db-export"]'),
  ]);
  t.ok('кнопка «⬇ Бэкап JSON» скачивает файл', !!dl[0], 'события download не было');
  t.ok('имя файла говорит, что это бэкап', /^avito-backup-/.test(dl[0]?.suggestedFilename() || ''), dl[0]?.suggestedFilename() || '—');

  await ctx.close();

  // ── Импорт на чистом браузере: переезд на другое устройство ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await importFile(page, 'v3.json', payload, [true, true]); // слить + восстановить настройки
    const after = await page.evaluate(() => ({
      db: state.db.length, refs: state.refs.length, favs: state.favorites.length,
      presets: state.presets.length, queue: state.postQueue.length,
      customCats: state.catsCfg.custom.length, builtinPatched: !!state.catsCfg.builtin.game,
      catalog: state.catalogs['PS Plus Extra'] || '', pageName: state.settings.pageName,
      cvBg: cv.bg, cvPad: cv.padding,
      catsRebuilt: CATS.some(c => c.id === 'my_cat'),
    }));
    t.eq('история восстановлена', after.db, 1);
    t.eq('эталоны восстановлены', after.refs, 2);
    t.eq('избранное восстановлено', after.favs, 1);
    t.eq('пресеты восстановлены', after.presets, 1);
    t.eq('очередь восстановлена', after.queue, 1);
    t.eq('своя категория восстановлена', after.customCats, 1);
    t.ok('патч встроенной категории восстановлен', after.builtinPatched, JSON.stringify(after));
    t.ok('категории пересобраны, а не только записаны', after.catsRebuilt, 'CATS не содержит my_cat');
    t.ok('каталог игр восстановлен', after.catalog.includes('GTA 5'), after.catalog);
    t.eq('настройки восстановлены', after.pageName, 'Рабочая страница');
    t.eq('настройки обложек восстановлены', after.cvBg, '#123456');
    t.eq('и числовые поля обложек тоже', after.cvPad, 33);

    // Пережить F5: импорт обязан был дойти до localStorage, а не осесть в памяти
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const afterReload = await page.evaluate(() => ({
      refs: state.refs.length, favs: state.favorites.length, pageName: state.settings.pageName, cvBg: cv.bg,
    }));
    t.eq('эталоны пережили F5', afterReload.refs, 2);
    t.eq('избранное пережило F5', afterReload.favs, 1);
    t.eq('настройки пережили F5', afterReload.pageName, 'Рабочая страница');
    t.eq('обложки пережили F5', afterReload.cvBg, '#123456');

    // Повторный импорт того же файла — дедуп по содержимому, а не по id
    await importFile(page, 'v3.json', payload, [true, false]);
    const twice = await page.evaluate(() => ({
      refs: state.refs.length, favs: state.favorites.length, presets: state.presets.length, queue: state.postQueue.length, db: state.db.length,
    }));
    t.eq('повторный импорт не задвоил эталоны', twice.refs, 2);
    t.eq('повторный импорт не задвоил избранное', twice.favs, 1);
    t.eq('повторный импорт не задвоил пресеты', twice.presets, 1);
    t.eq('повторный импорт не задвоил очередь', twice.queue, 1);
    t.eq('повторный импорт не задвоил историю', twice.db, 1);

    t.ok('консоль чистая (импорт v3)', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Отказ от настроек: подливаем сырьё с телефона на рабочий ПК ──
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html', {
      storage: { avito_settings: { pageName: 'ПК' }, avito_cats: { builtin: {}, custom: [] } },
    });
    await importFile(page, 'v3.json', payload, [true, false]); // слить, настройки НЕ трогать
    const r = await page.evaluate(() => ({
      refs: state.refs.length, pageName: state.settings.pageName, customCats: state.catsCfg.custom.length, cvBg: cv.bg,
    }));
    t.eq('сырьё подлилось', r.refs, 2);
    t.eq('а настройки рабочего ПК остались свои', r.pageName, 'ПК');
    t.eq('и категории не подменились', r.customCats, 0);
    t.ok('и настройки обложек не тронуты', r.cvBg !== '#123456', r.cvBg);
    await ctx.close();
  }

  // ── Отмена замены базы: не должно добавиться ничего ──────
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html');
    await importFile(page, 'v3.json', payload, [false, false]); // «заменить» → «нет, отмена»
    const r = await page.evaluate(() => ({ db: state.db.length, refs: state.refs.length, favs: state.favorites.length }));
    t.eq('отменённый импорт не тронул историю', r.db, 0);
    t.eq('отменённый импорт не добавил эталоны', r.refs, 0);
    t.eq('отменённый импорт не добавил избранное', r.favs, 0);
    await ctx.close();
  }

  // ── Замена базы: история заменяется, накопленное руками — добавляется ──
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html', {
      storage: { avito_db: [{ id: 99, product: 'Старое', region: 'Омск' }], avito_refs: [] },
    });
    await importFile(page, 'v3.json', payload, [false, true, false]); // заменить → да → настройки не трогать
    const r = await page.evaluate(() => ({
      db: state.db.length, first: state.db[0]?.product, refs: state.refs.length, favs: state.favorites.length,
    }));
    t.eq('база заменена', r.db, 1);
    t.eq('заменена именно файлом', r.first, 'PS Plus Extra');
    t.eq('эталоны при замене всё равно добавлены', r.refs, 2);
    t.eq('и избранное тоже', r.favs, 1);
    await ctx.close();
  }

  // ── Коллизия id при слиянии двух устройств ──────────────
  // Запись с другого устройства может иметь тот же Date.now()-id. Удаление ищет
  // строго по id — без переименования одно нажатие × снесло бы обе записи.
  {
    const { ctx, page } = await openApp(browser, base + '/avito-helper.html', {
      storage: {
        avito_favorites: [{ _fid: 21, title: 'Свой избранный', description: 'Свой текст' }],
        avito_refs: [{ id: 11, source: 'mine', category: 'game', title: 'Свой эталон', desc: 'Свой текст' }],
      },
    });
    await importFile(page, 'v3.json', payload, [true, false]);
    const r = await page.evaluate(() => ({
      fids: state.favorites.map(f => f._fid),
      refIds: state.refs.map(x => x.id),
      queueFav: state.postQueue.find(q => q.source === 'fav')?.favId ?? null,
      importedFid: state.favorites.find(f => f.title === 'Избранный')?._fid ?? null,
    }));
    t.eq('избранных стало двое', r.fids.length, 2);
    t.ok('их _fid различаются', new Set(r.fids).size === 2, JSON.stringify(r.fids));
    t.ok('id эталонов тоже разведены', new Set(r.refIds).size === r.refIds.length, JSON.stringify(r.refIds));
    t.ok('позиция очереди указывает на ПЕРЕИМЕНОВАННОЕ избранное, а не на чужое',
      r.queueFav !== null && r.queueFav === r.importedFid, `queue.favId=${r.queueFav}, импортированный _fid=${r.importedFid}`);
    await ctx.close();
  }

  // ── Старые форматы файла ────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    // v2 — {db, refs}
    await importFile(page, 'v2.json', { v: 2, db: SEED.avito_db, refs: SEED.avito_refs }, [true, false]);
    const v2 = await page.evaluate(() => ({ db: state.db.length, refs: state.refs.length }));
    t.eq('v2: история принята', v2.db, 1);
    t.eq('v2: эталоны приняты', v2.refs, 2);

    // v1 — голый массив записей Истории
    await importFile(page, 'v1.json', [{ id: 77, product: 'Старый бэкап', region: 'Тверь' }], [true, false]);
    const v1 = await page.evaluate(() => ({ db: state.db.length, has: state.db.some(r => r.product === 'Старый бэкап') }));
    t.eq('v1: запись добавлена к существующим', v1.db, 2);
    t.ok('v1: именно из файла', v1.has, JSON.stringify(v1));

    // Мусорный файл — понятная ошибка, а не падение
    await importFile(page, 'junk.json', { hello: 'world' }, [true, false]);
    const junk = await page.evaluate(() => ({ db: state.db.length, toast: document.getElementById('toast')?.textContent || '' }));
    t.eq('мусорный файл ничего не испортил', junk.db, 2);
    t.ok('и объяснил, что не так', /Ошибка импорта/.test(junk.toast), junk.toast || '(тоста нет)');

    t.ok('консоль чистая (старые форматы)', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
