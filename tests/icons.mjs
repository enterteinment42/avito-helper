// Значки (25.09.2026, план Fotor, Ф5): Lucide вместо эмодзи в инфографике и отдельный слой
// «Значок». Эмодзи в начале строки — метка; старые инфографики рисуются как в git HEAD.
import { openApp, writeBaseline } from './lib.mjs';

const setupCover = page => page.evaluate(async () => {
  const src = document.createElement('canvas'); src.width = 800; src.height = 1000;
  const g = src.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0, 0, 800, 1000);
  const el = new Image(); await new Promise(r => { el.onload = r; el.src = src.toDataURL('image/png'); });
  cv.mode = 'game'; cv.ratio = '4:5'; cv.gamePad = 0; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = false;
  cv.gameFit = 'cover'; cv.bg = '#00ff00'; cv.bgStyle = 'solid'; cv.vignette = false; cv.grade = 'none'; cv.bgPattern = 'none';
  cv.images = [{ id: 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }];
  cv.layers = []; cv._selLayer = null; render();
});

const OLD_INFOG = [{ id: 'i1', type: 'infog', x: 0.4, y: 0.8, angle: 0, scale: 1, hidden: false, text: '🕹️ Elden Ring\n✔️ PS4 / PS5\n⚡ Оформляется в цифре', size: 38, bg: '#0f172a', opacity: 0.82, color: '#ffffff', align: 'left' }];

