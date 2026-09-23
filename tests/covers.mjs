// Обложки: кадр игры (сдвиг на 100%, «вписать целиком»), пропорции превью,
// своя прокрутка колонок, масштаб колесом и тачпадом.
import { openApp } from './lib.mjs';

// Портретная «обложка» 700×1000: верхние 50 px красные (там «название игры»), остальное синее.
// В рамке 4:5 режим «заполнить» срезает сверху ~62 px — красная полоса пропадает.
const loadCover = page => page.evaluate(async () => {
  const src = document.createElement('canvas');
  src.width = 700; src.height = 1000;
  const g = src.getContext('2d');
  g.fillStyle = '#0000ff'; g.fillRect(0, 0, 700, 1000);
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 700, 50);
  const el = new Image();
  await new Promise(r => { el.onload = r; el.src = src.toDataURL('image/png'); });
  cv.mode = 'game'; cv.ratio = '4:5'; cv.gamePad = 0; cv.gameCorner = 0; cv.gameBorder = 0;
  cv.gameShadow = false; cv.gameFit = 'cover'; cv.gameFill = 'blur'; cv.bg = '#00ff00'; cv.bgStyle = 'solid';
  cv.vignette = false; cv.grade = 'none'; cv.maskSticker = false; cv.textOverlay = false; cv.infog = false; cv.platBadge = false;
  cv.images = [{ id: 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }];
  render();
});

// Цвет пикселя холста превью (в координатах холста 1080×1350)
const px = (page, x, y) => page.evaluate(([x, y]) => {
  const d = document.getElementById('cv-canvas').getContext('2d').getImageData(x, y, 1, 1).data;
  return d[0] > 200 && d[1] < 60 && d[2] < 60 ? 'red' : d[2] > 200 && d[0] < 60 ? 'blue' : d[1] > 200 && d[0] < 60 ? 'green' : `rgb(${d[0]},${d[1]},${d[2]})`;
}, [x, y]);

