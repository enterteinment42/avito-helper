// Сбой записи и соседние вкладки (К9 консилиума 29.09) + версия файла в интерфейсе (К10).
import { openApp } from './lib.mjs';

export async function runStorage(browser, base, t) {
  t.section('storage — сбой записи, соседняя вкладка, версия файла');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // ── Квота: обе попытки записи падают — человек должен об этом узнать
    const quota = await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      const toastEl = document.getElementById('toast');
      toastEl.textContent = '';
      let threw = false;
      try { save(); } catch (e) { threw = true; }
      const first = toastEl.textContent;
      const logged = JSON.stringify(_jBuf).includes('"save"');
      // Второй сбой в ту же минуту — тост не повторяется
      toastEl.textContent = '';
      save();
      const second = toastEl.textContent;
      Storage.prototype.setItem = orig;
      return { threw, first, second, logged };
    });
    t.ok('save() при переполнении не роняет страницу', !quota.threw);
    t.ok('сбой записи показан человеку', /переполнено/.test(quota.first) && /НЕ сохранены/.test(quota.first), quota.first);
    t.ok('тост называет кнопку бэкапа', quota.first.includes('Бэкап JSON'), quota.first);
    t.ok('сбой записи попал в журнал', quota.logged);
    t.eq('повторный сбой в ту же минуту не спамит тостом', quota.second, '');

    // Исправная запись после сбоя — без ложной тревоги и с данными на диске
    const okSave = await page.evaluate(() => {
      _saveFailAt = 0;
      const toastEl = document.getElementById('toast');
      toastEl.textContent = '';
      state.refs = [...state.refs, { id: Date.now(), text: 'эталон после сбоя' }];
      save();
      return { toast: toastEl.textContent, stored: (localStorage.getItem('avito_refs') || '').includes('эталон после сбоя') };
    });
    t.eq('исправная запись тоста не показывает', okSave.toast, '');
    t.ok('после сбоя сырьё записывается как обычно', okSave.stored);

    // Квоту съел транзитный ключ — сырьё всё равно должно лечь на диск: оно пишется первым
    const rawFirst = await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'avito_results' || k === 'avito_batch_results') throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
      _saveFailAt = 0;
      state.db = [...state.db, { id: Date.now(), product: 'Квота', region: 'Пермь', finalDesc: 'финал при полной квоте' }];
      state.refs = [...state.refs, { id: Date.now() + 1, text: 'эталон при полной квоте' }];
      state.favorites = [...state.favorites, { _fid: Date.now() + 2, title: 'избранное при полной квоте', description: 'x' }];
      state.settings = { ...state.settings, customSys: 'свой промпт при полной квоте' };
      save();
      Storage.prototype.setItem = orig;
      const g = k => localStorage.getItem(k) || '';
      return {
        db: g('avito_db').includes('финал при полной квоте'),
        refs: g('avito_refs').includes('эталон при полной квоте'),
        fav: g('avito_favorites').includes('избранное при полной квоте'),
        sys: g('avito_settings').includes('свой промпт при полной квоте'),
      };
    });
    t.ok('квота на результатах: История записана', rawFirst.db);
    t.ok('квота на результатах: эталоны записаны', rawFirst.refs);
    t.ok('квота на результатах: избранное записано', rawFirst.fav);
    t.ok('квота на результатах: настройки со своим промптом записаны', rawFirst.sys);

    // ── Соседняя вкладка: событие storage приходит только в ДРУГИЕ вкладки,
    // поэтому пишем со второй страницы того же origin (без приложения — она сама ничего не сохраняет)
    const other = await ctx.newPage();
    await other.goto(`${base}/no-such-page`);
    const bar = () => page.evaluate(() => document.querySelectorAll('#other-tab-bar').length);

    await other.evaluate(() => localStorage.setItem('avito_journal_buf_probe', '[]'));
    await other.evaluate(() => localStorage.setItem('avito_scene_recent', JSON.stringify(['probe'])));
    await page.waitForTimeout(100);
    t.eq('посторонние ключи плашку не поднимают', await bar(), 0);

    await other.evaluate(() => localStorage.setItem('avito_settings', JSON.stringify({ probe: Date.now() })));
    await page.waitForFunction(() => document.getElementById('other-tab-bar'), null, { timeout: 2000 }).catch(() => {});
    t.eq('правка настроек в соседней вкладке поднимает плашку', await bar(), 1);
    const barText = await page.evaluate(() => document.getElementById('other-tab-bar')?.textContent || '');
    t.ok('плашка объясняет, что делать', /другой вкладке/.test(barText) && /Обновить/.test(barText), barText);

    await other.evaluate(() => localStorage.setItem('avito_presets', JSON.stringify([{ id: 1, probe: true }])));
    await page.waitForTimeout(150);
    t.eq('повторное событие не плодит вторую плашку', await bar(), 1);

    // Плашка живёт вне #app — перерисовка её не сносит
    await page.evaluate(() => render());
    t.eq('плашка переживает render()', await bar(), 1);

    await page.click('[data-other-tab="close"]');
    t.eq('✕ убирает плашку', await bar(), 0);

    // Значение обязано отличаться от лежащего: на запись того же самого браузер события не шлёт
    await other.evaluate(() => localStorage.setItem('avito_queue', JSON.stringify([{ id: 1, probe: true }])));
    await page.waitForFunction(() => document.getElementById('other-tab-bar'), null, { timeout: 2000 }).catch(() => {});
    t.eq('после ✕ следующее изменение снова предупреждает', await bar(), 1);
    await other.close();

    // ── Версия файла
    const stamp = await page.evaluate(() => buildStamp());
    t.ok('версия файла — дата и время', /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(stamp), stamp);
    t.ok('версия видна на логотипе', (await page.getAttribute('.logo', 'title') || '').includes(stamp));
    await page.click('[data-tab="settings"]');
    t.ok('версия видна в Настройках', (await page.textContent('#build-stamp') || '').includes(stamp));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await ctx.close();
  }
}