export async function runIcons(browser, base, t) {
  t.section('icons — значки в инфографике и слой «Значок»');
  writeBaseline();

  // ── Старая инфографика — как в HEAD ──
  {
    const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
    const cur = await openApp(browser, `${base}/avito-helper.html`);
    try {
      const draw = page => page.evaluate(async ls => {
        await document.fonts.load(`700 40px 'JetBrains Mono'`, 'АяAz');
        cvApplyCfg({ layers: JSON.parse(JSON.stringify(ls)) });
        const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
        return { url: c.toDataURL(), icons: cv.layers[0].icons };
      }, OLD_INFOG);
      for (const p of [old.page, cur.page]) { await p.click('[data-tab="covers"]'); await setupCover(p); }
      const a = await draw(old.page), b = await draw(cur.page);
      t.ok('инфографика до значков — с эмодзи, пиксель в пиксель как в HEAD', a.url === b.url && b.icons === false, JSON.stringify({ icons: b.icons }));
      t.ok('консоль чистая (HEAD и новая)', old.consoleErrors.length === 0 && cur.consoleErrors.length === 0, [...old.consoleErrors, ...cur.consoleErrors].join('\n'));
    } finally { await old.ctx.close(); await cur.ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await setupCover(page);

    // ── Разбор метки ──
    const parse = await page.evaluate(() => ['✔️ PS5', '✔ PS5', '💲 от 300₽', '🕹️ Elden Ring', '🦄 Единорог', 'Просто текст', '🛡️Гарантия'].map(l => { const r = cvIconOf(l); return r ? `${r.icon}|${r.text}` : null; }));
    t.eq('метки из набора узнаются (с U+FE0F и без), чужое эмодзи и текст — нет', JSON.stringify(parse),
      JSON.stringify(['check|PS5', 'check|PS5', 'russian-ruble|от 300₽', 'joystick|Elden Ring', null, null, 'shield-check|Гарантия']));
    const cover = await page.evaluate(() => {
      const used = ['🎮', '✔', '🔥', '💲', '🧠', '🕹', '🎯', '⚡', '📦'];
      return { all: used.every(e => CV_ICONS.some(([k, n]) => k === e && CV_ICON_PATHS[n])), paths: CV_ICONS.every(([, n]) => cvIconPaths(n).length > 0), n: CV_ICONS.length };
    });
    t.ok('все эмодзи инфографики из формы генератора есть в наборе, у всех значков есть рисунок', cover.all && cover.paths && cover.n >= 25, JSON.stringify(cover));

    // ── Кто со значками по умолчанию ──
    const who = await page.evaluate(() => {
      cvAddLayer('infog'); const added = cv.layers[cv.layers.length - 1].icons;
      state.form.category = 'game'; state.form.gameName = 'Hades II'; state.form.gamePlatforms = ['PS5'];
      cvApplyTpl('b-card'); const card = cv.layers.find(L => L.type === 'infog').icons;
      cv.tpls.push({ id: 'u-old-ig', name: 'Инфографика 24.09', layers: [{ type: 'infog', text: '✔️ X', size: 38, bg: '#0f172a', opacity: 0.82, color: '#ffffff', align: 'left' }], style: {} });
      cvApplyTpl('u-old-ig'); const own = cv.layers[0].icons;
      cvApplyCfg({ mode: 'game', ratio: '4:5', infog: true, infogText: '✔️ 405+ игр', infogX: 100, infogY: 900 }); delete cv.infog;
      const legacy = (cv.layers.find(L => L.type === 'infog') || {}).icons;
      cv.layers = []; cv.tpls = cv.tpls.filter(t => t.id !== 'u-old-ig');
      return { added, card, own, legacy };
    });
    t.ok('новая инфографика и «Карточка товара» — со значками', who.added === true && who.card === true, JSON.stringify(who));
    t.ok('свой шаблон до значков и настройки прежнего формата — с эмодзи, как были', who.own === false && who.legacy === false, JSON.stringify(who));

    // ── Рисование в инфографике ──
    const ig = await page.evaluate(() => {
      const L = { ...cvLayerDefaults('infog'), text: '🔥 Хит продаж\n🦄 Единорог', x: 0.45, y: 0.5, bg: '#000000', opacity: 1, color: '#ffffff' };
      const g = cvInfogGeom(L, 1080), gOff = cvInfogGeom({ ...L, icons: false }, 1080);
      const ctx = cvMctx(); ctx.font = cvFontStr(L, g.fs);
      const expect = g.fs * CV_INFOG_ICON + ctx.measureText('Хит продаж').width + g.fs * 1.5;
      cv.layers = [L];
      const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
      const f = cvLayerFrame(L, 1080, 1350), x0 = Math.round(f.cx - f.w / 2 + g.padX), y0 = Math.round(f.cy - f.h / 2);
      const d = c.getContext('2d').getImageData(x0, y0 + 4, Math.round(g.fs * 1.05), Math.round(g.bh) - 8).data;
      let white = 0, colored = 0;
      for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mn > 200) white++; if (mx - mn > 60) colored++; }
      cv.layers = [];
      return { w0: g.widths[0], expect, item1: g.items[1], off: gOff.items.every(x => x === null), white, colored };
    });
    t.ok('строка со значком: ширина = значок + текст без эмодзи', Math.abs(ig.w0 - ig.expect) < 0.5, JSON.stringify(ig));
    t.ok('чужое эмодзи остаётся текстом, с выключенными значками — все строки текстом', ig.item1 === null && ig.off, JSON.stringify(ig));
    t.ok('на месте эмодзи 🔥 — значок цветом букв (белый), цветного эмодзи нет', ig.white > 20 && ig.colored === 0, JSON.stringify(ig));

    // ── Палитра: вставка в строку под курсором ──
    await page.evaluate(() => { cv.layers = []; cvAddLayer('infog'); const L = cv.layers[0]; L.text = '🕹️ Elden Ring\n✔️ PS5\nГарантия 30 дней'; cvLayersChanged(); });
    // курсор не ставили — метка в последнюю строку, а не в название товара
    await page.click('[data-cv-icon-ins="⭐"]');
    const untouched = await page.evaluate(() => cv.layers[0].text.split('\n'));
    t.eq('курсор в поле не ставили — метка в последнюю строку, название не тронуто', JSON.stringify(untouched), JSON.stringify(['🕹️ Elden Ring', '✔️ PS5', '⭐ Гарантия 30 дней']));
    // курсор — щелчком по второй строке (настоящий клик мыши), дальше два щелчка по палитре подряд
    const box = await page.evaluate(() => { const ta = document.querySelector('#cv-layers-card [data-cv-lp="text"]'); const r = ta.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18; return { x: r.left + 60, y: r.top + parseFloat(getComputedStyle(ta).paddingTop) + lh * 1.5 }; });
    await page.mouse.click(box.x, box.y);
    await page.click('[data-cv-icon-ins="🛡"]');
    await page.click('[data-cv-icon-ins="🎮"]');
    const ins = await page.evaluate(() => cv.layers[0].text.split('\n'));
    t.eq('палитра: несколько щелчков подряд идут в строку, где стоял курсор (ревью Ф5), прежняя метка заменяется', JSON.stringify(ins), JSON.stringify(['🕹️ Elden Ring', '🎮 PS5', '⭐ Гарантия 30 дней']));
    await page.click('#cv-layers-card [data-cv-lt="icons"]');
    t.ok('выключили значки — палитра скрыта, строки рисуются эмодзи', await page.evaluate(() => cv.layers[0].icons === false && !document.querySelector('[data-cv-icon-ins]') && cvInfogGeom(cv.layers[0], 1080).items.every(x => x === null)));

    // ── Слой «Значок» ──
    await page.evaluate(() => { cv.layers = []; cv._selLayer = null; cvLayersChanged(); });
    await page.click('[data-cv-la="add:icon"]');
    const lay = await page.evaluate(() => {
      const L = cv.layers[0]; L.x = 0.5; L.y = 0.5; cvReDraw();
      const px = (x, y) => [...document.getElementById('cv-canvas').getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      return { type: L.type, icon: L.icon, ring: px(540 + 65, 675), row: document.querySelector('.cv-lrow.active .cv-lrow-name').textContent, pal: document.querySelectorAll('#cv-layers-card [data-cv-lv^="icon:"]').length };
    });
    t.ok('«+ Значок» добавляет щит «Гарантия» в круге цвета фона', lay.type === 'icon' && lay.icon === 'shield-check' && Math.abs(lay.ring[0] - 0x0f) < 12 && Math.abs(lay.ring[1] - 0x76) < 12 && lay.row === 'Гарантия', JSON.stringify(lay));
    t.ok('в меню значка — весь набор', lay.pal === (await page.evaluate(() => CV_ICONS.length)), JSON.stringify(lay));
    await page.click('[data-cv-lv="icon:truck"]');
    await page.click('[data-cv-lv="shape:none"]');
    const none = await page.evaluate(() => {
      const px = (x, y) => [...document.getElementById('cv-canvas').getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      return { icon: cv.layers[0].icon, ring: px(540 + 65, 675), bgRow: !!document.querySelector('#cv-layers-card [data-cv-lv^="bg:"]') };
    });
    t.ok('выбор значка и «Без фона»: круга нет, строка «Фон» скрыта', none.icon === 'truck' && none.ring[2] > 200 && !none.bgRow, JSON.stringify(none));
    const junk = await page.evaluate(() => { cvApplyCfg({ layers: [{ type: 'icon', icon: 'unicorn', shape: 'star', size: '120' }] }); return cv.layers[0]; });
    t.ok('чужой значок и форма — к заводским, размер строкой — к числу', junk.icon === 'shield-check' && junk.shape === 'circle' && junk.size === 120, JSON.stringify(junk));
    // Находка ревью Ф5 №2: имена унаследованных свойств объекта не должны считаться значками
    const proto = await page.evaluate(() => {
      cvApplyCfg({ layers: ['toString', 'constructor', '__proto__', 'hasOwnProperty'].map(icon => ({ type: 'icon', icon })) });
      let drawn = true;
      try { const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {}); cvIconSvg('constructor'); cvIconPaths('toString'); } catch (e) { drawn = String(e); }
      return { icons: cv.layers.map(L => L.icon), drawn };
    });
    t.ok('«toString», «constructor» и т.п. из чужих данных — к заводскому значку, обложка рисуется', proto.icons.every(i => i === 'shield-check') && proto.drawn === true, JSON.stringify(proto));

    // ── Шаблон и F5 ──
    await page.evaluate(() => { cv.layers = [{ ...cvLayerDefaults('icon'), icon: 'gift' }, { ...cvLayerDefaults('infog'), text: '🚚 Доставка' }]; window.prompt = () => 'Со значками'; cvSaveTpl(); cvReDraw(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const kept = await page.evaluate(() => {
      const live = cv.layers.map(L => `${L.type}:${L.icon || L.icons}`).join(',');
      cv.layers = []; cvApplyTpl(cv.tpls.find(t => t.name === 'Со значками').id);
      return { live, tpl: cv.layers.map(L => `${L.type}:${L.icon || L.icons}`).join(',') };
    });
    t.ok('слой «Значок» и значки инфографики переживают F5 и свой шаблон', kept.live === 'icon:gift,infog:true' && kept.tpl === kept.live, JSON.stringify(kept));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }
}
