// Секция journalfix — правки по первому разбору журнала самообучения (15.10.2026,
// TASK-JOURNAL-FIXES-WINDOWS.md): подпись продавца из пула, «онлайн» вместо
// «в цифре», заголовок игры без образного хвоста, PS4 не теряется, cv_variants
// не пишется на каждую перерисовку, posted/edited несут ключ записи.
import { openApp } from './lib.mjs';

const SIG_A = 'Почему ко мне: честная цена, я сам геймер, отзывы в профиле. Версия А.';
const SIG_B = 'Почему ко мне: цена честная, сам играю, репутация в отзывах. Версия Б.';
const GEN = JSON.stringify({ variants: [1, 2, 3].map(i => ({
  id: i, title: `FC 27 - вариант ${i} (PS4,5)`, description: `Тело варианта ${i}. Оформляется онлайн. PS4 PS5`,
  style: 'деловой', price_format: 'общая', hook: 'фича', structure: 'эмоция→содержимое',
})) });
const GAME_FORM = { category: 'game', gameName: 'FC 27', gamePlatforms: ['PS4', 'PS5'], gameGenre: 'Спорт' };

export async function runJournalfix(browser, base, t) {
  t.section('journalfix — правки по разбору журнала 15.10');

  // ── Промпт и Сканер ─────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const sys = buildSys('game');
      const scan = (ti, d, p) => checkAds(ti, d, 'game', p);
      return {
        online: sys.includes('«оформляется онлайн»') && !sys.includes('оформляется в цифре'),
        banCifra: sys.includes('«В цифре», «цифровая версия» — НЕ пиши'),
        titleArg: sys.includes('ПРОДАЮЩИЙ ДОВОД') && sys.includes('поэтический хвост') && sys.includes('(PS4,5/Xbox)'),
        ps4Rule: sys.includes('Указана PS4 — назови и PS4'),
        okOnline: scan('Doom (PS5)', 'Шутер. Оформляется онлайн.').ok.some(x => /онлайн/.test(x)),
        warnCifra: scan('Doom (PS5)', 'Шутер. Оформляется в цифре.').warnings.some(x => /оформляется онлайн/.test(x)),
        ps4Lost: scan('FC 27 (PS5)', 'Футбол. Онлайн.', ['PS4', 'PS5']).warnings.some(x => /PS4/.test(x)),
        ps4Short: scan('FC 27 (PS4,5/Xbox)', 'Футбол. Онлайн.', ['PS4', 'PS5']).warnings.some(x => /отмечена PS4/.test(x)),
        ps4Ru: scan('FC 27 пс4 пс5', 'Футбол. Онлайн.', ['PS4']).warnings.some(x => /отмечена PS4/.test(x)),
        noPlats: scan('FC 27 (PS5)', 'Футбол. Онлайн.').warnings.some(x => /отмечена PS4/.test(x)),
        ps5Only: scan('FC 27 (PS5)', 'Футбол. Онлайн.', ['PS5']).warnings.some(x => /отмечена PS4/.test(x)),
      };
    });
    t.ok('промпт: «оформляется онлайн», без «оформляется в цифре»', r.online);
    t.ok('промпт: «в цифре» запрещено прямо', r.banCifra);
    t.ok('промпт: заголовок игры — довод, без поэтического хвоста, платформы в скобках', r.titleArg);
    t.ok('промпт: все платформы из формы, PS4 не выкидывать', r.ps4Rule);
    t.ok('Сканер: «онлайн» засчитывается', r.okOnline);
    t.ok('Сканер: одно «в цифре» уже не засчитывается', r.warnCifra);
    t.ok('Сканер: PS4 в форме, а в тексте нет — предупреждение', r.ps4Lost);
    t.ok('Сканер: «PS4,5» считается упоминанием PS4', !r.ps4Short);
    t.ok('Сканер: «пс4» тоже', !r.ps4Ru);
    t.ok('Сканер: без платформ формы проверки нет (старые вызовы не меняются)', !r.noPlats);
    t.ok('Сканер: PS4 не отмечена — не требуем', !r.ps5Only);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Подпись продавца ────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async ([a, b, gen, form]) => {
      const out = {};
      window.callAI = async () => gen;
      state.form = { ...JSON.parse(JSON.stringify(DEF_FORM)), ...form };

      // Пул пуст — текст модели байт в байт
      state.settings.sigPool = [];
      await doGenerate();
      out.emptyPool = state.results.map(v => v.description);

      state.settings.sigPool = [a, b];
      await doGenerate();
      out.descs = state.results.map(v => v.description);
      out.sigs = state.results.map(v => v._sig);

      // 🔄 — следующая подпись, тело не трогается
      const before = state.results[0]._sig;
      document.querySelector('[data-act="sig-swap"][data-vid="1"]').click();
      out.swap = { before, after: state.results[0]._sig, desc: state.results[0].description };

      // Категория без галочки — подписи нет
      const phys = sigAttach({ description: 'Вещь.' }, 'phys');
      out.physDesc = phys.description;

      // Текст без подписи sigStrip не трогает ни байта
      const raw = 'Строка.\n\n\n\nЕщё строка.  ';
      out.stripSame = sigStrip(raw) === raw;

      // Модель подпись не видит: ни в примерах, ни в ротации
      state.db = [{ id: 7, _uid: 'u7', product: 'FC 27', region: 'Киров', title: 'FC 27 (PS5)',
        description: 'Бот-текст.', finalTitle: 'FC 27 - новинка (PS4,5)', finalDesc: 'Живое тело финала про футбол.\n\n' + a,
        status: 'active', note: '', date: '01.10.2026', _category: 'game' }];
      state.favorites = [];
      const msg = buildMsg();
      out.fewshot = { hasBody: msg.includes('Живое тело финала'), hasSig: msg.includes(a) };

      let sent = '';
      window.callAI = async m => { sent = m[0].content; return gen; };
      await doRotate(7, 'light');
      out.rot = { sentSig: sent.includes(a), sentBody: sent.includes('Живое тело финала'),
                  resSig: [a, b].some(s => (state.rotResult?.desc || '').endsWith(s)) };
      return out;
    }, [SIG_A, SIG_B, GEN, GAME_FORM]);

    t.ok('пустой пул — описание как у модели', r.emptyPool.every((d, i) => d === `Тело варианта ${i + 1}. Оформляется онлайн. PS4 PS5`), JSON.stringify(r.emptyPool));
    t.ok('с пулом каждый вариант кончается подписью из пула',
      r.descs.every((d, i) => d === `Тело варианта ${i + 1}. Оформляется онлайн. PS4 PS5\n\n${r.sigs[i]}`) && r.sigs.every(s => s === SIG_A || s === SIG_B),
      JSON.stringify(r.descs));
    t.ok('соседние варианты — с разными подписями', r.sigs[0] !== r.sigs[1] && r.sigs[1] !== r.sigs[2], JSON.stringify(r.sigs));
    t.ok('🔄 меняет подпись, тело на месте', r.swap.after !== r.swap.before
      && r.swap.desc === `Тело варианта 1. Оформляется онлайн. PS4 PS5\n\n${r.swap.after}`, JSON.stringify(r.swap));
    t.eq('категория без галочки — без подписи', r.physDesc, 'Вещь.');
    t.ok('текст без подписи не меняется ни на байт', r.stripSame);
    t.ok('в примерах для модели тело финала есть, подписи нет', r.fewshot.hasBody && !r.fewshot.hasSig, JSON.stringify(r.fewshot));
    t.ok('ротация: модели уходит текст без подписи, результат — с подписью из пула',
      !r.rot.sentSig && r.rot.sentBody && r.rot.resSig, JSON.stringify(r.rot));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Журнал: cv_variants и ключ записи ───────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await page.click('[data-tab="covers"]');
    const r = await page.evaluate(async () => {
      const src = document.createElement('canvas'); src.width = 400; src.height = 500;
      src.getContext('2d').fillRect(0, 0, 400, 500);
      const el = new Image(); await new Promise(res => { el.onload = res; el.src = src.toDataURL('image/png'); });
      cv.mode = 'game'; cv.images = [{ id: 1, url: el.src, el, transform: { scale: 1, ox: 0, oy: 0 } }];
      cv.layers = []; render();
      const log = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { log.push({ ev, data }); };
      document.querySelector('[data-act="cv-gen-vars"]').click();
      const afterClick = log.filter(x => x.ev === 'cv_variants').length;
      for (let i = 0; i < 20; i++) cvReDraw(); // так двигается слайдер
      const afterDrag = log.filter(x => x.ev === 'cv_variants').length;
      window.jlog = origJ;
      return { afterClick, afterDrag };
    });
    t.eq('cv_variants — одно событие на нажатие кнопки', r.afterClick, 1);
    t.eq('перерисовка слайдером новых cv_variants не пишет', r.afterDrag, 1);

    const p = await page.evaluate(async gen => {
      window.callAI = async () => gen;
      state.form = { ...JSON.parse(JSON.stringify(DEF_FORM)), category: 'game', gameName: 'FC 27', gamePlatforms: ['PS5'] };
      state.tab = 'generator'; render();
      await doGenerate();
      const log = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { log.push({ ev, data }); };
      window.prompt = () => 'Киров';
      window.confirm = () => true;
      document.querySelector('[data-act="mark-posted"][data-vid="1"]').click();
      const rec = state.db[state.db.length - 1];
      document.getElementById('final-desc').value = 'Финал, переписанный руками целиком.';
      document.getElementById('final-save').click();
      window.jlog = origJ;
      return { uid: rec._uid, posted: log.find(x => x.ev === 'posted')?.data?.rec, edited: log.find(x => x.ev === 'edited')?.data?.rec };
    }, GEN);
    t.ok('posted несёт ключ записи Истории', !!p.uid && p.posted === p.uid, JSON.stringify(p));
    t.ok('edited — тот же ключ: разбор склеит публикацию и её правки', p.edited === p.uid, JSON.stringify(p));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }
}
