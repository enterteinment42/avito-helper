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
