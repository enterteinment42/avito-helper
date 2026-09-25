// Коллаж по плану Fotor (Ф6, 25.09.2026): поле по краю отдельно от шва, скругление углов,
// узор фона, «Вписать целиком» в ячейке. Главное — коллажи с настройками по умолчанию
// рисуются пиксель в пиксель как в git HEAD во всех видах раскладок.
import { openApp, writeBaseline } from './lib.mjs';

// Пять одноцветных картинок-заглушек (цвета различимы), режим «Коллаж», без эффектов
const setup = (page, n = 5, w = 800, h = 1000) => page.evaluate(async ([n, w, h]) => {
  const colors = ['#ff0000', '#00c000', '#0000ff', '#ffff00', '#ff00ff'];
  cv.images = [];
  for (let i = 0; i < n; i++) {
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const g = src.getContext('2d'); g.fillStyle = colors[i % 5]; g.fillRect(0, 0, w, h);
    const el = new Image();
    await new Promise(r => { el.onload = r; el.src = src.toDataURL('image/png'); });
    cv.images.push({ id: i + 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } });
  }
  cv.mode = 'collage'; cv.ratio = '4:5'; cv.bg = '#101010'; cv.bgStyle = 'solid';
  cv.vignette = false; cv.grade = 'none'; cv.neonGap = false; cv.layers = []; cv._selCell = null;
  render();
}, [n, w, h]);

const px = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.createElement('canvas'); cvDrawCollage(c);
  return [...c.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
}, [x, y]);
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

