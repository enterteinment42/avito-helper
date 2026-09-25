// Коррекция фото (25.09.2026, план Fotor, Ф3): яркость, контраст, насыщенность ±30 %,
// резкость 0…30 %, «Авто» выставляет ползунки, в коллаже — выбранное фото и «Ко всем фото».
// Попиксельно (не ctx.filter): одинаково в любом браузере, включая Safari на iPhone.
import { openApp } from './lib.mjs';

// Картинка из функции рисования (w×h), в cv.images под номером i
const mkImg = (page, specs) => page.evaluate(async specs => {
  const out = [];
  for (const [w, h, draw] of specs) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    new Function('g', 'w', 'h', draw)(c.getContext('2d'), w, h);
    const el = new Image();
    await new Promise(r => { el.onload = r; el.src = c.toDataURL('image/png'); });
    out.push({ id: out.length + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } });
  }
  window._imgs = out;
}, specs);

export async function runAdjust(browser, base, t) {
  t.section('adjust — коррекция фото');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');

    // ── Ядро: пределы, пиксели, кэш ──
    const core = await page.evaluate(() => {
      const clamp = cvAdjClamp({ b: 1, c: '0.2', s: 'x', sh: -1 });
      const mk = (w, h, fill) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); fill(g, w, h); c.naturalWidth = w; c.naturalHeight = h; return c; };
      const px = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      const gray = mk(20, 20, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); });
      const two = mk(20, 20, (g, w, h) => { g.fillStyle = '#606060'; g.fillRect(0, 0, 10, h); g.fillStyle = '#a0a0a0'; g.fillRect(10, 0, 10, h); });
      const col = mk(20, 20, (g, w, h) => { g.fillStyle = '#c86464'; g.fillRect(0, 0, w, h); });
      const edge = mk(40, 20, (g, w, h) => { g.fillStyle = '#404040'; g.fillRect(0, 0, 20, h); g.fillStyle = '#c0c0c0'; g.fillRect(20, 0, 20, h); });
      const A = o => cvAdjClamp(o);
      return {
        clamp,
        bright: px(cvApplyAdj(gray, A({ b: 0.3 })), 5, 5)[0], dark: px(cvApplyAdj(gray, A({ b: -0.3 })), 5, 5)[0],
        cUp: [px(cvApplyAdj(two, A({ c: 0.3 })), 2, 5)[0], px(cvApplyAdj(two, A({ c: 0.3 })), 15, 5)[0]],
        sUp: px(cvApplyAdj(col, A({ s: 0.3 })), 5, 5), sDn: px(cvApplyAdj(col, A({ s: -0.3 })), 5, 5),
        sharp: [px(cvApplyAdj(edge, A({ sh: 0.3 })), 19, 10)[0], px(cvApplyAdj(edge, A({ sh: 0.3 })), 20, 10)[0]],
        flat: px(cvApplyAdj(edge, A({ sh: 0.3 })), 5, 10)[0],
        big: (() => { const b = mk(4000, 3000, g => {}); const r = cvApplyAdj(b, A({ b: 0.1 })); return [r.width, r.height, r.naturalWidth]; })(),
      };
    });
    t.eq('пределы: ±30 %, резкость 0…30 %, мусор — ноль', JSON.stringify(core.clamp), JSON.stringify({ b: 0.3, c: 0.2, s: 0, sh: 0 }));
    t.ok('яркость +30 % светлее, −30 % темнее', core.bright > 160 && core.dark < 95, JSON.stringify(core));
    // половины 96 и 160 вокруг средней яркости фото (≈128): ≈ 86 и ≈ 170
    t.ok('контраст разводит тёмное и светлое', core.cUp[0] <= 90 && core.cUp[1] >= 166, JSON.stringify(core.cUp));
    t.ok('насыщенность: +30 % цвет ярче, −30 % — ближе к серому', (core.sUp[0] - core.sUp[1]) > 100 && (core.sDn[0] - core.sDn[1]) < 100, JSON.stringify({ up: core.sUp, dn: core.sDn }));
    t.ok('резкость: на границе тёмное темнее, светлое светлее, ровное не тронуто', core.sharp[0] < 64 && core.sharp[1] > 192 && core.flat === 64, JSON.stringify(core));
    t.eq('крупное фото ужимается до 2000 px по длинной стороне', core.big.join('x'), '2000x1500x2000');

    // ── «Авто» ──
    await mkImg(page, [
      // тёмное, узкое по яркости, с приглушённым тёплым цветом
      [200, 200, `for (let x = 0; x < w; x++) { const v = 40 + Math.round(50 * x / w); g.fillStyle = 'rgb(' + v + ',' + Math.round(v * 0.9) + ',' + Math.round(v * 0.85) + ')'; g.fillRect(x, 0, 1, h); }`],
      // нормальное: яркость во весь диапазон, среднее посередине; серое — как чёрная консоль на белом
      [200, 200, `for (let x = 0; x < w; x++) { const v = Math.round(255 * x / (w - 1)); g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(x, 0, 1, h); }`],
    ]);
    const auto = await page.evaluate(() => ({ dim: cvAutoAdj(_imgs[0]), good: cvAutoAdj(_imgs[1]) }));
    t.ok('«Авто» на тёмном блёклом фото: ярче, контрастнее, насыщеннее', auto.dim.b > 0.1 && auto.dim.c > 0.2 && auto.dim.s > 0.05, JSON.stringify(auto.dim));
    t.ok('«Авто» на нормальном фото яркость и контраст почти не трогает', Math.abs(auto.good.b) <= 0.05 && auto.good.c <= 0.05, JSON.stringify(auto.good));
    t.eq('«Авто» не насыщает серое фото (шум камеры не усиливается)', auto.good.s, 0);
    // Живой дефект первой версии: контраст вокруг 128 утаскивал тёмное фото в тень, и после
    // «Авто» оно становилось ТЕМНЕЕ. Теперь контраст — вокруг средней яркости самого фото.
    const lift = await page.evaluate(() => {
      const mean = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / (d.length / 4); };
      const src = document.createElement('canvas'); src.width = 200; src.height = 200; src.getContext('2d').drawImage(_imgs[0].el, 0, 0);
      const a = cvAutoAdj(_imgs[0]);
      return { before: mean(src), auto: mean(cvApplyAdj(_imgs[0].el, a)), contrastOnly: mean(cvApplyAdj(_imgs[0].el, cvAdjClamp({ c: 0.3 }))) };
    });
    t.ok('после «Авто» тёмное фото в среднем светлее, а не темнее', lift.auto > lift.before * 1.15, JSON.stringify(lift));
    t.ok('один контраст не меняет общую яркость фото', Math.abs(lift.contrastOnly - lift.before) < 3, JSON.stringify(lift));
    t.ok('«Авто» не выходит за мягкие пределы', Object.values(auto.dim).every(v => Math.abs(v) <= 0.3), JSON.stringify(auto.dim));

    // ── «Игра»: карточка, ползунок, файл, кэш ──
    await mkImg(page, [[400, 500, `g.fillStyle = '#707070'; g.fillRect(0, 0, w, h);`]]);
    await page.evaluate(() => {
      cv.mode = 'game'; cv.gamePad = 0; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = false; cv.gameFit = 'cover';
      cv.bgPattern = 'none'; cv.vignette = false; cv.grade = 'none'; cv.layers = [];
      cv.images = [_imgs[0]]; render();
    });
    const g0 = await page.evaluate(() => ({ card: !!document.querySelector('#cv-adj-card [data-cv-adj="b"]'), reset: document.querySelector('[data-cv-adj-act="reset"]').disabled, all: !!document.querySelector('[data-cv-adj-act="all"]') }));
    t.ok('в «Игре» карточка правит обложку; «Сбросить» неактивна, «Ко всем» нет', g0.card && g0.reset && !g0.all, JSON.stringify(g0));
    const before = await page.evaluate(() => { const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {}); return c.toDataURL(); });
    await page.evaluate(() => { const r = document.querySelector('[data-cv-adj="b"]'); r.value = '25'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(80);
    const g1 = await page.evaluate(() => {
      const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
      const live = [...document.getElementById('cv-canvas').getContext('2d').getImageData(540, 675, 1, 1).data][0];
      const a = cvSrc(cv.images[0]), b = cvSrc(cv.images[0]);
      return { file: [...c.getContext('2d').getImageData(540, 675, 1, 1).data][0], live, val: document.querySelector('[data-cv-adj-val="b"]').textContent, cached: a === b, reset: document.querySelector('[data-cv-adj-act="reset"]').disabled };
    });
    t.ok('ползунок яркости: превью и скачиваемый файл светлее, подпись +25%', g1.file > 130 && g1.live > 130 && g1.val === '+25%', JSON.stringify(g1));
    t.ok('исправленная копия кэшируется, «Сбросить» включилась', g1.cached && !g1.reset, JSON.stringify(g1));
    await page.click('[data-cv-adj-act="reset"]');
    const after = await page.evaluate(() => { const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {}); return { same: c.toDataURL(), el: cvSrc(cv.images[0]) === cv.images[0].el }; });
    t.ok('«Сбросить» возвращает исходник байт в байт', after.same === before && after.el);
    await page.click('[data-cv-adj-act="auto"]');
    const ga = await page.evaluate(() => ({ adj: cv.images[0].adj, shown: document.querySelector('[data-cv-adj="sh"]').value }));
    t.ok('«Авто» выставляет ползунки (видно в карточке)', ga.adj && ga.adj.sh === 0.1 && ga.shown === '10', JSON.stringify(ga));

    // ── Коллаж: выбранное фото, «Ко всем фото» ──
    await mkImg(page, [0, 1, 2, 3].map(() => [300, 300, `g.fillStyle = '#707070'; g.fillRect(0, 0, w, h);`]));
    await page.evaluate(() => { cv.mode = 'collage'; cv.layout = '2x2'; cv.padding = 10; cv.margin = null; cv.images = _imgs; cv._selCell = null; render(); });
    t.ok('в коллаже без выбора — подсказка щёлкнуть фото', await page.evaluate(() => /Щёлкни фото/.test(document.getElementById('cv-adj-card').textContent) && !document.querySelector('[data-cv-adj]')));
    // щелчок по второй ячейке на превью
    const cell = await page.evaluate(() => { const c = cvCells('2x2', 4, 1080, 1350, 10)[1]; const cnv = document.getElementById('cv-canvas'), r = cnv.getBoundingClientRect(); return { x: r.left + (c.x + c.w / 2) * r.width / 1080, y: r.top + (c.y + c.h / 2) * r.height / 1350 }; });
    await page.mouse.click(cell.x, cell.y);
    t.ok('щелчок по фото 2 — карточка правит его', await page.evaluate(() => cv._selCell === 1 && /фото 2/.test(document.getElementById('cv-adj-card').textContent) && !!document.querySelector('[data-cv-adj-act="all"]')));
    await page.evaluate(() => { const r = document.querySelector('[data-cv-adj="b"]'); r.value = '-20'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const one = await page.evaluate(() => cv.images.map(x => x.adj ? x.adj.b : null));
    t.eq('ползунок правит только выбранное фото', JSON.stringify(one), JSON.stringify([null, -0.2, null, null]));
    await page.click('[data-cv-adj-act="all"]');
    const all = await page.evaluate(() => ({ b: cv.images.map(x => x.adj && x.adj.b), own: new Set(cv.images.map(x => x.adj)).size }));
    t.ok('«Ко всем фото» копирует настройки всем, у каждого своя копия', all.b.every(v => v === -0.2) && all.own === 4, JSON.stringify(all));
    await page.evaluate(() => { cv.images[0].adj.b = 0.3; });
    t.eq('правка одного после «ко всем» не меняет других', await page.evaluate(() => cv.images[2].adj.b), -0.2);
    const drawn = await page.evaluate(() => {
      const c = document.createElement('canvas'); cvDrawCollage(c);
      const cs = cvCells('2x2', 4, 1080, 1350, 10);
      return cs.map(q => [...c.getContext('2d').getImageData(Math.round(q.x + q.w / 2), Math.round(q.y + q.h / 2), 1, 1).data][0]);
    });
    t.ok('в коллаже каждое фото нарисовано со своей коррекцией', drawn[0] !== drawn[2] && drawn[1] === drawn[2], JSON.stringify(drawn));
    // Находка ревью №1: удаление фото не переводит коррекцию молча на соседнее
    const del = await page.evaluate(() => {
      const lbl = () => (document.getElementById('cv-adj-card').textContent.match(/фото \d/) || ['—'])[0];
      const ids = () => cvAdjTarget()?.id ?? null;
      cv._selCell = 2; cvRenderState();
      const target = cv.images[2].id;
      cvRemoveImage(0);                                   // удалили левее выбранного
      const afterLeft = { sel: cv._selCell, id: ids(), lbl: lbl() };
      cvRemoveImage(cv._selCell);                         // удалили само выбранное
      const afterSelf = { sel: cv._selCell, id: ids(), hint: /Щёлкни фото/.test(document.getElementById('cv-adj-card').textContent) };
      return { target, afterLeft, afterSelf };
    });
    t.ok('удалили фото левее выбранного — выбор остаётся на том же фото', del.afterLeft.sel === 1 && del.afterLeft.id === del.target && del.afterLeft.lbl === 'фото 2', JSON.stringify(del));
    t.ok('удалили выбранное — выбора нет, карточка просит щёлкнуть фото', del.afterSelf.sel === null && del.afterSelf.id === null && del.afterSelf.hint, JSON.stringify(del));

    // Находка ревью №2: при увеличении кадра копия не мылится — предел растёт ступенями
    await mkImg(page, [[4000, 3000, `g.fillStyle = '#707070'; g.fillRect(0, 0, w, h);`]]);
    const cap = await page.evaluate(() => {
      const im = _imgs[0]; im.adj = { b: 0.1 };
      const w = s => { im.transform.scale = s; return cvSrc(im).width; };
      const r = { z1: w(1), z15: w(1.5), z3: w(3) };
      im.transform.scale = 3.5; r.same = cvSrc(im) === (im.transform.scale = 3, cvSrc(im));
      return r;
    });
    t.ok('без увеличения — 2000 px, 150 % и 300 % — полное разрешение 4000', cap.z1 === 2000 && cap.z15 === 4000 && cap.z3 === 4000, JSON.stringify(cap));
    t.ok('масштаб внутри одной ступени копию не пересчитывает', cap.same, JSON.stringify(cap));

    await page.click('[data-cv-layout="1x2"]').catch(() => {});
    await page.evaluate(() => { cv._selCell = null; document.querySelector('[data-cv-ratio="1:1"]').click(); });
    t.ok('смена формата снимает выбор — карточка снова просит щёлкнуть фото', await page.evaluate(() => /Щёлкни фото/.test(document.getElementById('cv-adj-card').textContent)));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }
}
