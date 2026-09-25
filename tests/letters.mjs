// Буквы слоёв обложки (25.09.2026, план Fotor, Ф1): шрифт, заливка градиентом, обводка, тень.
// Главное — старые обложки не меняются: надпись рисуется пиксель в пиксель как в git HEAD,
// размеры стикеров, лент и инфографики совпадают с HEAD.
import { openApp, writeBaseline } from './lib.mjs';

// Обложка-заглушка (синяя) в режиме «Игра» без рамки и эффектов
const setupCover = page => page.evaluate(async () => {
  const src = document.createElement('canvas');
  src.width = 800; src.height = 1000;
  const g = src.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0, 0, 800, 1000);
  const el = new Image();
  await new Promise(r => { el.onload = r; el.src = src.toDataURL('image/png'); });
  cv.mode = 'game'; cv.ratio = '4:5'; cv.gamePad = 0; cv.gameCorner = 0; cv.gameBorder = 0; cv.gameShadow = false;
  cv.gameFit = 'cover'; cv.bg = '#00ff00'; cv.bgStyle = 'solid'; cv.vignette = false; cv.grade = 'none'; cv.neonGap = false;
  cv.images = [{ id: 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }];
  cv.layers = []; cv._selLayer = null;
  render();
});

// Слои в том виде, в каком они лежат у Дениса с 24.09 — без полей букв
const OLD_TEXT = [
  { id: 'a', type: 'text', x: 0.5, y: 0.3, angle: 0, scale: 1, hidden: false, text: 'Без подложки\nвторая строка', size: 80, color: '#ffffff', bold: true, bgOn: false, bgColor: '#000000', bgOpacity: 0.55 },
  { id: 'b', type: 'text', x: 0.5, y: 0.7, angle: 0, scale: 1, hidden: false, text: 'С подложкой', size: 70, color: '#facc15', bold: false, bgOn: true, bgColor: '#000000', bgOpacity: 0.55 },
];
const OLD_MONO = [
  { id: 's1', type: 'sticker', x: 0.8, y: 0.14, angle: -12, scale: 1, hidden: false, text: 'ЛУЧШАЯ ЦЕНА', shape: 'burst', size: 180, bg: '#B45309', color: '#ffffff' },
  { id: 's2', type: 'sticker', x: 0.3, y: 0.3, angle: 0, scale: 1.3, hidden: false, text: 'НА РУССКОМ', shape: 'pill', size: 180, bg: '#1d4ed8', color: '#ffffff' },
  { id: 'r1', type: 'ribbon', x: 0.5, y: 0.5, angle: 0, scale: 1, hidden: false, corner: 'tr', text: 'ПРЕДЗАКАЗ', size: 76, bg: '#dc2626', color: '#ffffff' },
  { id: 'i1', type: 'infog', x: 0.4, y: 0.85, angle: 0, scale: 1, hidden: false, text: '✔️ 405+ игр\n✔️ PS4 / PS5', size: 38, bg: '#0f172a', opacity: 0.82, color: '#ffffff', align: 'left' },
];

// Рисует набор слоёв и возвращает картинку и рамки — одинаково для HEAD и новой версии
const drawSet = (page, layers) => page.evaluate(async ls => {
  await document.fonts.load('700 40px Literata', 'АяAz');
  await document.fonts.load('400 40px Literata', 'АяAz');
  await document.fonts.load(`700 40px 'JetBrains Mono'`, 'АяAz');
  // через настоящий вход (localStorage/сервер/бэкап идут через него же), а не присваиванием
  cvApplyCfg({ layers: JSON.parse(JSON.stringify(ls)) });
  const c = document.createElement('canvas');
  cvDrawGame(c, cv.images[0], {});
  const frames = cv.layers.map(L => { const f = cvLayerFrame(L, 1080, 1350); return [L.id, Math.round(f.w * 100) / 100, Math.round(f.h * 100) / 100]; });
  return { url: c.toDataURL(), frames };
}, layers);

