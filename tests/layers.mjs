// Слои оформления обложки (24.09.2026): стикеры, ленты, надписи, инфографика, платформы.
// Форма растёт под текст, поворот и размер — ручками прямо на холсте, шаблоны, перевод
// прежних настроек (один стикер/текст/инфографика) в слои без потерь.
import { openApp } from './lib.mjs';

// Прежний плоский формат avito_cv — как он лежит у Дениса до этой версии
const LEGACY = {
  mode: 'game', ratio: '4:5', bg: '#123456',
  maskSticker: true, maskStickerText: 'ЛУЧШАЯ ЦЕНА', maskStickerShape: 'pill', maskStickerSize: 180,
  maskStickerPos: 'tr', maskStickerX: null, maskStickerY: null, maskStickerAngle: 15,
  maskStickerBg: '#dc2626', maskStickerColor: '#ffffff',
  textOverlay: false, textOverlayText: 'Мой текст', textOverlayX: 540, textOverlayY: 675,
  infog: true, infogText: '✔️ 405+ игр\n✔️ PS4 / PS5', infogX: 100, infogY: 900, infogSize: 38, infogAlign: 'left',
  platBadge: true, platSel: ['PS4', 'PS5'], platBadgePos: 'tl',
};

// Обложка-заглушка и режим «Игра» без рамки
const loadCover = page => page.evaluate(async () => {
  const src = document.createElement('canvas');
  src.width = 800; src.height = 1000;
  const g = src.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0, 0, 800, 1000);
  const el = new Image();
  await new Promise(r => { el.onload = r; el.src = src.toDataURL('image/png'); });
  cv.mode = 'game'; cv.ratio = '4:5'; cv.gamePad = 0; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = false;
  cv.gameFit = 'cover'; cv.bg = '#00ff00'; cv.bgStyle = 'solid'; cv.vignette = false; cv.grade = 'none';
  cv.images = [{ id: 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }];
  render();
});

// Точка холста (1080×1350) → экранные координаты превью
const toClient = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.getElementById('cv-canvas'), r = c.getBoundingClientRect();
  return { x: r.left + x * r.width / c.width, y: r.top + y * r.height / c.height };
}, [x, y]);

