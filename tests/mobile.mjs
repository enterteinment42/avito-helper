// Телефон: шапка не растягивает страницу вширь, разделы — аккордеоном за кнопкой текущего.
const TABS = ['generator', 'covers', 'queue', 'database', 'scanner', 'settings'];

async function open(browser, base, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(`${base}/avito-helper.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#app header'));
  return { ctx, page, consoleErrors };
}

const visible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
}, sel);

export async function runMobile(browser, base, t) {
  t.section('mobile — шапка на телефоне');
  const { ctx, page, consoleErrors } = await open(browser, base, { width: 390, height: 844 }, true);
  try {
    t.ok('строка вкладок на телефоне скрыта', !(await visible(page, 'header nav')));
    t.ok('кнопка текущего раздела видна', await visible(page, '.nav-cur'));

    for (const tab of TABS) {
      await page.evaluate(id => { state.tab = id; state.navOpen = false; render(); }, tab);
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cur: document.querySelector('.nav-cur')?.textContent || '',
        curRight: Math.round(document.querySelector('.nav-cur').getBoundingClientRect().right),
        aiRight: Math.round(document.querySelector('.ai-btn')?.getBoundingClientRect().right || 0),
      }));
      t.ok(`[${tab}] страница не шире экрана`, r.sw <= 390, `scrollWidth=${r.sw}`);
      t.ok(`[${tab}] кнопка и «⚙ AI» в пределах экрана`, r.curRight <= 390 && r.aiRight <= 390, JSON.stringify(r));
    }

    // Очередь не пустая — счётчик и в аккордеоне, и на кнопке
    await page.evaluate(() => { state.postQueue = [{ id: 1 }, { id: 2 }]; state.tab = 'queue'; render(); });
    t.ok('счётчик очереди на кнопке текущего раздела', /Очередь\s*2/.test(await page.textContent('.nav-cur')));
    t.ok('с непустой очередью страница не шире экрана', await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    await page.evaluate(() => { state.postQueue = []; state.tab = 'generator'; render(); });

    t.ok('аккордеон закрыт по умолчанию', !(await page.$('.nav-acc')));
    await page.click('.nav-cur');
    const acc = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.nav-acc-row')].map(b => b.dataset.tab),
      active: document.querySelector('.nav-acc-row.active')?.dataset.tab,
      open: document.querySelector('.nav-cur').classList.contains('open'),
    }));
    t.eq('аккордеон перечисляет все разделы по порядку', acc.rows.join(','), TABS.join(','));
    t.eq('текущий раздел подсвечен', acc.active, 'generator');
    t.ok('стрелка кнопки повёрнута', acc.open);
    t.ok('открытый аккордеон не расширяет страницу', await page.evaluate(() => document.documentElement.scrollWidth <= 390));

    await page.click('.nav-acc-row[data-tab="database"]');
    const after = await page.evaluate(() => ({ tab: state.tab, open: !!document.querySelector('.nav-acc'), cur: document.querySelector('.nav-cur').textContent }));
    t.eq('строка аккордеона переключает раздел', after.tab, 'database');
    t.ok('после выбора аккордеон закрылся', !after.open);
    t.ok('кнопка показывает новый раздел', /История/.test(after.cur), after.cur);

    await page.click('.nav-cur');
    await page.click('.nav-acc-back', { position: { x: 200, y: 700 } });
    t.ok('тап по затемнению закрывает аккордеон', !(await page.$('.nav-acc')));

    await page.click('.nav-cur');
    await page.click('.nav-cur');
    t.ok('повторный тап по кнопке закрывает аккордеон', !(await page.$('.nav-acc')));

    t.ok('консоль чистая (телефон)', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await ctx.close();
  }

  // ПК: всё как было
  const pc = await open(browser, base, { width: 1280, height: 900 }, false);
  try {
    t.ok('ПК: строка вкладок на месте', await visible(pc.page, 'header nav'));
    t.ok('ПК: кнопки раздела нет', !(await visible(pc.page, '.nav-cur')));
    t.eq('ПК: шесть вкладок', await pc.page.evaluate(() => document.querySelectorAll('header nav .tab-btn').length), 6);
    await pc.page.click('header nav [data-tab="scanner"]');
    t.eq('ПК: вкладка переключает раздел', await pc.page.evaluate(() => state.tab), 'scanner');
    t.ok('консоль чистая (ПК)', pc.consoleErrors.length === 0, pc.consoleErrors.join(' | '));
  } finally {
    await pc.ctx.close();
  }
}