// Подсчёт пикселей по условию в прямоугольнике холста
const countPx = (page, layers, test, rect) => page.evaluate(([ls, test, rect]) => {
  cv.layers = ls.map(L => ({ ...cvLayerDefaults(L.type), ...L }));
  const c = document.createElement('canvas');
  cvDrawGame(c, cv.images[0], {});
  const [x, y, w, h] = rect;
  const d = c.getContext('2d').getImageData(x, y, w, h).data;
  const fn = new Function('r', 'g', 'b', `return ${test}`);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (fn(d[i], d[i + 1], d[i + 2])) n++;
  return n;
}, [layers, test, rect]);

// Нижняя строка прямоугольника, где есть пиксель по условию (-1 — нигде)
const lowestPx = (page, layers, test, rect) => page.evaluate(([ls, test, rect]) => {
  cv.layers = ls.map(L => ({ ...cvLayerDefaults(L.type), ...L }));
  const c = document.createElement('canvas');
  cvDrawGame(c, cv.images[0], {});
  const [x, y, w, h] = rect;
  const d = c.getContext('2d').getImageData(x, y, w, h).data;
  const fn = new Function('r', 'g', 'b', `return ${test}`);
  let low = -1;
  for (let i = 0; i < d.length; i += 4) if (fn(d[i], d[i + 1], d[i + 2])) low = Math.max(low, Math.floor(i / 4 / w));
  return low;
}, [layers, test, rect]);