export async function runLayers(browser, base, t) {
  t.section('layers — слои оформления обложки');

  // ── Перевод прежних настроек в слои ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`, { storage: { avito_cv: LEGACY } });
    try {
      const m = await page.evaluate(() => ({
        types: cv.layers.map(L => L.type),
        st: cv.layers.find(L => L.type === 'sticker'),
        tx: cv.layers.find(L => L.type === 'text'),
        ig: cv.layers.find(L => L.type === 'infog'),
        pl: cv.layers.find(L => L.type === 'plat'),
        igLeft: (() => { const L = cv.layers.find(x => x.type === 'infog'); const f = cvLayerFrame(L, 1080, 1350); return { l: f.cx - f.w / 2, t: f.cy - f.h / 2 }; })(),
        bg: cv.bg,
      }));
      t.eq('старые стикер, текст, значки и инфографика стали слоями в прежнем порядке', m.types.join(','), 'sticker,text,plat,infog');
      t.ok('стикер сохранил текст, форму, цвет и угол', m.st.text === 'ЛУЧШАЯ ЦЕНА' && m.st.shape === 'pill' && m.st.bg === '#dc2626' && m.st.angle === 15, JSON.stringify(m.st));
      t.ok('стикер стоял в правом верхнем углу — там и остался', m.st.x > 0.7 && m.st.y < 0.2, JSON.stringify(m.st));
      t.ok('выключенная надпись со своим текстом переехала скрытой, а не пропала', m.tx && m.tx.hidden === true && m.tx.text === 'Мой текст', JSON.stringify(m.tx));
      t.ok('надпись — в тех же долях холста', Math.abs(m.tx.x - 0.5) < 1e-9 && Math.abs(m.tx.y - 0.5) < 1e-9, JSON.stringify(m.tx));
      // Перевод идёт при запуске, до загрузки JetBrains Mono: ширина блока меряется запасным
      // моноширинным шрифтом, после загрузки левый край уходит на ~10 px. Верх — точно.
      t.ok('перетащенная инфографика осталась на месте (левый верх блока)', Math.abs(m.igLeft.l - 100) < 20 && Math.abs(m.igLeft.t - 900) < 1, JSON.stringify(m.igLeft));
      t.ok('значки платформ — те же', m.pl && m.pl.plats.join('/') === 'PS4/PS5', JSON.stringify(m.pl));
      t.eq('прочие настройки не тронуты', m.bg, '#123456');
      await page.click('[data-tab="covers"]');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('avito_cv')));
      t.ok('после сохранения старых ключей в настройках нет', !('maskSticker' in saved) && !('infogText' in saved) && Array.isArray(saved.layers) && saved.layers.length === 4, Object.keys(saved).join(','));
      // тот же перевод на входе с сервера и из файла-бэкапа
      const viaSync = await page.evaluate(L => { cv.layers = []; cvApplyCfg(L); return cv.layers.map(x => x.type).join(','); }, LEGACY);
      t.eq('настройки старого формата с сервера/из бэкапа тоже переводятся', viaSync, 'sticker,text,plat,infog');
      const keepNew = await page.evaluate(() => { const before = JSON.stringify(cv.layers); cvApplyCfg({ bg: '#000000' }); return JSON.stringify(cv.layers) === before; });
      t.ok('документ без слоёв и без старых ключей слои не трогает', keepNew);
      const junk = await page.evaluate(() => { cvApplyCfg({ layers: [null, { type: 'bomb' }, { type: 'sticker', x: 'abc', text: 'ok' }] }); return cv.layers; });
      t.ok('мусорные слои отсеиваются, битые координаты — в центр', junk.length === 1 && junk[0].x === 0.5 && junk[0].shape === 'burst', JSON.stringify(junk));
      t.ok('консоль чистая (миграция)', consoleErrors.length === 0, consoleErrors.join('\n'));
    } finally { await ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await loadCover(page);

    // ── Форма растёт под текст, а не текст мельчает ──
    const geo = await page.evaluate(() => {
      const mk = (shape, text) => cvStickerGeom({ ...cvLayerDefaults('sticker'), shape, text });
      const res = {};
      for (const [s] of CV_STICKER_SHAPES) {
        const a = mk(s, 'ХИТ'), b = mk(s, 'ПРЕДЗАКАЗ ДО 15 ОКТЯБРЯ');
        const ctx = cvMctx(); ctx.font = `bold ${b.fs}px ${CV_FONT_MONO}`;
        const tw = Math.max(...b.lines.map(l => ctx.measureText(l).width)), th = b.lines.length * b.lh;
        let fits;
        if (s === 'pill' || s === 'badge') fits = tw <= b.w - b.fs * 0.5 && th <= b.h;
        else if (s === 'diamond') fits = tw / 2 + th / 2 <= b.R;
        else if (s === 'hex') fits = Math.hypot(tw / 2, th / 2) <= b.R * 0.866;
        else if (s === 'circle') fits = Math.hypot(tw / 2, th / 2) <= b.R;
        else fits = Math.hypot(tw / 2, th / 2) <= b.inner;
        res[s] = { sameFont: a.fs === b.fs, grew: b.w > a.w, fits, lines: b.lines.length };
      }
      return res;
    });
    for (const [s, r] of Object.entries(geo)) {
      t.ok(`${s}: шрифт не мельчает от длины текста`, r.sameFont, JSON.stringify(r));
      t.ok(`${s}: форма выросла под длинный текст`, r.grew, JSON.stringify(r));
      t.ok(`${s}: текст целиком внутри формы`, r.fits, JSON.stringify(r));
    }
    t.ok('круглый стикер переносит длинный текст на строки', geo.circle.lines > 1, JSON.stringify(geo.circle));
    t.eq('пилюля держит текст одной строкой', geo.pill.lines, 1);

    // ── Инфографика: длинная строка не режется по буквам ──
    const ig = await page.evaluate(() => {
      const L = { ...cvLayerDefaults('infog'), text: '✔️ Очень длинная характеристика товара, которая раньше обрезалась по буквам\n✔️ PS5' };
      const g = cvInfogGeom(L, 1080);
      return { first: g.lines[0], w: g.w, fs: g.fs, size: L.size };
    });
    t.ok('строка инфографики целиком, без обрезки', ig.first.endsWith('по буквам'), ig.first);
    t.ok('блок уместился в холст за счёт шрифта', ig.w <= 1080 * 0.92 + 0.5 && ig.fs < ig.size, JSON.stringify(ig));

    // ── Лента в углу: надпись помещается, лента отодвигается от угла ──
    const rb = await page.evaluate(() => {
      const out = {};
      for (const c of ['tl', 'tr', 'bl', 'br']) {
        const L = { ...cvLayerDefaults('ribbon'), corner: c, text: 'ПРЕДЗАКАЗ' };
        const g = cvRibbonGeom(L, 1080, 1350);
        out[c] = { fits: g.tw + g.fs <= 2 * g.m - g.t, inside: g.cx > 0 && g.cx < 1080 && g.cy > 0 && g.cy < 1350 };
      }
      const s = cvRibbonGeom({ ...cvLayerDefaults('ribbon'), text: 'НОВИНКА' }, 1080, 1350).m;
      const l = cvRibbonGeom({ ...cvLayerDefaults('ribbon'), text: 'ПРЕДЗАКАЗ ДО КОНЦА НЕДЕЛИ' }, 1080, 1350).m;
      // пиксель на середине ленты в правом верхнем углу — цвет ленты
      cv.layers = [{ ...cvLayerDefaults('ribbon'), corner: 'tr', text: 'ПРЕДЗАКАЗ', bg: '#ff0000' }];
      cvReDraw();
      const g = cvRibbonGeom(cv.layers[0], 1080, 1350);
      // смещаемся от середины вдоль ленты, мимо букв
      const px = [...document.getElementById('cv-canvas').getContext('2d').getImageData(Math.round(g.cx + g.m * 0.6 * Math.cos(g.rot)), Math.round(g.cy + g.m * 0.6 * Math.sin(g.rot)), 1, 1).data];
      cv.layers = [];
      return { out, longer: l > s, px };
    });
    for (const [c, r] of Object.entries(rb.out)) t.ok(`лента ${c}: надпись в кромках, середина на холсте`, r.fits && r.inside, JSON.stringify(r));
    t.ok('длинная надпись отодвигает ленту от угла', rb.longer);
    t.ok('лента нарисована в углу', rb.px[0] > 200 && rb.px[1] < 60 && rb.px[2] < 60, JSON.stringify(rb.px));

    // ── Добавление из меню, выделение, ручки ──
    await page.click('[data-cv-la="add:sticker"]');
    const added = await page.evaluate(() => ({ n: cv.layers.length, sel: cv._selLayer === cv.layers[0].id, editor: !!document.querySelector('#cv-layers-card .cv-leditor'), row: !!document.querySelector('.cv-lrow.active') }));
    t.ok('«+ Стикер» добавляет слой и сразу выделяет его', added.n === 1 && added.sel && added.editor && added.row, JSON.stringify(added));

    await page.evaluate(() => { const L = cv.layers[0]; L.x = 0.5; L.y = 0.5; L.angle = 0; L.scale = 1; cvReDraw(); });
    // поворот: тянем белую ручку из-под верха вправо от центра — 90°
    const rot = await page.evaluate(() => {
      const L = cv.layers[0], c = document.getElementById('cv-canvas');
      const f = cvLayerFrame(L, 1080, 1350), h = cvLayerHandles(f, cvScreenK(c));
      return { h: h.rotate, cx: f.cx, cy: f.cy };
    });
    let p0 = await toClient(page, rot.h.x, rot.h.y), p1 = await toClient(page, rot.cx + 300, rot.cy);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up();
    const ang = await page.evaluate(() => ({ a: cv.layers[0].angle, ro: document.getElementById('cv-ltf')?.textContent, saved: JSON.parse(localStorage.getItem('avito_cv')).layers[0].angle }));
    t.eq('белая ручка крутит элемент (прилипает к 90°)', ang.a, 90);
    t.ok('угол виден в меню и сохранён', /90°/.test(ang.ro || '') && ang.saved === 90, JSON.stringify(ang));

    // размер: жёлтую ручку — вдвое дальше от центра
    const sc = await page.evaluate(() => {
      const L = cv.layers[0]; L.angle = 0; cvReDraw();
      const c = document.getElementById('cv-canvas'), f = cvLayerFrame(L, 1080, 1350), h = cvLayerHandles(f, cvScreenK(c));
      return { h: h.scale, cx: f.cx, cy: f.cy };
    });
    p0 = await toClient(page, sc.h.x, sc.h.y); p1 = await toClient(page, sc.cx + (sc.h.x - sc.cx) * 2, sc.cy + (sc.h.y - sc.cy) * 2);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up();
    const scale = await page.evaluate(() => cv.layers[0].scale);
    t.ok('жёлтая ручка меняет размер', scale > 1.8 && scale < 2.2, String(scale));

    // перенос за тело: прилипание к центру холста
    const mv = await page.evaluate(() => { const L = cv.layers[0]; L.scale = 1; L.x = 0.3; L.y = 0.3; cvReDraw(); return { x: 0.3 * 1080, y: 0.3 * 1350 }; });
    p0 = await toClient(page, mv.x, mv.y); p1 = await toClient(page, 540 + 3, 675 - 2);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 8 });
    const guides = await page.evaluate(() => cv._guides);
    await page.mouse.up();
    const moved = await page.evaluate(() => ({ x: cv.layers[0].x, y: cv.layers[0].y, g: cv._guides }));
    t.ok('элемент тянется мышкой и прилипает к центру холста', moved.x === 0.5 && moved.y === 0.5, JSON.stringify(moved));
    t.ok('во время переноса видны направляющие, после — убраны', guides && guides.v && guides.h && moved.g === null, JSON.stringify({ guides, after: moved.g }));

    // колесо над выделенным элементом меняет его, а не картинку
    const wh = await page.evaluate(() => {
      const c = document.getElementById('cv-canvas'), r = c.getBoundingClientRect();
      const L = cv.layers[0], s0 = L.scale, img0 = cv.images[0].transform.scale;
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, cancelable: true, bubbles: true }));
      return { grew: L.scale > s0, img: cv.images[0].transform.scale === img0 };
    });
    t.ok('колесо над элементом меняет его размер, кадр картинки не трогает', wh.grew && wh.img, JSON.stringify(wh));

    // рамка выделения — только в превью, не в файле
    const sel = await page.evaluate(() => {
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      cvDrawGame(a, cv.images[0], {});
      const id = cv._selLayer; cv._selLayer = null; cvDrawGame(b, cv.images[0], {}); cv._selLayer = id;
      cvReDraw();
      return { fileSame: a.toDataURL() === b.toDataURL(), liveDiffers: document.getElementById('cv-canvas').toDataURL() !== a.toDataURL() };
    });
    t.ok('рамка и ручки не попадают в скачанный файл', sel.fileSame);
    t.ok('а на превью видны', sel.liveDiffers);

    // щелчок мимо элементов снимает выделение
    p0 = await toClient(page, 60, 1300);
    await page.mouse.click(p0.x, p0.y);
    t.ok('щелчок мимо снимает выделение', await page.evaluate(() => cv._selLayer === null && !document.querySelector('#cv-layers-card .cv-leditor')));

    // ── Правка из меню ──
    await page.click('.cv-lrow');
    await page.fill('#cv-layers-card [data-cv-lp="text"]', 'НА РУССКОМ');
    await page.click('[data-cv-lv="shape:pill"]');
    const ed = await page.evaluate(() => ({ t: cv.layers[0].text, s: cv.layers[0].shape, row: document.querySelector('.cv-lrow-name').textContent }));
    t.ok('текст и форма правятся в меню, подпись в списке следует', ed.t === 'НА РУССКОМ' && ed.s === 'pill' && ed.row === 'НА РУССКОМ', JSON.stringify(ed));

    // клавиши: Del удаляет, «Отменить» возвращает
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Delete');
    const del = await page.evaluate(() => ({ n: cv.layers.length, undo: !!document.querySelector('[data-cv-la="undo"]') }));
    t.ok('Del удаляет выделенный элемент и предлагает отмену', del.n === 0 && del.undo, JSON.stringify(del));
    await page.click('[data-cv-la="undo"]');
    t.eq('«↶ Отменить» возвращает удалённое', await page.evaluate(() => cv.layers.length ? cv.layers[0].text : null), 'НА РУССКОМ');

    // ── Находки код-ревью ── (элементы до блока сохраняем и возвращаем в конце)
    const keepLayers = await page.evaluate(() => JSON.stringify(cv.layers));
    // №1: «Отменить» не стирает сделанное после удаления
    const undoStale = await page.evaluate(() => {
      const keep = cv.layers[0];
      cv._selLayer = keep.id; cvLayerAction('dup');           // второй элемент
      cvLayerAction('del');                                    // удалили копию → есть отмена
      const offered = !!document.querySelector('[data-cv-la="undo"]');
      cv._selLayer = keep.id; keep.text = 'ПОСЛЕ УДАЛЕНИЯ';   // правка после удаления
      const sw = document.createElement('button'); sw.dataset.cvLv = 'bg:#16a34a'; cvLayerClick(sw);
      const shownAfterEdit = !!document.querySelector('[data-cv-la="undo"]');
      const u = cv._layersUndo;
      cvLayerAction('undo');                                   // даже прямой вызов не откатывает
      return { offered, shownAfterEdit, undoKept: !!u, text: cv.layers[0].text, bg: cv.layers[0].bg, n: cv.layers.length };
    });
    t.ok('отмена предлагается сразу после удаления', undoStale.offered);
    t.ok('после следующей правки кнопка «Отменить» гаснет', !undoStale.shownAfterEdit, JSON.stringify(undoStale));
    t.ok('и отмена не стирает сделанное после', undoStale.text === 'ПОСЛЕ УДАЛЕНИЯ' && undoStale.bg === '#16a34a' && undoStale.n === 1, JSON.stringify(undoStale));
    const undoDrag = await page.evaluate(() => {
      const keep = cv.layers[0];
      cv._selLayer = keep.id; cvLayerAction('dup'); cvLayerAction('del');
      const before = cvUndoValid();
      keep.x = 0.2; keep.y = 0.2;                               // сдвинули мышкой (или стрелкой)
      return { before, after: cvUndoValid() };
    });
    t.ok('перенос элемента после удаления тоже гасит отмену', undoDrag.before && !undoDrag.after, JSON.stringify(undoDrag));
    const undoBg = await page.evaluate(() => {
      document.querySelector('[data-cv-tpl="apply:b-hit"]').click();
      const ok = cvUndoValid();
      cv.bg = '#654321';                                       // сменили фон после шаблона
      const gone = !cvUndoValid();
      cv.bg = '#00ff00';
      return { ok, gone };
    });
    t.ok('смена фона после шаблона гасит отмену шаблона', undoBg.ok && undoBg.gone, JSON.stringify(undoBg));

    // №2: координаты и числа строкой, платформы не списком
    const junk2 = await page.evaluate(() => {
      const saved = JSON.stringify(cv.layers);
      cvApplyCfg({ layers: [
        { type: 'sticker', text: 'СТРОКИ', x: '0.3', y: '0.4', scale: '1.5', angle: '10', size: '200' },
        { type: 'plat', plats: 'PS5', x: 0.5, y: 0.5 },
        { type: 'text', text: 12345 },
      ] });
      const [st, pl, tx] = cv.layers;
      cv._selLayer = st.id;
      document.body.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      let drawn = true;
      try { cvReDraw(); } catch (e) { drawn = false; }
      const res = { x: st.x, types: [typeof st.x, typeof st.y, typeof st.scale, typeof st.angle, typeof st.size].join(), plats: pl.plats, text: tx.text, drawn };
      cv.layers = JSON.parse(saved); cv._selLayer = null; cvReDraw();
      return res;
    });
    t.ok('числа строкой приводятся к числам', junk2.types === 'number,number,number,number,number', JSON.stringify(junk2));
    t.ok('стрелка сдвигает такой элемент, а не превращает координату в NaN', Math.abs(junk2.x - (0.3 + 1 / 1080)) < 1e-9, JSON.stringify(junk2));
    t.ok('платформы не списком не роняют обложку', Array.isArray(junk2.plats) && junk2.drawn, JSON.stringify(junk2));
    t.eq('текст не строкой — строкой', junk2.text, '12345');

    // №3: две инфографики в «4 вариантах» не ложатся друг на друга
    const twoIg = await page.evaluate(() => {
      const saved = JSON.stringify(cv.layers);
      const a = { ...cvLayerDefaults('infog'), text: 'Первая\nодин', x: 0.3, y: 0.85 };
      const b = { ...cvLayerDefaults('infog'), text: 'Вторая', x: 0.7, y: 0.2 };
      cv.layers = [a, b];
      // рисуем вариант с переопределением и смотрим пиксель в центре второй плашки: она на своём месте
      const c = document.createElement('canvas');
      cvDrawGame(c, cv.images[0], { infog: { align: 'right', bg: '#ff0000', shift: 0 } });
      const f = cvLayerFrame(b, 1080, 1350);
      const px = [...c.getContext('2d').getImageData(Math.round(f.cx - f.w / 2 + 8), Math.round(f.cy), 1, 1).data];
      cv.layers = JSON.parse(saved);
      return { px };
    });
    // обложка синяя (0,0,255); тёмная плашка #0f172a при 82% гасит синий — без плашки он был бы 255
    t.ok('вторая инфографика в варианте остаётся на своём месте и своего цвета', twoIg.px[0] < 60 && twoIg.px[2] < 150, JSON.stringify(twoIg));

    // №4: копия ленты — в видимо свободный угол (скрытые угол не занимают)
    const dupRb = await page.evaluate(() => {
      const saved = JSON.stringify(cv.layers);
      const hid = { ...cvLayerDefaults('ribbon'), corner: 'tr', hidden: true };
      const vis = { ...cvLayerDefaults('ribbon'), corner: 'tl' };
      cv.layers = [hid, vis]; cv._selLayer = vis.id;
      cvLayerAction('dup');
      const c = cv.layers.find(L => L.id === cv._selLayer).corner;
      cv.layers = JSON.parse(saved); cv._selLayer = null; cvLayersChanged();
      return c;
    });
    t.eq('копия ленты встаёт в видимо свободный угол', dupRb, 'tr');

    // №5: Backspace не удаляет элемент (фокус на кнопке цвета)
    const bs = await page.evaluate(() => {
      const L = cv.layers[0]; cv._selLayer = L.id; cvLayersChanged();
      const sw = document.querySelector('#cv-layers-card .cv-color'); sw.focus();
      sw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      return cv.layers.length;
    });
    t.eq('Backspace на кнопке цвета элемент не удаляет', bs, 1);
    await page.evaluate(s => { cv.layers = JSON.parse(s); cv._selLayer = null; cv._layersUndo = null; cvLayersChanged(); }, keepLayers);

    // ── Шаблоны ──
    await page.click('[data-cv-tpl="apply:b-preorder"]');
    const tp = await page.evaluate(() => cv.layers.map(L => `${L.type}:${L.text}:${L.corner}`).join('|'));
    t.eq('шаблон «Предзаказ» — лента ПРЕДЗАКАЗ в правом верхнем углу', tp, 'ribbon:ПРЕДЗАКАЗ:tr');
    await page.click('[data-cv-la="undo"]');
    t.eq('отмена шаблона возвращает прежние элементы', await page.evaluate(() => cv.layers.map(L => L.text).join('|')), 'НА РУССКОМ');

    // «Карточка товара» берёт строки и платформы из формы генератора
    const card = await page.evaluate(() => {
      state.form.category = 'game'; state.form.gameName = 'Elden Ring'; state.form.gamePlatforms = ['PS5']; state.form.gameGenre = '';
      document.querySelector('[data-cv-tpl="apply:b-card"]').click();
      const ig = cv.layers.find(L => L.type === 'infog'), pl = cv.layers.find(L => L.type === 'plat');
      const [cw, ch] = [1080, 1350];
      const fi = cvLayerFrame(ig, cw, ch);
      return { lines: cvLinesOf(ig.text), plats: pl.plats, igLeft: fi.cx - fi.w / 2, igBottom: fi.cy + fi.h / 2 };
    });
    t.ok('«Карточка товара»: инфографика из формы', card.lines[0] === '🕹️ Elden Ring' && card.lines.includes('⚡ Оформляется в цифре'), JSON.stringify(card.lines));
    t.eq('«Карточка товара»: платформы из формы', card.plats.join('/'), 'PS5');
    t.ok('инфографика встала в левый нижний угол', card.igLeft < 80 && card.igBottom > 1350 * 0.85, JSON.stringify(card));

    // свой шаблон: элементы + фон; строки из формы запоминаются «из формы», а не текстом этого товара
    await page.evaluate(() => { window.prompt = () => 'Мой стиль'; cv.bg = '#abcdef'; cvReDraw(); });
    await page.click('[data-cv-tpl="save"]');
    const own = await page.evaluate(() => ({ tpls: cv.tpls.map(t => t.name), ig: cv.tpls[0].layers.find(L => L.type === 'infog'), btn: !!document.querySelector('[data-cv-tpl^="apply:u"]') }));
    t.ok('свой шаблон сохранён и появился кнопкой', own.tpls.join() === 'Мой стиль' && own.btn, JSON.stringify(own.tpls));
    t.ok('нетронутая инфографика из формы сохранена ссылкой на форму', own.ig && own.ig.fromForm === true && own.ig.text === '', JSON.stringify(own.ig));
    const applied = await page.evaluate(() => {
      state.form.gameName = 'Hades II';
      cv.bg = '#000000'; cv.layers = [];
      document.querySelector('[data-cv-tpl^="apply:u"]').click();
      return { bg: cv.bg, types: cv.layers.map(L => L.type).join(','), first: cvLinesOf(cv.layers.find(L => L.type === 'infog').text)[0], ids: new Set(cv.layers.map(L => L.id)).size === cv.layers.length };
    });
    t.eq('свой шаблон возвращает фон', applied.bg, '#abcdef');
    t.eq('и элементы', applied.types, 'plat,infog');
    t.eq('строки инфографики — уже нового товара', applied.first, '🕹️ Hades II');
    t.ok('у слоёв из шаблона свои id', applied.ids);
    const snap = await page.evaluate(() => jCvSnapshot());
    t.ok('журнал скачивания не тащит библиотеку шаблонов', !('tpls' in snap) && Array.isArray(snap.layers), Object.keys(snap).join(','));

    // шаблоны переживают F5
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const persisted = await page.evaluate(() => ({ tpls: cv.tpls.map(t => t.name).join(), layers: cv.layers.map(L => L.type).join(',') }));
    t.ok('свои шаблоны и элементы переживают F5', persisted.tpls === 'Мой стиль' && persisted.layers === 'plat,infog', JSON.stringify(persisted));

    // ── «✨ 4 варианта» с инфографикой: варианты различаются, сам слой не сдвигается ──
    await page.click('[data-tab="covers"]');
    await loadCover(page);
    const vars = await page.evaluate(() => {
      const ig = cv.layers.find(L => L.type === 'infog');
      ig.text = 'Название\nодин\nдва\nтри'; const x0 = ig.x, y0 = ig.y;
      cvGenerateVariations();
      const urls = [0, 1, 2, 3].map(i => document.getElementById(`cv-var-${i}`).toDataURL());
      return { distinct: new Set(urls).size, kept: ig.x === x0 && ig.y === y0 };
    });
    t.eq('4 варианта различаются инфографикой', vars.distinct, 4);
    t.ok('варианты не двигают сам слой', vars.kept);

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