export async function runCollage(browser, base, t) {
  t.section('collage — поле, углы, узор фона, «вписать» в ячейке');
  writeBaseline();

  // ── Коллажи по умолчанию — как в HEAD ──
  {
    const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
    const cur = await openApp(browser, `${base}/avito-helper.html`);
    try {
      for (const p of [old.page, cur.page]) { await p.click('[data-tab="covers"]'); await setup(p); }
      const CASES = [['2+3', 12, false], ['circ4', 12, true], ['circ4d', 20, true], ['square5', 12, false], ['c4', 0, true], ['diag', 12, false], ['stack', 16, false], ['strip', 8, true]];
      const draw = (page, [layout, pad, neon]) => page.evaluate(([layout, pad, neon]) => {
        cv.layout = layout; cv.padding = pad; cv.neonGap = neon;
        const c = document.createElement('canvas'); cvDrawCollage(c);
        const v = document.createElement('canvas'); cvDrawCollage(v, { bg: '#1a1a2e', padding: 20, infog: { align: 'right', bg: null, shift: 1 } });
        return c.toDataURL() + '|' + v.toDataURL();
      }, [layout, pad, neon]);
      for (const k of CASES) {
        const a = await draw(old.page, k), b = await draw(cur.page, k);
        t.ok(`«${k[0]}», шов ${k[1]}${k[2] ? ', неон' : ''}: как в HEAD (и вариант)`, a === b);
      }
      t.ok('консоль чистая (HEAD и новая)', old.consoleErrors.length === 0 && cur.consoleErrors.length === 0, [...old.consoleErrors, ...cur.consoleErrors].join('\n'));
    } finally { await old.ctx.close(); await cur.ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await setup(page, 4);

    // ── Поле по краю отдельно от шва ──
    const geo = await page.evaluate(() => {
      cv.layout = '2x2'; cv.padding = 10; cv.margin = 60;
      const c = cvCells('2x2', 4, 1080, 1350, 10, 60);
      return { first: c[0], second: c[1], last: c[3] };
    });
    t.ok('поле 60 у края, шов 10 между фото', geo.first.x === 60 && geo.first.y === 60 && Math.abs(geo.second.x - (geo.first.x + geo.first.w + 10)) < 1e-6, JSON.stringify(geo));
    t.ok('правый нижний угол — тоже на поле 60', Math.abs(geo.last.x + geo.last.w - 1020) < 1e-6 && Math.abs(geo.last.y + geo.last.h - 1290) < 1e-6, JSON.stringify(geo.last));
    t.ok('в поле — фон, сразу за ним — фото', near(await px(page, 30, 300), [16, 16, 16]) && near(await px(page, 90, 300), [255, 0, 0]));
    const circ = await page.evaluate(() => {
      cv.layout = 'circ4'; cv.images.push({ ...cv.images[0], id: 9 }); cv.margin = 60;
      const c = cvCells('circ4', 5, 1080, 1350, 10, 60);
      const cv2 = document.createElement('canvas'); cvDrawCollage(cv2);
      const at = (x, y) => [...cv2.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      const r = { cx: c[0].cx, cy: c[0].cy, corner: at(30, 30), inside: at(90, 90) };
      cv.images.pop(); cv.layout = '2x2';
      return r;
    });
    t.ok('«Круг+4» с полем: круг по центру холста, в углу — фон, за полем — фото', circ.cx === 540 && circ.cy === 675 && near(circ.corner, [16, 16, 16]) && !near(circ.inside, [16, 16, 16]), JSON.stringify(circ));

    // ── Углы ──
    const corner = async r => { await page.evaluate(r => { cv.margin = 60; cv.cellRadius = r; }, r); return px(page, 62, 62); };
    t.ok('углы 0 — угол фото острый', near(await corner(0), [255, 0, 0]));
    t.ok('углы 60 — в углу ячейки виден фон', near(await corner(60), [16, 16, 16]));
    const auto = await page.evaluate(() => { cv.cellRadius = null; cv.padding = 20; return cvCellRadius(); });
    t.eq('«авто» — прежняя формула от шва (0.7 шва)', auto, 14);

    // ── Узоры ──
    const pat = await page.evaluate(() => {
      cv.margin = 80; cv.padding = 10; cv.cellRadius = null;
      const strip = bg => {
        cv.bg = bg;
        const c = document.createElement('canvas'); cvDrawCollage(c);
        const d = c.getContext('2d').getImageData(0, 0, 70, 1350).data;   // левое поле
        let lighter = 0, darker = 0;
        const base = parseInt(bg.slice(1, 3), 16);
        for (let i = 0; i < d.length; i += 4) { if (d[i] > base + 8) lighter++; if (d[i] < base - 8) darker++; }
        return { lighter, darker };
      };
      const out = {};
      for (const [id] of CV_PATTERNS) {
        cv.bgPattern = id;
        out[id] = { dark: strip('#101010'), light: strip('#f0f0f0') };
      }
      cv.bgPattern = 'dots'; cv.bgPatternAlpha = 0.05; const faint = strip('#101010');
      cv.bgPatternAlpha = 0.4; const strong = strip('#101010');
      cv.bgPattern = 'none'; cv.bgPatternAlpha = 0.14; cv.bg = '#101010';
      return { out, faint, strong };
    });
    t.ok('без узора поле ровное', pat.out.none.dark.lighter === 0 && pat.out.none.light.darker === 0, JSON.stringify(pat.out.none));
    for (const id of ['dots', 'stripes', 'grid', 'hex']) {
      const r = pat.out[id];
      t.ok(`узор ${id}: на тёмном фоне светлее, на светлом — темнее`, r.dark.lighter > 200 && r.dark.darker === 0 && r.light.darker > 200 && r.light.lighter === 0, JSON.stringify(r));
    }
    t.ok('плотность узора меняет его заметность', pat.strong.lighter > pat.faint.lighter, JSON.stringify(pat));

    // ── «Вписать целиком» в ячейке ──
    await setup(page, 4, 1000, 250);   // широкие картинки в высоких ячейках
    const fit = await page.evaluate(() => {
      cv.layout = '2x2'; cv.padding = 10; cv.margin = null; cv.cellRadius = 0;
      const c = cvCells('2x2', 4, 1080, 1350, 10)[0];
      const at = () => { const k = document.createElement('canvas'); cvDrawCollage(k); const g = k.getContext('2d');
        return { top: [...g.getImageData(Math.round(c.x + c.w / 2), Math.round(c.y + 8), 1, 1).data].slice(0, 3),
                 mid: [...g.getImageData(Math.round(c.x + c.w / 2), Math.round(c.y + c.h / 2), 1, 1).data].slice(0, 3) }; };
      const cover = at();
      cv.images[0].fit = 'contain';
      const contain = at();
      return { cover, contain };
    });
    t.ok('«Заполнить»: верх ячейки — само фото', near(fit.cover.top, [255, 0, 0]), JSON.stringify(fit));
    t.ok('«Вписать целиком»: середина — фото, поля — его приглушённая размытая копия', near(fit.contain.mid, [255, 0, 0]) && fit.contain.top[0] < 220 && fit.contain.top[0] > 120, JSON.stringify(fit));

    // меню: выбор ячейки даёт переключатель кадра; у круга — нет
    await page.evaluate(() => { cv.images[0].fit = undefined; cv._selCell = 0; cvRenderState(); });
    t.ok('у прямоугольной ячейки есть «Заполнить / Вписать целиком»', await page.evaluate(() => !!document.querySelector('[data-cv-cell-fit="contain"]')));
    await page.evaluate(() => { cv.images[0].transform = { scale: 2, ox: 0.1, oy: 0 }; });
    await page.click('[data-cv-cell-fit="contain"]');
    const clicked = await page.evaluate(() => ({ fit: cv.images[0].fit, t: cv.images[0].transform, active: document.querySelector('[data-cv-cell-fit="contain"]').classList.contains('active') }));
    t.ok('кнопка переводит ячейку в «вписать» и сбрасывает прежний сдвиг', clicked.fit === 'contain' && clicked.t.scale === 1 && clicked.t.ox === 0 && clicked.active, JSON.stringify(clicked));
    const circleBar = await page.evaluate(() => {
      cv.images.push({ ...cv.images[1], id: 9, fit: undefined }); cv.layout = 'circ4'; cv._selCell = 0; cvRenderState();
      const r = { circle: !!document.querySelector('[data-cv-cell-fit]'), zoom: !!document.getElementById('cv-tz-scale') };
      cv._selCell = 1; cvRenderState();
      r.quad = !!document.querySelector('[data-cv-cell-fit]');
      cv.images.pop(); cv.layout = '2x2'; cv._selCell = null; cvRenderState();
      return r;
    });
    t.ok('у круга в «Круг+4» переключателя нет, масштаб остаётся; у фоновой четверти — есть', !circleBar.circle && circleBar.zoom && circleBar.quad, JSON.stringify(circleBar));

    // ── Меню поля и углов ──
    await page.evaluate(() => { cv.margin = null; cv.cellRadius = null; cv.padding = 12; render(); });
    const ui0 = await page.evaluate(() => ({ m: document.querySelector('[data-cv-geo="margin"]').value, dis: document.querySelector('[data-cv-geo-auto="margin"]').disabled }));
    t.ok('«как шов»: ползунок поля показывает шов, кнопка возврата неактивна', ui0.m === '12' && ui0.dis, JSON.stringify(ui0));
    await page.evaluate(() => { const r = document.getElementById('cv-padding'); r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    t.eq('шов сдвинули — поле «как шов» идёт следом', await page.evaluate(() => document.querySelector('[data-cv-geo="margin"]').value), '30');
    await page.evaluate(() => { const r = document.querySelector('[data-cv-geo="margin"]'); r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const ui1 = await page.evaluate(() => ({ m: cv.margin, dis: document.querySelector('[data-cv-geo-auto="margin"]').disabled }));
    t.ok('ползунок поля задаёт своё значение, кнопка возврата включается', ui1.m === 50 && !ui1.dis, JSON.stringify(ui1));
    await page.click('[data-cv-pattern="hex"]');
    t.ok('кнопка узора выбирает его и показывает плотность', await page.evaluate(() => cv.bgPattern === 'hex' && !!document.getElementById('cv-pattern-alpha')));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const kept = await page.evaluate(() => ({ m: cv.margin, p: cv.padding, pat: cv.bgPattern }));
    t.ok('поле, шов и узор переживают F5 (шов раньше терялся)', kept.m === 50 && kept.p === 30 && kept.pat === 'hex', JSON.stringify(kept));
    await page.click('[data-tab="covers"]');
    await page.click('[data-cv-geo-auto="margin"]');
    t.ok('«как шов» возвращает прежнее поведение', await page.evaluate(() => cv.margin === null && document.querySelector('[data-cv-geo="margin"]').value === '30'));

    // ── Чужие данные и шаблоны ──
    const junk = await page.evaluate(() => {
      cvApplyCfg({ margin: '30', cellRadius: 'abc', bgPattern: 'zebra', bgPatternAlpha: 5 });
      return { m: cv.margin, r: cv.cellRadius, p: cv.bgPattern, a: cv.bgPatternAlpha };
    });
    t.eq('с сервера/из бэкапа: число строкой — к числу, мусор — к «как было»', JSON.stringify(junk), JSON.stringify({ m: 30, r: null, p: 'none', a: 0.5 }));
    const tpl = await page.evaluate(() => {
      window.prompt = () => 'Поле и соты';
      cv.margin = 44; cv.cellRadius = 0; cv.bgPattern = 'hex';
      cvSaveTpl();
      cv.margin = null; cv.cellRadius = null; cv.bgPattern = 'none';
      cvApplyTpl(cv.tpls.find(x => x.name === 'Поле и соты').id);
      const r = { m: cv.margin, r: cv.cellRadius, p: cv.bgPattern };
      cvLayerAction('undo');
      return { r, undone: { m: cv.margin, p: cv.bgPattern } };
    });
    t.eq('свой шаблон запоминает поле, углы и узор', JSON.stringify(tpl.r), JSON.stringify({ m: 44, r: 0, p: 'hex' }));
    t.eq('«↶ Отменить» шаблона возвращает прежние', JSON.stringify(tpl.undone), JSON.stringify({ m: null, p: 'none' }));

    // Находка ревью 25.09 №1: свой шаблон, сохранённый до Ф6, не знает поля/углов/узора —
    // применение должно вернуть их к «как было», а не оставить с прошлой обложки
    const oldTpl = await page.evaluate(() => {
      cv.tpls.push({ id: 'u-old', name: 'Шаблон 24.09', layers: [], style: { bg: '#222222', padding: 20, vignette: false } });
      cv.margin = 60; cv.cellRadius = 5; cv.bgPattern = 'hex'; cv.bgPatternAlpha = 0.4;
      cvApplyTpl('u-old');
      return { p: cv.padding, m: cv.margin, r: cv.cellRadius, pat: cv.bgPattern, a: cv.bgPatternAlpha };
    });
    t.eq('старый свой шаблон: поле, углы и узор — «как было», шов — из шаблона', JSON.stringify(oldTpl), JSON.stringify({ p: 20, m: null, r: null, pat: 'none', a: 0.14 }));
    const builtin = await page.evaluate(() => { cv.margin = 60; cv.bgPattern = 'hex'; cvApplyTpl('b-hit'); return { m: cv.margin, pat: cv.bgPattern }; });
    t.eq('готовый шаблон без фона («Хит») поле и узор не трогает', JSON.stringify(builtin), JSON.stringify({ m: 60, pat: 'hex' }));

    // Находка ревью 25.09 №2: узор не обрывается на ровной заливке кольца и полей рамки
    await setup(page, 5);
    const ring = await page.evaluate(() => {
      cv.layout = 'circ4'; cv.padding = 30; cv.margin = null; cv.cellRadius = null; cv.layers = [];
      cv.bg = '#101010'; cv.bgStyle = 'solid'; cv.bgPattern = 'grid'; cv.bgPatternAlpha = 0.4;
      const c = document.createElement('canvas'); cvDrawCollage(c);
      const g = c.getContext('2d'), R = Math.floor(1080 * 0.30), ringW = Math.max(8, Math.round(30 * 0.7));
      const d = g.getImageData(540 - R - ringW, 675 - R - ringW, 2 * (R + ringW), 2 * (R + ringW)).data, W = 2 * (R + ringW);
      let inRing = 0, lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        const x = (i / 4) % W - (R + ringW), y = Math.floor(i / 4 / W) - (R + ringW), rr = Math.hypot(x, y);
        if (rr > R + 2 && rr < R + ringW - 2) { inRing++; if (d[i] > 24 && d[i] < 120 && Math.abs(d[i] - d[i + 1]) < 6) lit++; }
      }
      return { inRing, lit };
    });
    t.ok('«Круг+4»: узор идёт и по кольцу вокруг круга', ring.inRing > 1000 && ring.lit > 30, JSON.stringify(ring));
    const frame = await page.evaluate(() => {
      cv.mode = 'game'; cv.gamePad = 60; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = true;
      cv.gameFit = 'contain'; cv.gameFill = 'bg';
      const src = document.createElement('canvas'); src.width = 1000; src.height = 200;
      const x = src.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 1000, 200);
      const im = { id: 99, el: src, transform: { scale: 1, ox: 0, oy: 0 } };
      Object.defineProperty(src, 'naturalWidth', { value: 1000 }); Object.defineProperty(src, 'naturalHeight', { value: 200 });
      const c = document.createElement('canvas'); cvDrawGame(c, im, {});
      const d = c.getContext('2d').getImageData(80, 100, 920, 300).data;   // поле рамки над обложкой
      let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 24 && Math.abs(d[i] - d[i + 2]) < 6) lit++;
      cv.mode = 'collage'; cv.gameShadow = false; cv.gameFit = 'cover'; cv.bgPattern = 'none';
      return lit;
    });
    t.ok('«Игра», тень + «Вписать целиком» + поля цветом фона: узор идёт и внутри рамки', frame > 300, String(frame));

    // ── Варианты коллажа: «Текущий» держит живое поле ──
    await setup(page, 4);
    const vars = await page.evaluate(() => {
      cv.layout = '2x2'; cv.padding = 10; cv.margin = 70; cv.cellRadius = 0; cv.bgPattern = 'none';
      cvGenerateCollageVars();
      const at = (id, x, y) => [...document.getElementById(id).getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
      return { cur: at('cv-cvar-3', 40, 300), v1: at('cv-cvar-1', 40, 300) };
    });
    t.ok('вариант «Текущий» — с живым полем, вариант 2 — со своим швом', near(vars.cur, [16, 16, 16]) && near(vars.v1, [255, 0, 0]), JSON.stringify(vars));

    // ── Узор виден и в «Игре» с рамкой ──
    const game = await page.evaluate(() => {
      cv.mode = 'game'; cv.gamePad = 80; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = false; cv.gameFit = 'cover';
      cv.bg = '#101010'; cv.bgPattern = 'grid'; cv.bgPatternAlpha = 0.3;
      const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
      const d = c.getContext('2d').getImageData(0, 0, 70, 1350).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 30) n++;
      cv.bgPattern = 'none'; cv.mode = 'collage';
      return n;
    });
    t.ok('узор виден в рамке режима «Игра»', game > 200, String(game));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }
}
