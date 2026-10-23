// Ручной «Список игр» — свой у каждой подписки (Денис, 18.10.2026). Раньше поле было одно
// на все подписки: список PS Plus Extra при переключении на EA Play оставался в форме и уходил
// в пул крючка названия EA Play. Теперь список лежит полем `extra` в каталоге подписки.
import { openApp } from './lib.mjs';

const PS_LIST = 'GTA 5, Hell Is Us, Mafia: The Old Country';
const EA_CAT = { core: ['FC 26|Фифа 26', 'Battlefield 6'], masking: ['Dead Space'] };
const form = (subType, games) => ({ category: 'gaming_sub', subType, platforms: ['PS4', 'PS5'], durations: [{ period: '1 месяц', price: '1700' }], games });
const hook = page => page.evaluate(() => catInfoBlock(state.form));
const pickSub = async (page, sub) => { await page.selectOption('[data-act="field"][data-k="subType"]', sub); await page.waitForTimeout(30); };

export async function runSubgames(browser, base, t) {
  t.section('subgames — список игр у каждой подписки свой');
  const url = `${base}/avito-helper.html`;

  // ── Случай Дениса: выбрана EA Play с каталогом, в форме — список PS Plus ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, url, { storage: {
      avito_form: form('EA Play', PS_LIST), avito_catalogs: { 'EA Play': EA_CAT },
    } });
    try {
      const st = await page.evaluate(() => ({ cats: state.catalogs, games: state.form.games,
        ls: JSON.parse(localStorage.getItem('avito_catalogs')), lsForm: JSON.parse(localStorage.getItem('avito_form')).games }));
      t.eq('старый список ушёл подписке по умолчанию (PS Plus Extra)', st.cats['PS Plus Extra']?.extra, PS_LIST);
      t.ok('у EA Play чужого списка нет', st.cats['EA Play'].extra === undefined);
      t.eq('каталог EA Play цел', JSON.stringify([st.cats['EA Play'].core, st.cats['EA Play'].masking]), JSON.stringify([EA_CAT.core, EA_CAT.masking]));
      t.eq('форма EA Play — без чужого списка', st.games, '');
      // При старте в хранилище не пишем (иначе плашка «вкладка устарела» в других вкладках) —
      // перенос повторяется с тем же итогом, пока его не сохранит обычный save()
      t.ok('при старте в хранилище не пишем', st.ls['PS Plus Extra'] === undefined && st.lsForm === PS_LIST);
      t.ok('в промпте EA Play нет GTA 5', !/GTA 5|Hell Is Us/.test(await hook(page)));
            await pickSub(page, 'PS Plus Extra');
      t.eq('PS Plus Extra получила свой список в форму', await page.evaluate(() => state.form.games), PS_LIST);
      t.ok('и в промпт', /GTA 5/.test(await hook(page)));
      t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    } finally { await ctx.close(); }
  }

  // ── Чистый браузер: заводской список формы никуда не переносится ──
  {
    const { ctx, page } = await openApp(browser, url);
    try {
      const st = await page.evaluate(() => [Object.keys(state.catalogs).length, syncSettingsWorth(syncSettingsDoc())]);
      t.ok('чистый браузер: каталоги пусты, заводские настройки на сервер не просятся', st[0] === 0 && st[1] === false, JSON.stringify(st));
      // Набрал игру на новом устройстве — это ещё не повод слать заводские настройки поверх серверных
      const typed = await page.evaluate(() => {
        subGamesSet('PS Plus Extra', 'Astro Bot');
        const onlyExtra = syncSettingsWorth(syncSettingsDoc());
        state.catalogs['EA Play'] = { core: ['FC 26'], masking: [] };
        return [onlyExtra, syncSettingsWorth(syncSettingsDoc())];
      });
      t.eq('один «Список игр» — не свои настройки; каталог с играми — свои', JSON.stringify(typed), JSON.stringify([false, true]));
      // Запись каталога непонятного формата (строка из старого бэкапа)
      const legacy = await page.evaluate(() => {
        state.catalogs['Game Pass Ultimate'] = 'Halo, Forza';
        state.form.category = 'gaming_sub'; state.form.subType = 'PS Plus Extra'; state.form.games = 'Astro Bot';
        state.form.subType = 'Game Pass Ultimate';
        const leak = subGamesFor(state.form);
        state.tab = 'settings'; render();
        document.getElementById('cat-sub-sel').value = 'Game Pass Ultimate';
        document.getElementById('cat-sub-sel').dispatchEvent(new Event('change'));
        document.getElementById('cat-core').value = 'Starfield';
        document.getElementById('cat-save').click();
        return [leak, JSON.stringify(state.catalogs['Game Pass Ultimate'])];
      });
      t.eq('строковая запись: список прежней подписки не протекает', legacy[0], '');
      t.eq('«Сохранить каталог» не раскладывает строку по символам', legacy[1], JSON.stringify({ core: ['Starfield'], masking: [] }));
    } finally { await ctx.close(); }
  }

  // ── Повторная загрузка не переносит список ещё раз ──
  {
    const { ctx, page } = await openApp(browser, url, { storage: {
      avito_form: form('EA Play', ''), avito_catalogs: { 'EA Play': EA_CAT, 'PS Plus Extra': { core: [], masking: [], extra: PS_LIST } },
    } });
    try {
      const st = await page.evaluate(() => [state.catalogs['EA Play'].extra, state.form.games]);
      t.ok('вторая загрузка: EA Play без списка, форма пустая', st[0] === undefined && st[1] === '');
    } finally { await ctx.close(); }
  }

  // ── Обычный переезд: у текущей подписки каталога нет ──
  {
    const { ctx, page } = await openApp(browser, url, { storage: { avito_form: form('PS Plus Deluxe', 'Ghost of Tsushima') } });
    try {
      const st = await page.evaluate(() => [state.catalogs['PS Plus Deluxe']?.extra, state.form.games]);
      t.ok('список остался у текущей подписки и в форме', st[0] === 'Ghost of Tsushima' && st[1] === 'Ghost of Tsushima');
    } finally { await ctx.close(); }
  }

  // ── Ввод, переключение, каталог в ⚙, пресет, сервер и импорт ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, url, { storage: {
      avito_form: form('PS Plus Extra', ''), avito_catalogs: { 'EA Play': EA_CAT, 'PS Plus Extra': { core: [], masking: [], extra: '' } },
    } });
    try {
      await page.fill('textarea[data-act="field"][data-k="games"]', 'Returnal, Demon Souls');
      await page.waitForTimeout(450);
      t.eq('набранное легло в каталог PS Plus Extra', await page.evaluate(() => state.catalogs['PS Plus Extra'].extra), 'Returnal, Demon Souls');
      await pickSub(page, 'EA Play');
      t.eq('EA Play: поле доп. игр пустое', await page.inputValue('input[data-act="field"][data-k="games"]'), '');
      await page.fill('input[data-act="field"][data-k="games"]', 'Dead Space Remake');
      await page.waitForTimeout(450);
      await pickSub(page, 'PS Plus Extra');
      t.eq('вернулись в PS Plus Extra — её список', await page.evaluate(() => state.form.games), 'Returnal, Demon Souls');
      t.eq('у EA Play — свой', await page.evaluate(() => state.catalogs['EA Play'].extra), 'Dead Space Remake');
      await page.waitForTimeout(450);
      t.ok('в localStorage оба списка (переживут F5)', await page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('avito_catalogs'));
        return c['EA Play'].extra === 'Dead Space Remake' && c['PS Plus Extra'].extra === 'Returnal, Demon Souls';
      }));

      // Сохранение каталога в ⚙ не стирает список
      await page.click('[data-tab="settings"]');
      await page.selectOption('#cat-sub-sel', 'EA Play');
      const kept = await page.evaluate(() => {
        document.getElementById('cat-core').value = 'FC 26\nNHL 26';
        document.getElementById('cat-save').click();
        return [state.catalogs['EA Play'].extra, state.catalogs['EA Play'].core.length];
      });
      t.ok('«Сохранить каталог» не стёр доп. список', kept[0] === 'Dead Space Remake' && kept[1] === 2);

      // Каталоги с сервера/из бэкапа старой страницы — без extra: списки ВСЕХ подписок переносим
      const carried = await page.evaluate(() => {
        state.form.subType = 'PS Plus Extra';
        state.catalogs = { 'PS Plus Extra': { core: [], masking: [], extra: 'Returnal' }, 'EA Play': { core: ['A'], masking: [], extra: 'Dead Space' } };
        const prev = state.catalogs;
        state.catalogs = { 'EA Play': { core: ['FC 26'], masking: [] }, 'Game Pass Ultimate': ['Halo'] };
        subGamesCarry(prev);
        return [state.catalogs['PS Plus Extra']?.extra, state.catalogs['EA Play'].extra, state.catalogs['EA Play'].core.join(), state.form.games];
      });
      t.eq('каталоги без списков: перенесены списки всех подписок', JSON.stringify(carried), JSON.stringify(['Returnal', 'Dead Space', 'FC 26', 'Returnal']));
      const fromSrv = await page.evaluate(() => {
        const prev = state.catalogs;
        state.catalogs = { 'PS Plus Extra': { core: [], masking: [], extra: 'Astro Bot' } };
        subGamesCarry(prev);
        return [state.form.games, state.catalogs['EA Play']?.extra];
      });
      t.eq('каталоги со списком: пришедший главнее, недостающие перенесены', JSON.stringify(fromSrv), JSON.stringify(['Astro Bot', 'Dead Space']));

      // Пресет не приносит свой список игр
      await page.click('[data-tab="generator"]');
      const pr = await page.evaluate(() => {
        state.presets = [{ id: 7, name: 'p', form: { category: 'gaming_sub', subType: 'EA Play', games: 'GTA 5' } }];
        render();
        document.getElementById('preset-sel').value = '7';
        document.querySelector('[data-act="preset-load"]').click();
        return [state.form.subType, state.form.games];
      });
      t.ok('пресет: список берётся у подписки, а не из пресета', pr[0] === 'EA Play' && pr[1] === 'Dead Space', JSON.stringify(pr));

      // Распознавание по фото сменило подписку — список догоняет её
      const vis = await page.evaluate(() => {
        state.form.subType = 'PS Plus Extra'; state.form.games = 'Astro Bot'; reForm();
        visionApplyToForm({ category: 'gaming_sub', fields: { subType: 'EA Play' } });
        return [state.form.subType, state.form.games, /Astro Bot/.test(catInfoBlock(state.form))];
      });
      t.eq('распознавание сменило подписку — список у неё свой', JSON.stringify(vis), JSON.stringify(['EA Play', 'Dead Space', false]));

      // Смена категории туда-обратно, пока каталоги заменились: поле показывает список из каталога
      await page.selectOption('select[data-act="cat"]', 'ai_sub');
      await page.evaluate(() => { state.catalogs['EA Play'].extra = 'Y'; });
      await page.selectOption('select[data-act="cat"]', 'gaming_sub');
      t.eq('возврат в «Игровую подписку»: поле — из каталога', await page.inputValue('[data-act="field"][data-k="games"]'), 'Y');
      t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    } finally { await ctx.close(); }
  }
}