export async function runLetters(browser, base, t) {
  t.section('letters — шрифты и эффекты букв на обложке');
  writeBaseline();   // сравниваем с HEAD, а не с тем, что осталось в .baseline от прошлых прогонов

  // ── Старые обложки не меняются: сравнение с git HEAD ──
  {
    const old = await openApp(browser, `${base}/baseline/avito-helper.html`);
    const cur = await openApp(browser, `${base}/avito-helper.html`);
    try {
      await old.page.click('[data-tab="covers"]'); await setupCover(old.page);
      await cur.page.click('[data-tab="covers"]'); await setupCover(cur.page);
      const a = await drawSet(old.page, OLD_TEXT), b = await drawSet(cur.page, OLD_TEXT);
      t.ok('надписи до этой версии рисуются пиксель в пиксель как в HEAD (с подложкой и без)', a.url === b.url);
      t.eq('и те же размеры', JSON.stringify(b.frames), JSON.stringify(a.frames));
      const m1 = await drawSet(old.page, OLD_MONO), m2 = await drawSet(cur.page, OLD_MONO);
      t.eq('стикеры, лента и инфографика — те же размеры, что в HEAD (жирный моноширинный шире не стал)', JSON.stringify(m2.frames), JSON.stringify(m1.frames));
      t.ok('консоль чистая (HEAD и новая)', old.consoleErrors.length === 0 && cur.consoleErrors.length === 0, [...old.consoleErrors, ...cur.consoleErrors].join('\n'));
    } finally { await old.ctx.close(); await cur.ctx.close(); }
  }

  // ── Перевод прежних слоёв: тень надписи — явным флагом ──
  {
    const legacy = { mode: 'game', ratio: '4:5', textOverlay: true, textOverlayText: 'Старый', textOverlayBg: true, textOverlayX: 540, textOverlayY: 600 };
    const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`, { storage: { avito_cv: legacy } });
    try {
      const flat = await page.evaluate(() => cv.layers.find(L => L.type === 'text'));
      t.ok('прежняя надпись с подложкой (плоский формат) переехала без тени', flat && flat.bgOn === true && flat.shadow === false, JSON.stringify(flat));
      const viaCfg = await page.evaluate(ls => { cvApplyCfg({ layers: ls }); return cv.layers.map(L => [L.id, L.shadow, L.font, L.stroke, L.fill].join(':')); }, OLD_TEXT);
      t.eq('слои 24.09 с сервера/из бэкапа: без подложки — с тенью, с подложкой — без; шрифт прежний', viaCfg.join('|'), 'a:true:serif:false:solid|b:false:serif:false:solid');
      const mono = await page.evaluate(ls => { cvApplyCfg({ layers: ls }); return cv.layers.map(L => `${L.font}:${L.shadow}`).join(','); }, OLD_MONO);
      t.eq('стикер, лента, инфографика 24.09 — моноширинный, без тени букв', mono, 'mono:false,mono:false,mono:false,mono:false');
      const tpl = await page.evaluate(ls => {
        cv.tpls = [{ id: 'uold', name: 'Старый шаблон', layers: [ls[1]], style: {} }];
        cvApplyTpl('uold');
        const L = cv.layers[0];
        return { shadow: L.shadow, bgOn: L.bgOn };
      }, OLD_TEXT);
      t.ok('свой шаблон 24.09 с надписью на подложке тени не получает', tpl.shadow === false && tpl.bgOn === true, JSON.stringify(tpl));
      const junk = await page.evaluate(() => {
        cvApplyCfg({ layers: [{ type: 'sticker', text: 'X', font: 'comic', fill: 'rainbow', strokeW: '0.1', stroke: 'да', shadowBlur: 'abc' }] });
        return cv.layers[0];
      });
      t.ok('чужой шрифт и заливка — к заводским, числа строкой — к числам, флаги — к да/нет', junk.font === 'mono' && junk.fill === 'solid' && junk.strokeW === 0.1 && junk.stroke === true && junk.shadowBlur === 0.18, JSON.stringify(junk));
      t.ok('консоль чистая (перевод)', consoleErrors.length === 0, consoleErrors.join('\n'));
    } finally { await ctx.close(); }
  }

  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    await page.click('[data-tab="covers"]');
    await setupCover(page);

    // ── Шрифты: подключены, грузятся, меняют ширину ──
    const fonts = await page.evaluate(async () => {
      const jb700 = [...document.fonts].some(f => /JetBrains/.test(f.family) && String(f.weight) === '700');
      const res = {};
      for (const f of CV_FONTS) {
        const L = { ...cvLayerDefaults('text'), font: f.id };
        const faces = await document.fonts.load(cvFontStr(L, 40), 'АяAz');
        res[f.id] = { faces: faces.length, check: document.fonts.check(cvFontStr(L, 40), 'Ая') };
      }
      const w = id => cvTextGeom({ ...cvLayerDefaults('text'), font: id, text: 'ПРЕДЗАКАЗ ИГРЫ' }).tw;
      return { jb700, res, widths: Object.fromEntries(CV_FONTS.map(f => [f.id, Math.round(w(f.id))])) };
    });
    t.ok('у JetBrains Mono есть настоящий жирный (700), а не поддельный', fonts.jb700);
    for (const [id, r] of Object.entries(fonts.res)) t.ok(`шрифт ${id}: файлы с кириллицей грузятся`, r.faces >= 1 && r.check, JSON.stringify(r));
    t.ok('Oswald уже Montserrat — длинная строка занимает меньше места', fonts.widths.oswald < fonts.widths.montserrat * 0.8, JSON.stringify(fonts.widths));
    t.eq('у всех шести шрифтов разная ширина строки (шрифт действительно меняется)', new Set(Object.values(fonts.widths)).size, 6);

    // ── Обводка: форма растёт, текст внутри; обводка видна ──
    const st = await page.evaluate(() => {
      const res = {};
      for (const [s] of CV_STICKER_SHAPES) {
        const base = { ...cvLayerDefaults('sticker'), shape: s, text: 'ПРЕДЗАКАЗ ДО 15 ОКТЯБРЯ', font: 'montserrat' };
        const a = cvStickerGeom(base), b = cvStickerGeom({ ...base, stroke: true, strokeW: 0.2 });
        const ctx = cvMctx(); ctx.font = cvFontStr(base, b.fs);
        const ex = 0.2 * b.fs;
        const tw = Math.max(...b.lines.map(l => ctx.measureText(l).width)) + 2 * ex, th = b.lines.length * b.lh + 2 * ex;
        let fits;
        if (s === 'pill' || s === 'badge') fits = tw <= b.w - b.fs * 0.5 && th <= b.h;
        else if (s === 'diamond') fits = tw / 2 + th / 2 <= b.R;
        else if (s === 'hex') fits = Math.hypot(tw / 2, th / 2) <= b.R * 0.866;
        else if (s === 'circle') fits = Math.hypot(tw / 2, th / 2) <= b.R;
        else fits = Math.hypot(tw / 2, th / 2) <= b.inner;
        res[s] = { grew: b.w > a.w, fits };
      }
      return res;
    });
    for (const [s, r] of Object.entries(st)) t.ok(`${s}: с обводкой форма шире и буквы с обводкой внутри`, r.grew && r.fits, JSON.stringify(r));

    const ig = await page.evaluate(() => {
      const L = { ...cvLayerDefaults('infog'), text: 'Строка', font: 'rubik' };
      const a = cvInfogGeom(L, 1080), b = cvInfogGeom({ ...L, stroke: true, strokeW: 0.15 }, 1080);
      return { grew: b.w > a.w, pad: b.padX > a.padX };
    });
    t.ok('плашка инфографики растёт под обводку, текст сдвинут от края', ig.grew && ig.pad, JSON.stringify(ig));

    const TXT = { type: 'text', x: 0.5, y: 0.5, text: 'ОБВОДКА', size: 140, color: '#ffffff', font: 'montserrat', shadow: false };
    const RECT = [40, 520, 1000, 310];
    const RED = 'r > 180 && g < 80 && b < 80';
    const noStroke = await countPx(page, [TXT], RED, RECT);
    const withStroke = await countPx(page, [{ ...TXT, stroke: true, strokeW: 0.1, strokeColor: '#ff0000' }], RED, RECT);
    t.ok('обводка рисуется своим цветом вокруг букв', noStroke === 0 && withStroke > 500, JSON.stringify({ noStroke, withStroke }));

    // ── Градиент: снизу второй цвет ──
    const YEL = 'r > 200 && g > 160 && b < 90';
    const solid = await countPx(page, [TXT], YEL, RECT);
    const grad = await countPx(page, [{ ...TXT, fill: 'grad', color2: '#facc15' }], YEL, RECT);
    t.ok('градиент: у букв появляется второй цвет, при сплошной заливке его нет', solid === 0 && grad > 300, JSON.stringify({ solid, grad }));

    // ── Тень: тёмные пиксели на синей обложке, сдвиг наискось ──
    const DARK = 'b < 170 && r < 60 && g < 60';
    const noSh = await countPx(page, [TXT], DARK, RECT);
    const sh = await countPx(page, [{ ...TXT, shadow: true, shadowDist: 0.15, shadowBlur: 0, shadowOpacity: 0.8, shadowDir: 'diag' }], DARK, RECT);
    t.ok('тень включается флагом слоя и видна', noSh === 0 && sh > 500, JSON.stringify({ noSh, sh }));
    // обводка шириной 0.1 кегля выносит контур на 14 px — на столько же дальше уходит и тень
    const SH = { shadow: true, shadowDist: 0.15, shadowBlur: 0, shadowOpacity: 0.8, shadowDir: 'down' };
    const lowSh = await lowestPx(page, [{ ...TXT, ...SH }], DARK, RECT);
    const lowStk = await lowestPx(page, [{ ...TXT, ...SH, stroke: true, strokeW: 0.1, strokeColor: '#ff0000' }], DARK, RECT);
    t.ok('с обводкой тень отбрасывает контур с обводкой (уходит ниже на её толщину)', lowSh > 0 && lowStk - lowSh >= 10, JSON.stringify({ lowSh, lowStk }));
    // Находка ревью 25.09: с тонкой обводкой и большим сдвигом тень была пустым кольцом —
    // её отбрасывала одна обводка. Середина тени ножки «I» должна быть закрашена.
    const hollow = await page.evaluate(() => {
      const L = { ...cvLayerDefaults('text'), text: 'I', font: 'montserrat', size: 200, color: '#ffffff',
        shadow: true, shadowDist: 0.3, shadowBlur: 0, shadowOpacity: 1, shadowDir: 'diag', shadowColor: '#000000' };
      const probe = extra => {
        cv.layers = [{ ...L, ...extra }];
        const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
        const d = 0.3 * 200 * Math.SQRT1_2;   // сдвиг тени по каждой оси
        return [...c.getContext('2d').getImageData(Math.round(540 + d), Math.round(675 + d), 1, 1).data];
      };
      return { plain: probe({}), thin: probe({ stroke: true, strokeW: 0.02, strokeColor: '#ff0000' }) };
    });
    t.ok('с обводкой тень — сплошной силуэт буквы, а не пустой контур', hollow.thin[2] < 60 && hollow.plain[2] < 60, JSON.stringify(hollow));

    // тень растёт вместе со слоем: вдвое больший слой — дальше ушедшая тень
    const scaled = await page.evaluate(() => {
      const L = { ...cvLayerDefaults('text'), text: 'Т', size: 100, shadow: true, shadowDist: 0.3, shadowBlur: 0, shadowOpacity: 1, shadowDir: 'down', color: '#ffffff' };
      const probe = s => {
        cv.layers = [{ ...L, scale: s }];
        const c = document.createElement('canvas'); cvDrawGame(c, cv.images[0], {});
        const d = c.getContext('2d').getImageData(540, 0, 1, 1350).data;
        let last = 0;
        for (let y = 0; y < 1350; y++) if (d[y * 4 + 2] < 100) last = y;
        return last - 675;
      };
      return { s1: probe(1), s2: probe(2) };
    });
    t.ok('тень масштабируется вместе с надписью', scaled.s2 > scaled.s1 * 1.7, JSON.stringify(scaled));

    // ── Меню ──
    await page.evaluate(() => { cv.layers = []; cv._selLayer = null; cvLayersChanged(); });
    await page.click('[data-cv-la="add:text"]');
    const ui0 = await page.evaluate(() => ({
      fonts: document.querySelectorAll('#cv-layers-card [data-cv-lv^="font:"]').length,
      bold: !!document.querySelector('#cv-layers-card [data-cv-lt="bold"]'),
      shadowOn: cv.layers[0].shadow, blur: !!document.querySelector('#cv-layers-card [data-cv-lp="shadowBlur"]'),
      strokeW: !!document.querySelector('#cv-layers-card [data-cv-lp="strokeW"]'),
    }));
    t.ok('в меню надписи 6 шрифтов, «Жирный» у Literata есть', ui0.fonts === 6 && ui0.bold, JSON.stringify(ui0));
    t.ok('новая надпись — с тенью (как было), настройки тени раскрыты, обводки — свёрнуты', ui0.shadowOn && ui0.blur && !ui0.strokeW, JSON.stringify(ui0));
    await page.click('[data-cv-lv="font:montserrat"]');
    await page.click('[data-cv-lt="stroke"]');
    await page.click('[data-cv-lv="fill:grad"]');
    const ui1 = await page.evaluate(() => ({
      L: cv.layers[0], bold: !!document.querySelector('#cv-layers-card [data-cv-lt="bold"]'),
      strokeW: !!document.querySelector('#cv-layers-card [data-cv-lp="strokeW"]'),
      color2: !!document.querySelector('#cv-layers-card [data-cv-lv^="color2:"]'),
    }));
    t.ok('выбор шрифта, обводки и градиента в меню пишется в слой', ui1.L.font === 'montserrat' && ui1.L.stroke === true && ui1.L.fill === 'grad', JSON.stringify(ui1.L));
    t.ok('у Montserrat «Жирного» нет (одно начертание), толщина обводки и второй цвет появились', !ui1.bold && ui1.strokeW && ui1.color2, JSON.stringify(ui1));
    await page.evaluate(() => { const r = document.querySelector('#cv-layers-card [data-cv-lp="strokeW"]'); r.value = '20'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    t.eq('ползунок толщины обводки — доля кегля', await page.evaluate(() => cv.layers[0].strokeW), 0.2);
    for (const type of ['sticker', 'ribbon', 'infog']) {
      await page.click(`[data-cv-la="add:${type}"]`);
      const n = await page.evaluate(() => document.querySelectorAll('#cv-layers-card [data-cv-lv^="font:"]').length);
      t.eq(`у слоя ${type} тот же блок «Буквы»`, n, 6);
    }
    await page.click('[data-cv-la="add:plat"]');
    t.eq('у значков платформ блока «Буквы» нет', await page.evaluate(() => document.querySelectorAll('#cv-layers-card [data-cv-lv^="font:"]').length), 0);

    // ── Свой шаблон запоминает буквы, F5 их не теряет ──
    await page.evaluate(() => { window.prompt = () => 'Буквы'; });
    await page.click('[data-cv-tpl="save"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app header'));
    const kept = await page.evaluate(() => {
      const T = cv.layers.find(L => L.type === 'text');
      const live = { font: T.font, stroke: T.stroke, strokeW: T.strokeW, fill: T.fill };
      cv.layers = []; cvApplyTpl(cv.tpls.find(t => t.name === 'Буквы').id);
      const A = cv.layers.find(L => L.type === 'text');
      return { live, tpl: { font: A.font, stroke: A.stroke, strokeW: A.strokeW, fill: A.fill } };
    });
    t.eq('шрифт и эффекты надписи переживают F5', JSON.stringify(kept.live), JSON.stringify({ font: 'montserrat', stroke: true, strokeW: 0.2, fill: 'grad' }));
    t.eq('и возвращаются из своего шаблона', JSON.stringify(kept.tpl), JSON.stringify(kept.live));

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally { await ctx.close(); }

  // ── Скачивание ждёт шрифт: в файл не уходит запасной ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
    try {
      await page.click('[data-tab="covers"]');
      await setupCover(page);
      const res = await page.evaluate(() => new Promise(resolve => {
        cv.layers = [{ ...cvLayerDefaults('sticker'), font: 'russo', text: 'ХИТ' }];
        const before = document.fonts.check(cvFontStr(cv.layers[0], 40), 'АяAz');
        window.cvDownload = () => resolve({ before, atDownload: document.fonts.check(cvFontStr(cv.layers[0], 40), 'АяAz') });
        document.getElementById('cv-download').click();
        setTimeout(() => resolve({ before, timeout: true }), 5000);
      }));
      t.ok('скачивание дожидается шрифта слоя', res.before === false && res.atDownload === true, JSON.stringify(res));

      // Находка ревью 25.09: кнопки вариантов и «Скачать все 4» тоже ждут шрифт.
      // Каждой — свой ещё не загруженный шрифт, клик — сразу после отрисовки вариантов.
      const waits = await page.evaluate(async () => {
        const probe = (font, prep, click) => new Promise(resolve => {
          cv.layers = [{ ...cvLayerDefaults('sticker'), font, text: 'ХИТ' }];
          const fstr = cvFontStr(cv.layers[0], 40);
          prep();
          const before = document.fonts.check(fstr, 'АяAz');
          let first = null;
          window.cvDownload = () => { if (first === null) first = document.fonts.check(fstr, 'АяAz'); };
          click();
          setTimeout(() => resolve({ font, before, atDownload: first }), 2500);
        });
        const out = [];
        out.push(await probe('oswald', () => cvGenerateVariations(), () => document.querySelector('[data-cv-dl-var="0"]').click()));
        out.push(await probe('rubik', () => cvGenerateVariations(), () => document.querySelector('[data-act="cv-dl-all-game"]').click()));
        const one = cv.images[0];
        cv.mode = 'collage'; cv.images = [one, { ...one, id: 2 }]; render();
        out.push(await probe('montserrat', () => cvGenerateCollageVars(), () => document.querySelector('[data-cv-dl-cvar="0"]').click()));
        cv.layers = [];
        await document.fonts.load(`900 40px Montserrat`, 'АяAz');
        // для «все 4» коллажа свежего шрифта не осталось — проверяем, что пачка вообще уходит после ожидания
        out.push(await probe('mono', () => cvGenerateCollageVars(), () => document.querySelector('[data-act="cv-dl-all-collage"]').click()));
        return out;
      });
      for (const w of waits.slice(0, 3)) t.ok(`скачивание варианта ждёт шрифт (${w.font})`, w.before === false && w.atDownload === true, JSON.stringify(w));
      t.ok('«Скачать все 4» коллажа по-прежнему скачивает', waits[3].atDownload === true, JSON.stringify(waits[3]));
      t.ok('консоль чистая (скачивание)', consoleErrors.length === 0, consoleErrors.join('\n'));
    } finally { await ctx.close(); }
  }
}