export async function runCovers(browser, base, t) {
  t.section('covers — кадр обложки, превью, прокрутка');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await loadCover(page);

    // ── Математика кадра ──
    const m = await page.evaluate(() => {
      const el = cv.images[0].el;
      const base = cvFitSrcRect(el, 1080, 1350, { scale: 1, ox: 0, oy: 0 });
      const up = cvFitSrcRect(el, 1080, 1350, { scale: 1, ox: 0, oy: -1 });
      const down = cvFitSrcRect(el, 1080, 1350, { scale: 1, ox: 0, oy: 1 });
      const side = cvFitSrcRect(el, 1080, 1350, { scale: 1, ox: 5, oy: 0 });
      const c = cvFitSrcRect(el, 1080, 1350, { scale: 1, ox: 0, oy: 0 }, 'contain');
      const sq = cvFitSrcRect(el, 1080, 1080, { scale: 1, ox: 0, oy: 0 }, 'contain');
      return { base, up, down, side, c, sq };
    });
    t.ok('«заполнить»: без сдвига верх обложки срезан', m.base.sy > 50, JSON.stringify(m.base));
    t.eq('на 100% кадр сдвигается до самого верха (раньше стоял намертво)', Math.round(m.up.sy), 0);
    t.eq('и до самого низа', Math.round(m.down.sy + m.down.sh), 1000);
    t.eq('по оси без запаса сдвига нет', Math.round(m.side.sx), 0);
    t.ok('сдвиг за краем ограничен и отдан обратно в долях', m.up.toy < 0 && m.up.toy > -1, String(m.up.toy));
    const inside = r => r.sx <= 0.01 && r.sy <= 0.01 && r.sx + r.sw >= 699.99 && r.sy + r.sh >= 999.99;
    t.ok('«вписать целиком» 4:5: окно охватывает всю картинку', inside(m.c), JSON.stringify(m.c));
    t.ok('«вписать целиком» 1:1: тоже вся картинка', inside(m.sq), JSON.stringify(m.sq));

    // ── Отрисовка ──
    t.eq('«заполнить»: вверху холста не красное (срезано)', await px(page, 540, 5), 'blue');
    await page.evaluate(() => { cv.images[0].transform.oy = -1; cvReDraw(); });
    t.eq('после сдвига вверх название вернулось в кадр', await px(page, 540, 5), 'red');

    await page.click('[data-cv-game-fit="contain"]');
    const afterFit = await page.evaluate(() => ({ fit: cv.gameFit, t: cv.images[0].transform, fillRow: !!document.querySelector('[data-cv-game-fill="bg"]') }));
    t.eq('кнопка «Вписать целиком» включает режим', afterFit.fit, 'contain');
    t.ok('смена кадра сбрасывает сдвиг', afterFit.t.scale === 1 && afterFit.t.ox === 0 && afterFit.t.oy === 0, JSON.stringify(afterFit.t));
    t.ok('появился выбор полей', afterFit.fillRow);
    // 700×1000 в 1080×1350: картинка 945 px шириной, поля по 67 px слева и справа
    t.eq('вписано: красная полоса у верхнего края холста', await px(page, 540, 5), 'red');
    t.eq('вписано: синий низ тоже в кадре', await px(page, 540, 1340), 'blue');
    const blurEdge = await px(page, 10, 675);
    t.ok('поля по умолчанию — размытая обложка, не фон', blurEdge !== 'green' && blurEdge !== 'red', blurEdge);
    await page.click('[data-cv-game-fill="bg"]');
    t.eq('поля «цвет фона» — фон', await px(page, 10, 675), 'green');
    await page.evaluate(() => { cv.gamePad = 40; cv.gameShadow = true; cvReDraw(); });
    t.eq('с тенью поля под вписанной обложкой — фон, а не чёрная подложка', await px(page, 60, 675), 'green');
    await page.evaluate(() => { cv.gamePad = 0; cv.gameShadow = false; cvReDraw(); });

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('avito_cv') || '{}'));
    t.ok('режим кадра переживает F5', saved.gameFit === 'contain' && saved.gameFill === 'bg', JSON.stringify({ f: saved.gameFit, g: saved.gameFill }));

    // ── Пропорции превью (4:5 сплющивался в квадрат) ──
    await page.evaluate(() => { cv.gameFit = 'cover'; render(); });
    const shape = await page.evaluate(() => {
      const r = document.getElementById('cv-canvas').getBoundingClientRect();
      const wrap = document.querySelector('.cv-preview-wrap').getBoundingClientRect();
      const bar = document.getElementById('cv-tz-scale')?.closest('.cv-transform-bar')?.getBoundingClientRect();
      return { ratio: r.width / r.height, bottom: wrap.bottom, bar: bar ? bar.bottom : null, vh: innerHeight };
    });
    t.ok('превью 4:5 держит пропорции', Math.abs(shape.ratio - 0.8) < 0.01, String(shape.ratio));
    t.ok('колонка превью целиком на экране', shape.bottom <= shape.vh + 1, JSON.stringify(shape));
    t.ok('холст и панель масштаба видны без прокрутки', shape.bar !== null && shape.bar <= shape.vh, JSON.stringify(shape));
    await page.click('[data-cv-ratio="1:1"]');
    const sq = await page.evaluate(() => { const r = document.getElementById('cv-canvas').getBoundingClientRect(); return r.width / r.height; });
    t.ok('превью 1:1 — квадрат', Math.abs(sq - 1) < 0.01, String(sq));
    await page.click('[data-cv-ratio="4:5"]');

    // ── Своя прокрутка колонок ──
    const col = await page.evaluate(() => {
      const c = document.querySelector('.cv-controls');
      const cs = getComputedStyle(c);
      return { oy: cs.overflowY, scrolls: c.scrollHeight > c.clientHeight, pageTall: document.documentElement.scrollHeight - innerHeight };
    });
    t.eq('меню слева прокручивается само', col.oy, 'auto');
    t.ok('и оно длиннее экрана (проверка не пустая)', col.scrolls);
    t.ok('страница больше не тянется за меню', col.pageTall < 150, String(col.pageTall));
    const kept = await page.evaluate(() => {
      document.querySelector('.cv-controls').scrollTop = 300;
      document.querySelector('[data-cv-toggle="gameShadow"]').click();
      return document.querySelector('.cv-controls').scrollTop;
    });
    t.eq('переключатель не сбрасывает прокрутку меню наверх', kept, 300);
    t.ok('после перерисовки вкладки панель масштаба на месте', await page.evaluate(() => !!document.getElementById('cv-tz-scale')));
    await page.evaluate(() => { cv.gameShadow = false; render(); });

    // ── Масштаб колесом / тачпадом ──
    const wheel = await page.evaluate(() => {
      const c = document.getElementById('cv-canvas');
      const t = cv.images[0].transform;
      const fire = (deltaY, ctrlKey = false) => c.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey, cancelable: true, bubbles: true }));
      t.scale = 1; fire(-4); const pad1 = t.scale;
      t.scale = 1; for (let i = 0; i < 30; i++) fire(-4); const pad30 = t.scale;
      t.scale = 1; fire(-100); const mouse = t.scale;
      t.scale = 1; fire(-10, true); const pinch = t.scale;
      t.scale = 2; fire(1000); const floor = t.scale;
      const slider = +document.getElementById('cv-tz-scale').value;
      return { pad1, pad30, mouse, pinch, floor, slider };
    });
    t.ok('одно событие тачпада — малый шаг', wheel.pad1 > 1 && wheel.pad1 < 1.02, String(wheel.pad1));
    t.ok('жест тачпада (30 событий) — плавно, а не сразу 400%', wheel.pad30 > 1.1 && wheel.pad30 < 1.4, String(wheel.pad30));
    t.ok('щелчок колеса мыши — около 15%', wheel.mouse > 1.1 && wheel.mouse < 1.2, String(wheel.mouse));
    t.ok('щипок тачпада масштабирует', wheel.pinch > 1.05, String(wheel.pinch));
    t.eq('меньше 100% не уходит', wheel.floor, 1);
    t.eq('ползунок следует за колесом', wheel.slider, 100);

    // ── Перетаскивание без мёртвого хода ──
    const drag = await page.evaluate(() => {
      const c = document.getElementById('cv-canvas');
      const r = c.getBoundingClientRect();
      const t = cv.images[0].transform; t.scale = 1; t.ox = 0; t.oy = 0; cvReDraw();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, y) => c.dispatchEvent(new MouseEvent(type, { clientX: cx, clientY: y, button: 0, bubbles: true }));
      ev('mousedown', cy); ev('mousemove', cy + 400); // тянем вниз далеко за край
      const atEdge = t.oy;
      ev('mousemove', cy + 390); // и чуть назад
      const back = t.oy;
      ev('mouseup', cy + 390);
      return { atEdge, back };
    });
    t.ok('тянем вниз — упёрлись в верх обложки', drag.atEdge < 0, String(drag.atEdge));
    t.ok('повели назад — кадр сразу поехал', drag.back > drag.atEdge, JSON.stringify(drag));

    // ── Коллаж: сдвиг ячейки на 100% тоже работает ──
    const coll = await page.evaluate(() => {
      const el = cv.images[0].el;
      cv.mode = 'collage'; cv.layout = 'single'; cv._selCell = 0; cv.images[0].transform = { scale: 1, ox: 0, oy: 0 };
      render();
      document.querySelector('[data-cv-tz="up"]').click();
      return cv.images[0].transform.oy;
    });
    t.ok('коллаж: стрелка ↑ на 100% сдвигает кадр', coll < 0, String(coll));

    // ── Коллаж: перетаскивание двигает кадр ячейки, а не меняет ячейки местами (решение Б) ──
    const cdrag = await page.evaluate(async () => {
      const mk = async c => { const s = document.createElement('canvas'); s.width = 600; s.height = 1600; const g = s.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 600, 1600);
        const el = new Image(); await new Promise(r => { el.onload = r; el.src = s.toDataURL(); }); return el; };
      cv.images = [];
      for (const c of ['#ff0000', '#00ff00']) { const el = await mk(c); cv.images.push({ id: cv.images.length + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }); }
      cv.mode = 'collage'; cv.ratio = '4:5'; cv.layout = '1x2'; cv._selCell = null; render();
      const c = document.getElementById('cv-canvas'), r = c.getBoundingClientRect();
      const ids = () => cv.images.map(i => i.id).join(',');
      const x0 = r.left + r.width * 0.25, y0 = r.top + r.height / 2;
      const ev = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      ev('mousedown', x0, y0); ev('mousemove', x0 + r.width * 0.5, y0 + 40); ev('mouseup', x0 + r.width * 0.5, y0 + 40);
      const afterDrag = { ids: ids(), oy: cv.images[0].transform.oy, other: cv.images[1].transform.oy, sel: cv._selCell };
      ev('mousedown', x0, y0); ev('mouseup', x0, y0);
      return { afterDrag, clickSel: cv._selCell };
    });
    t.eq('коллаж: перетаскивание не меняет ячейки местами', cdrag.afterDrag.ids, '1,2');
    t.ok('коллаж: перетаскивание сдвигает кадр своей ячейки', cdrag.afterDrag.oy < 0, JSON.stringify(cdrag.afterDrag));
    t.eq('соседняя ячейка не тронута', cdrag.afterDrag.other, 0);
    t.eq('клик по ячейке выделяет её для масштаба', cdrag.clickSel, 0);

    const c4dPan = await page.evaluate(async () => {
      // circ4d: треугольники раньше рисовались без учёта сдвига — проверяем, что сдвиг меняет картинку.
      // Картинка с градиентом: на однотонной сдвиг не виден.
      const s = document.createElement('canvas'); s.width = 600; s.height = 800;
      const g = s.getContext('2d'), gr = g.createLinearGradient(0, 0, 600, 800);
      gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(0, 0, 600, 800);
      const el = new Image(); await new Promise(r => { el.onload = r; el.src = s.toDataURL(); });
      const mkImgs = () => [0, 1, 2, 3, 4].map(i => ({ id: i + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }));
      cv.layout = 'circ4d'; cv.ratio = '1:1'; cv.images = mkImgs();
      const cnv = document.createElement('canvas');
      cvDrawCollage(cnv); const a = cnv.toDataURL();
      cv.images[1].transform = { scale: 2, ox: 0.2, oy: 0.2 };
      cvDrawCollage(cnv); const b = cnv.toDataURL();
      cv.ratio = '4:5'; cv.layout = 'auto';
      return a !== b;
    });
    t.ok('circ4d: масштаб и сдвиг треугольника учитываются', c4dPan);

    // ── «Круг+4» с четырьмя фото рисуется «авто»-сеткой — той же, по которой идут швы и клики ──
    const c4of4 = await page.evaluate(() => {
      const el = cv.images[0].el;
      cv.images = [0, 1, 2, 3].map(i => ({ id: i + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }));
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      cv.layout = 'circ4'; cvDrawCollage(a);
      cv.layout = cvResolveLayout('auto', 4); cvDrawCollage(b);
      cv.layout = 'auto';
      return a.toDataURL() === b.toDataURL();
    });
    t.ok('«Круг+4» с 4 фото рисуется той же сеткой, что «авто»', c4of4);

    // ── Неоновый шов не перечёркивает центральный круг (circ4d) ──
    const neon = await page.evaluate(async () => {
      const mk = async c => { const s = document.createElement('canvas'); s.width = 600; s.height = 800; const g = s.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 600, 800);
        const el = new Image(); await new Promise(r => { el.onload = r; el.src = s.toDataURL(); }); return el; };
      const imgs = [];
      for (const c of ['#0000ff', '#ff0000', '#ff0000', '#ff0000', '#ff0000']) { const el = await mk(c); imgs.push({ id: imgs.length + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }); }
      cv.mode = 'collage'; cv.ratio = '1:1'; cv.layout = 'circ4d'; cv.padding = 12; cv._selCell = null;
      cv.neonGap = true; cv.neonColor = '#ffffff'; cv.platBadge = false; cv.infog = false;
      cv.images = imgs; render();
      const g = document.getElementById('cv-canvas').getContext('2d');
      const at = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
      const cx = 540, cy = 540, off = 1080 * 0.16, p = 12;
      // шов (cx-off,cy)–(cx+off,cy) лежит под кругом; шов из угла (p,p) к (cx,cy-off) — снаружи
      const res = { inCircle: at(cx + 50, cy), seam: at(p + 0.2 * (cx - p), p + 0.2 * (cy - off - p)) };
      // circ4 (скриншот Дениса): вертикальный шов сетки 2×2 у x = p + hw проходит сквозь круг
      // render() пересоздаёт холст — контекст берём заново, иначе читаем старую картинку
      cv.layout = 'circ4'; render();
      const g2 = document.getElementById('cv-canvas').getContext('2d');
      const at2 = (x, y) => [...g2.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
      const hw = (1080 - 3 * p) / 2;
      res.c4In = at2(p + hw, cy + 100);
      res.c4Out = at2(p + hw, 60);
      cv.neonGap = false; cv.ratio = '4:5';
      return res;
    });
    t.ok('неоновый шов не перечёркивает круг', neon.inCircle[2] > 200 && neon.inCircle[0] < 60 && neon.inCircle[1] < 60, JSON.stringify(neon.inCircle));
    t.ok('швы между треугольниками вне круга на месте', neon.seam[1] > 150 && neon.seam[2] > 150, JSON.stringify(neon.seam));
    t.ok('«Круг+4»: шов сетки не просвечивает через круг', neon.c4In[2] > 200 && neon.c4In[0] < 60 && neon.c4In[1] < 60, JSON.stringify(neon.c4In));
    t.ok('«Круг+4»: шов сетки вне круга на месте', neon.c4Out[1] > 150 && neon.c4Out[2] > 150, JSON.stringify(neon.c4Out));

    // ── Перетащенная инфографика не уходит за край (ситуация Дениса: утащили вниз в 4:5, включили квадрат) ──
    const ov = await page.evaluate(() => {
      cv.layout = 'auto'; cv.ratio = '1:1';
      cv.infog = true; cv.infogText = 'строка один\nстрока два'; cv.infogX = 100; cv.infogY = 1250;
      cv.maskSticker = true; cv.maskStickerText = 'ХИТ'; cv.maskStickerX = 5000; cv.maskStickerY = -300;
      cv.textOverlay = true; cv.textOverlayText = 'текст'; cv.textOverlayX = -900; cv.textOverlayY = 9000;
      render();
      const c = document.getElementById('cv-canvas');
      const m = cvInfogMetrics(c.getContext('2d'), c.width, c.height);
      const res = { h: c.height, iy: cv.infogY, ih: m.totalH, sx: cv.maskStickerX, sy: cv.maskStickerY, sz: cv.maskStickerSize,
        tx: cv.textOverlayX, ty: cv.textOverlayY, saved: JSON.parse(localStorage.getItem('avito_cv')).infogY };
      cv.infog = false; cv.maskSticker = false; cv.textOverlay = false; cv.ratio = '4:5'; cvSave();
      return res;
    });
    t.ok('инфографика из-за нижнего края вернулась на холст', ov.iy + ov.ih <= ov.h && ov.iy >= 0, JSON.stringify(ov));
    t.ok('и новая позиция сохранена', ov.saved === ov.iy, JSON.stringify(ov));
    t.ok('стикер за краем вернулся на холст', ov.sx + ov.sz / 2 <= 1080 && ov.sy - ov.sz / 2 >= 0, JSON.stringify(ov));
    t.ok('текст за краем вернулся на холст', ov.tx > 0 && ov.tx < 1080 && ov.ty > 0 && ov.ty < 1080, JSON.stringify(ov));

    // ── Раскладка «Рамка» удалена, сохранённый выбор не ломает коллаж ──
    const fr = await page.evaluate(() => ({ btn: !!document.querySelector('[data-cv-layout="frame5"]'), resolved: cvResolveLayout('frame5', 5) }));
    t.ok('кнопки «Рамка» больше нет', !fr.btn);
    t.ok('старый выбор «Рамка» откатывается на авто', fr.resolved !== 'frame5' && !!fr.resolved, fr.resolved);

    // ── Выбор кадра без обложки переживает F5 (находка код-ревью) ──
    await page.evaluate(() => { cv.mode = 'game'; cv.images = []; cv.gameFit = 'cover'; cvSave(); render(); });
    await page.click('[data-cv-game-fit="contain"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    t.eq('«Вписать целиком» без обложки переживает F5', await page.evaluate(() => cv.gameFit), 'contain');

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
