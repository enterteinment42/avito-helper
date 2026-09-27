// Стиль аккаунта (27.09.2026, план Fotor, Ф4): три цвета, шрифт и логотип у аккаунта.
// Новые элементы — сразу в стиле, готовую обложку перекрашивает кнопка, логотип — слой.
// Без стиля всё как в git HEAD; настройки не становятся «своими» сами по себе.
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

// PNG-логотип w×h: левая половина цвета color, правая — прозрачная
const makeLogo = (page, w, h, color) => page.evaluate(([w, h, color]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w / 2, h);
  return c.toDataURL('image/png');
}, [w, h, color]);

export async function runBrand(browser, base, t) {
  t.section('brand — стиль аккаунта и логотип');
  writeBaseline();

  // ── Без стиля — как в HEAD: новые элементы тех же цветов и шрифтов, обложка пиксель в пиксель ──
  {
    const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
    const cur = await openApp(browser, `${base}/avito-helper.html`);
    try {
      const draw = page => page.evaluate(async () => {
        await document.fonts.load(`700 40px 'JetBrains Mono'`, 'АяAz');
        await document.fonts.load(`400 40px Literata`, 'АяAz');
        for (const type of ['sticker', 'ribbon', 'text', 'infog', 'icon', 'plat']) cvAddLayer(type);
        cv._selLayer = null;
        const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
        return { url: c.toDataURL(), layers: JSON.stringify(cv.layers.map(({ id, ...r }) => r)) };
      });
      for (const p of [old.page, cur.page]) { await p.click('[data-tab="covers"]'); await setupCover(p); }
      const a = await draw(old.page), b = await draw(cur.page);
      t.ok('стиль не задан — новые элементы те же, что в HEAD, обложка пиксель в пиксель', a.url === b.url && a.layers === b.layers, a.layers === b.layers ? 'пиксели разошлись' : `${a.layers}\n${b.layers}`);
      t.ok('консоль чистая (HEAD и новая)', old.consoleErrors.length === 0 && cur.consoleErrors.length === 0, [...old.consoleErrors, ...cur.consoleErrors].join('\n'));
    } finally { await old.ctx.close(); await cur.ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await setupCover(page);

    // ── Карточка и чистые настройки ──
    const fresh = await page.evaluate(() => ({
      card: !!document.querySelector('#cv-acc-card [data-cv-acc="create"]'),
      worth: syncSettingsWorth({ settings: state.settings }),
    }));
    t.ok('без стиля — карточка предлагает «Задать стиль», настройки заводские (на сервер не просятся)', fresh.card && fresh.worth === false, JSON.stringify(fresh));

    await page.evaluate(() => { state.settings.accounts = [{ id: 'a1', name: 'Поиграем' }, { id: 'a2', name: 'Второй' }]; save(); render(); });
    await page.selectOption('[data-cv-acc-sel]', 'a2');
    t.ok('выбор аккаунта во вкладке — в cv.acc, сам по себе стиль не создаёт', await page.evaluate(() => cv.acc === 'a2' && state.settings.accounts.every(a => !a.style)));
    await page.selectOption('[data-cv-acc-sel]', 'a1');

    // ── Задать стиль: цвета, шрифт ──
    await page.click('[data-cv-acc="create"]');
    const setColor = (k, v) => page.evaluate(([k, v]) => {
      const el = document.querySelector(`[data-cv-acc-col="${k}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [k, v]);
    await setColor('main', '#112233'); await setColor('text', '#FFEE00'); await setColor('accent', '#ff00aa');
    await page.click('[data-cv-acc="font:russo"]');
    const st = await page.evaluate(() => ({
      s: state.settings.accounts[0].style, other: state.settings.accounts[1].style,
      def: JSON.stringify(DEF_ACCOUNTS) + JSON.stringify(DEF_SETTINGS.accounts),
      worth: syncSettingsWorth({ settings: state.settings }),
      doc: !!(syncSettingsDoc().settings.accounts[0].style),
    }));
    t.ok('стиль пишется в аккаунт (цвета — строчными), соседний аккаунт не тронут', st.s.main === '#112233' && st.s.text === '#ffee00' && st.s.accent === '#ff00aa' && st.s.font === 'russo' && !st.other, JSON.stringify(st));
    t.ok('заводской список аккаунтов не изменён, стиль уезжает в документ настроек', !st.def.includes('style') && st.worth === true && st.doc, JSON.stringify(st));

    // ── Новые элементы — в стиле; платформы — нет ──
    const added = await page.evaluate(() => {
      cv.layers = [];
      for (const type of ['sticker', 'ribbon', 'text', 'infog', 'icon', 'plat']) cvAddLayer(type);
      const by = Object.fromEntries(cv.layers.map(L => [L.type, L]));
      return {
        sticker: [by.sticker.bg, by.sticker.color, by.sticker.color2, by.sticker.font],
        ribbon: [by.ribbon.bg, by.ribbon.font], text: [by.text.bgColor, by.text.color, by.text.font],
        infog: [by.infog.bg, by.infog.font], icon: [by.icon.bg, by.icon.color], plat: JSON.stringify(by.plat),
        platDef: JSON.stringify({ ...cvLayerDefaults('plat'), id: by.plat.id, plats: by.plat.plats, x: by.plat.x, y: by.plat.y }),
      };
    });
    t.eq('новые стикер, лента, надпись, инфографика, значок — в цветах и шрифте аккаунта', JSON.stringify([added.sticker, added.ribbon, added.text, added.infog, added.icon]),
      JSON.stringify([['#112233', '#ffee00', '#ff00aa', 'russo'], ['#112233', 'russo'], ['#112233', '#ffee00', 'russo'], ['#112233', 'russo'], ['#112233', '#ffee00']]));
    t.ok('значки платформ стилем не перекрашиваются', added.plat === added.platDef, `${added.plat}\n${added.platDef}`);

    // ── Цвета аккаунта — первыми в образцах ──
    const sw = await page.evaluate(() => {
      cv._selLayer = cv.layers.find(L => L.type === 'sticker').id; cvLayersChanged();
      return [...document.querySelectorAll('#cv-layers-card [data-cv-lv^="bg:"]')].map(b => b.dataset.cvLv.slice(3));
    });
    t.ok('в образцах цвета слоя цвета аккаунта — первыми, без повторов', JSON.stringify(sw.slice(0, 3)) === JSON.stringify(['#112233', '#ffee00', '#ff00aa']) && new Set(sw.map(c => c.toLowerCase())).size === sw.length, JSON.stringify(sw));

    // ── Перекрасить готовую обложку и отменить ──
    const re = await page.evaluate(() => {
      cv.layers = [{ ...cvLayerDefaults('sticker') }, { ...cvLayerDefaults('text') }, { ...cvLayerDefaults('plat') }];
      const before = JSON.stringify(cv.layers);
      cvAccAction('apply');
      const after = cv.layers.map(L => [L.type, L.bg || L.bgColor || '', L.font || ''].join(':'));
      const undoBtn = !!document.querySelector('[data-cv-la="undo"]');
      cvLayerAction('undo');
      return { after, undoBtn, back: JSON.stringify(cv.layers) === before };
    });
    t.ok('«Перекрасить обложку» переводит готовые элементы в стиль, «↶ Отменить» возвращает как было', JSON.stringify(re.after) === JSON.stringify(['sticker:#112233:russo', 'text:#112233:russo', 'plat::']) && re.undoBtn && re.back, JSON.stringify(re));

    // ── Логотип: загрузка файла ──
    const bigLogo = await makeLogo(page, 1200, 600, '#ff0000');
    await page.setInputFiles('#cv-acc-logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(bigLogo.split(',')[1], 'base64') });
    await page.waitForFunction(() => !!(state.settings.accounts[0].style || {}).logo);
    const up = await page.evaluate(async () => {
      const d = state.settings.accounts[0].style.logo;
      const im = new Image(); await new Promise(r => { im.onload = r; im.src = d; });
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return { w: im.width, h: im.height, png: d.startsWith('data:image/png;base64,'), len: d.length, left: [...g.getImageData(10, 10, 1, 1).data], right: g.getImageData(im.width - 10, 10, 1, 1).data[3], preview: !!document.querySelector('#cv-acc-card img') };
    });
    t.ok('логотип ужат до 400 px по длинной стороне, PNG, прозрачность сохранена, превью в карточке', up.w === 400 && up.h === 200 && up.png && up.len <= 200000 && up.left[0] > 240 && up.left[3] === 255 && up.right === 0 && up.preview, JSON.stringify(up));

    // ── Слой «Логотип»: рисует логотип выбранного аккаунта ──
    const logoB = await makeLogo(page, 200, 100, '#ffff00');   // обложка синяя — логотип жёлтый
    const lay = await page.evaluate(async logoB => {
      state.settings.accounts[1].style = { ...CV_ACC_STYLE_DEF, logo: logoB }; save();
      cv.layers = []; cvAddLayer('logo');
      const L = cv.layers[0]; L.x = 0.5; L.y = 0.5; cv._selLayer = null;
      await cvAssetsReady();
      const px = () => { const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {}); const g = c.getContext('2d'); return [[...g.getImageData(540 - 50, 675, 1, 1).data].slice(0, 3), [...g.getImageData(540 + 50, 675, 1, 1).data].slice(0, 3)]; };
      const f = cvLayerFrame(L, 1080, 1350);
      const a1 = px();
      cv.acc = 'a2'; cvCurLogo(); await cvAssetsReady();
      const a2 = px();
      L.opacity = 0.5; const half = px();
      cv.acc = 'a1';
      return { w: Math.round(f.w), h: Math.round(f.h), a1, a2, half, row: (cvLayerRowsHTML().match(/Логотип · [^<]+/) || [''])[0] };
    }, logoB);
    t.ok('«+ Логотип» — картинка аккаунта 220 px по длинной стороне, прозрачное место видно насквозь', lay.w === 220 && lay.h === 110 && lay.a1[0][0] > 240 && lay.a1[0][2] < 15 && lay.a1[1][2] > 240, JSON.stringify(lay));
    t.ok('сменил аккаунт во вкладке — на обложке логотип другого аккаунта', lay.a2[0][0] > 240 && lay.a2[0][1] > 240 && lay.a2[0][2] < 15, JSON.stringify(lay));
    t.ok('плотность логотипа работает, в списке слой подписан аккаунтом', lay.half[0].every(v => v > 100 && v < 160) && lay.row === 'Логотип · Поиграем', JSON.stringify(lay));

    const none = await page.evaluate(async () => {
      state.settings.accounts[0].style.logo = ''; save();
      cv.layers = []; cvAddLayer('logo'); const L = cv.layers[0]; L.x = 0.5; L.y = 0.5;
      const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
      const p = [...c.getContext('2d').getImageData(540, 675, 1, 1).data].slice(0, 3);
      cvLayersChanged();
      return { p, warn: /нет логотипа/.test(document.querySelector('#cv-layers-card .cv-leditor').textContent) };
    });
    t.ok('у аккаунта нет логотипа — слой ничего не рисует, в редакторе подсказка, где загрузить', none.p[2] > 240 && none.p[0] < 15 && none.warn, JSON.stringify(none));

    // ── Скачивание ждёт раскодирования логотипа ──
    const wait = await page.evaluate(async () => {
      const c0 = document.createElement('canvas'); c0.width = 300; c0.height = 150;
      const g0 = c0.getContext('2d'); g0.fillStyle = '#ff00ff'; g0.fillRect(0, 0, 300, 150);
      state.settings.accounts[0].style.logo = c0.toDataURL('image/png');   // новая строка — картинка ещё не грузилась
      cv.layers = [{ ...cvLayerDefaults('logo'), x: 0.5, y: 0.5 }];
      await cvAssetsReady();
      const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
      return [...c.getContext('2d').getImageData(540, 675, 1, 1).data].slice(0, 3);
    });
    t.ok('перед скачиванием логотип успевает загрузиться (в файл не уходит обложка без него)', wait[0] > 240 && wait[2] > 240 && wait[1] < 15, JSON.stringify(wait));

    // ── Находки ревью Ф4: новый элемент встаёт в угол по НАСТОЯЩЕМУ размеру ──
    const place = await page.evaluate(async () => {
      const c0 = document.createElement('canvas'); c0.width = 200; c0.height = 200;
      const g0 = c0.getContext('2d'); g0.fillStyle = '#00ffff'; g0.fillRect(0, 0, 200, 200);
      // квадратный логотип, которого ещё не грузили: до загрузки рамка — заглушка 220×110
      state.settings.accounts[0].style = { ...CV_ACC_STYLE_DEF, font: 'rubik', logo: c0.toDataURL('image/png') };
      cv.acc = 'a1'; cv.layers = [];
      cvAddLayer('logo');
      const L = cv.layers[0];
      await cvAssetsReady(); await new Promise(r => setTimeout(r, 50));
      const f = cvLayerFrame(L, 1080, 1350);
      // инфографика шрифтом аккаунта, который ещё не скачан
      cv.layers = []; cvAddLayer('infog');
      const I = cv.layers[0];
      await document.fonts.load(cvFontStr(I, 40), CV_FONT_SAMPLE); await new Promise(r => setTimeout(r, 50));
      const fi = cvLayerFrame(I, 1080, 1350);
      return { logoR: Math.round(f.cx + f.w / 2), logoB: Math.round(f.cy + f.h / 2), logoH: Math.round(f.h), igL: Math.round(fi.cx - fi.w / 2), igFont: I.font,
        wantR: Math.round(1080 - 1080 * 0.045), wantB: Math.round(1350 - 1350 * 0.06), wantL: Math.round(1080 * 0.045) };
    });
    t.ok('логотип, которого ещё не грузили, встаёт в угол по своему размеру, а не по заглушке (ревью Ф4)', place.logoH === 220 && Math.abs(place.logoR - place.wantR) <= 1 && Math.abs(place.logoB - place.wantB) <= 1, JSON.stringify(place));
    t.ok('инфографика шрифтом аккаунта держит отступ от края (стиль до постановки, после загрузки шрифта — заново)', place.igFont === 'rubik' && Math.abs(place.igL - place.wantL) <= 1, JSON.stringify(place));

    // ── Мусор с чужих рук ──
    const junk = await page.evaluate(() => {
      state.settings.accounts[0].style = { main: 'red', text: '#12345', accent: null, font: 'comic', logo: 'javascript:alert(1)' };
      const a = cvAccStyle('a1');
      state.settings.accounts[0].style = { logo: 'data:image/png;base64,' + 'A'.repeat(CV_LOGO_MAX_CHARS) };
      const b = cvAccStyle('a1');
      state.settings.accounts[0].style = 'строка';
      const c = cvAccStyle('a1');
      let drawn = true;
      try { cvRefreshLayersCard(); render(); const cc = document.createElement('canvas'); cvDrawGame(cc, cv.images[0], {}); } catch (e) { drawn = String(e); }
      return { a, blen: b.logo.length, c, drawn, unknown: cvAccStyle('нет-такого') };
    });
    t.ok('битые цвета, чужой шрифт и не-картинка вместо логотипа — к заводским; слишком тяжёлый логотип не принимается', JSON.stringify(junk.a) === JSON.stringify({ main: '#b45309', text: '#ffffff', accent: '#facc15', font: 'mono', logo: '' }) && junk.blen === 0 && junk.c === null && junk.drawn === true, JSON.stringify(junk));

    // ── Снять стиль ──
    const drop = await page.evaluate(() => {
      state.settings.accounts[0].style = { ...CV_ACC_STYLE_DEF, main: '#123456' }; save(); render();
      window.confirm = () => true; cvAccAction('drop');
      return { gone: !state.settings.accounts[0].style, other: !!state.settings.accounts[1].style, card: !!document.querySelector('#cv-acc-card [data-cv-acc="create"]') };
    });
    t.ok('«Снять стиль» забывает стиль только этого аккаунта', drop.gone && drop.other && drop.card, JSON.stringify(drop));

    // ── F5 и свой шаблон ──
    await page.evaluate(() => {
      state.settings.accounts[0].style = { ...CV_ACC_STYLE_DEF, main: '#654321', font: 'oswald' };
      cv.acc = 'a2'; cv.layers = [{ ...cvLayerDefaults('logo'), x: 0.3, y: 0.3 }];
      save(); window.prompt = () => 'С логотипом'; cvSaveTpl(); cvReDraw();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const kept = await page.evaluate(() => {
      const r = { acc: cv.acc, style: cvAccStyle('a1'), logoB: !!cvAccStyle('a2').logo, live: cv.layers.map(L => L.type).join(',') };
      cv.layers = []; cvApplyTpl(cv.tpls.find(t => t.name === 'С логотипом').id);
      r.tpl = cv.layers.map(L => L.type).join(',');
      return r;
    });
    t.ok('стиль, логотип, выбранный аккаунт и слой «Логотип» переживают F5 и свой шаблон', kept.acc === 'a2' && kept.style.main === '#654321' && kept.style.font === 'oswald' && kept.logoB && kept.live === 'logo' && kept.tpl === 'logo', JSON.stringify(kept));

    // удалённый аккаунт, оставшийся выбранным в обложках, — первый аккаунт, а не пустота
    await page.click('[data-tab="covers"]');
    const gone = await page.evaluate(() => { cv.acc = 'удалённый'; render(); return { sel: document.querySelector('[data-cv-acc-sel]').value, s: cvCurStyle().main }; });
    t.ok('выбранный в обложках аккаунт удалён — берётся первый', gone.sel === 'a1' && gone.s === '#654321', JSON.stringify(gone));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }
}
