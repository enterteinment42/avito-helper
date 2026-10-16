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
      state.settings.sigGame = []; state.settings.sigSub = [];
      await doGenerate();
      out.emptyPool = state.results.map(v => v.description);

      state.settings.sigGame = [a, b];
      await doGenerate();
      out.descs = state.results.map(v => v.description);
      out.sigs = state.results.map(v => v._sig);

      // 🔄 — следующая подпись, тело не трогается
      const before = state.results[0]._sig;
      document.querySelector('[data-act="sig-swap"][data-vid="1"]').click();
      out.swap = { before, after: state.results[0]._sig, desc: state.results[0].description };

      // Пул поменяли после генерации — 🔄 всё равно не оставляет старую подпись
      state.settings.sigGame = [a + ' Правка.', b + ' Правка.'];
      document.querySelector('[data-act="sig-swap"][data-vid="1"]').click();
      const d1 = state.results[0].description;
      out.swapAfterEdit = { one: [a, b].every(s => !d1.includes(s + '\n')) && (d1.match(/Почему ко мне/g) || []).length === 1, d1 };
      state.settings.sigGame = [a, b];

      // Пулы разные у игр и подписок; у прочих категорий подписи нет
      state.settings.sigSub = ['Подпись подписки.'];
      out.subSig = sigAttach({ description: 'PS Plus.' }, 'gaming_sub').description;
      out.aiSig  = sigAttach({ description: 'Claude.' }, 'ai_sub').description;
      out.physDesc = sigAttach({ description: 'Вещь.' }, 'phys').description;
      state.settings.sigSub = [];
      // С одним вариантом в пуле менять не на что — кнопки нет
      state.settings.sigGame = [a]; refreshResults();
      out.btnOne = !!document.querySelector('[data-act="sig-swap"]');
      state.settings.sigGame = [a, b]; refreshResults();
      out.btnTwo = !!document.querySelector('[data-act="sig-swap"]');

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
    t.ok('пул изменился после генерации — 🔄 оставляет одну подпись, а не две', r.swapAfterEdit.one, r.swapAfterEdit.d1);
    t.eq('игровая подписка берёт подпись из пула подписок', r.subSig, 'PS Plus.\n\nПодпись подписки.');
    t.eq('AI-подписка — из того же пула подписок', r.aiSig, 'Claude.\n\nПодпись подписки.');
    t.eq('категория без пула — без подписи', r.physDesc, 'Вещь.');
    t.ok('🔄 видна только когда есть на что менять', !r.btnOne && r.btnTwo, JSON.stringify([r.btnOne, r.btnTwo]));
    t.ok('текст без подписи не меняется ни на байт', r.stripSame);
    t.ok('в примерах для модели тело финала есть, подписи нет', r.fewshot.hasBody && !r.fewshot.hasSig, JSON.stringify(r.fewshot));
    t.ok('ротация: модели уходит текст без подписи, результат — с подписью из пула',
      !r.rot.sentSig && r.rot.sentBody && r.rot.resSig, JSON.stringify(r.rot));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Подпись: Сканер, ручные версии, приём настроек ─────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const out = {};
      // Ручная версия подписи — слова поменяны, в пуле её нет, стоит в одной
      // строке с концом тела (живой случай GTA 6, 15.10)
      const HAND = '⚡Возможно, вы задаетесь вопросом, зачем обращаться ко мне, а не продавцу, указавшему в объявлении условно 1000 руб?\nЯ ставлю честную цену.\nУ меня безупречная репутация, которую вы нечасто встретите.';
      const body = 'GTA 6 — главное событие года. Оформляется онлайн на PS5, Xbox Series X|S.';
      state.settings.sigGame = []; state.settings.sigSub = [];
      out.handInline = sigStrip(body + '   ' + HAND);
      out.handBlock  = sigStrip(body + '\n\n' + HAND);

      // Сканер подпись не проверяет: ни сумму, ни «профиль», ни её «онлайн»
      const scan = checkAds('ГТА 6 — главное событие года (PS5)', body + '\n\n' + HAND + ' Отзывы в профиле.', 'game');
      out.scanErrors = scan.errors;
      const noPhrase = checkAds('ГТА 6 (PS5)', 'Тело без фразы.\n\n' + HAND.replace('Я ставлю', 'Оформляется онлайн. Я ставлю'), 'game');
      out.phraseFromSig = noPhrase.ok.some(x => /онлайн/.test(x));
      out.multiplayer = checkAds('Doom (PS5)', 'Онлайн-мультиплеер на четверых.', 'game').ok.some(x => /Оформляется онлайн/.test(x));

      // Финал, где сменили только подпись, — не «голос продавца»
      state.favorites = []; state.refs = [];
      state.db = [{ id: 1, _uid: 'u1', product: 'GTA 6', region: 'Киров', title: 'T', _category: 'game',
        description: 'Бот-тело про GTA.\n\n' + HAND, finalDesc: 'Бот-тело про GTA.\n\n' + HAND.replace('нечасто', 'редко'),
        status: 'active', note: '', date: '15.10.2026' }];
      out.sigOnlyFinal = fewShotSamples('game').all.filter(x => x.final).length;

      // Приём настроек: старая страница/бэкап без пулов не стирает свои
      state.settings.sigGame = ['Моя подпись игр.']; state.settings.sigSub = ['Моя подпись подписок.'];
      settingsAdopt({ model: state.settings.model });
      out.keptMissing = [state.settings.sigGame, state.settings.sigSub];
      settingsAdopt({ model: state.settings.model, sigGame: [], sigSub: ['Новая подписок.'] });
      out.keptEmpty = [state.settings.sigGame, state.settings.sigSub];
      // Единый пул первой версии переезжает в оба новых
      state.settings.sigGame = []; state.settings.sigSub = [];
      settingsAdopt({ model: state.settings.model, sigPool: ['Старая общая.'] });
      out.migrated = [state.settings.sigGame, state.settings.sigSub, 'sigPool' in state.settings];
      return out;
    });
    const BODY = 'GTA 6 — главное событие года. Оформляется онлайн на PS5, Xbox Series X|S.';
    t.eq('ручная подпись в той же строке, что тело, — вырезается по ключевому вопросу', r.handInline, BODY);
    t.eq('ручная подпись отдельным абзацем — тоже', r.handBlock, BODY);
    t.eq('Сканер: сумма и «профиль» в подписи — не ошибки', r.scanErrors.length, 0);
    t.ok('Сканер: «оформляется онлайн» из подписи не засчитывается за тело', !r.phraseFromSig);
    t.ok('Сканер: «онлайн-мультиплеер» — не обязательная фраза', !r.multiplayer);
    t.eq('финал, где сменили только подпись, в «голос продавца» не идёт', r.sigOnlyFinal, 0);
    t.ok('настройки без пулов не стирают свои', JSON.stringify(r.keptMissing) === JSON.stringify([['Моя подпись игр.'], ['Моя подпись подписок.']]), JSON.stringify(r.keptMissing));
    t.ok('пустой входящий пул не стирает свой, непустой — принимается', JSON.stringify(r.keptEmpty) === JSON.stringify([['Моя подпись игр.'], ['Новая подписок.']]), JSON.stringify(r.keptEmpty));
    t.ok('единый пул первой версии переезжает в оба', JSON.stringify(r.migrated) === JSON.stringify([['Старая общая.'], ['Старая общая.'], false]), JSON.stringify(r.migrated));
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── Подписи с сервера (16.10): пустой браузер берёт пулы сам ──
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async () => {
      const out = {};
      const SRV = { sigGame: ['Игра А.', 'Игра Б.'], sigSub: ['Подписка А.'] };
      const net = (settingsDoc, fail) => {
        window.__posts = [];
        localStorage.setItem('avito_admin_token', 'test-token');
        window.fetch = async (url, opts = {}) => {
          const doc = String(url).split('/api/avito-sync/')[1] || '?';
          if (fail && doc === 'settings' && (opts.method || 'GET') === 'GET') return { ok: false, status: 500, json: async () => ({}) };
          if ((opts.method || 'GET') === 'GET') {
            const d = doc === 'settings' ? settingsDoc : null;
            return { ok: true, status: 200, json: async () => (d ? { ok: true, updated: '2026-10-16T10:00:00Z', data: d } : { ok: true, empty: true }) };
          }
          window.__posts.push({ doc, body: JSON.parse(opts.body) });
          return { ok: true, status: 200, json: async () => ({ ok: true, updated: Date.now() }) };
        };
      };
      const reset = (game, sub) => { state.settings.sigGame = game; state.settings.sigSub = sub; state.settings.sigOff = {}; };
      state.settings.pageName = 'Своя страница'; // иначе заводские настройки не отправляются

      // Пустые пулы — забираются с сервера, и в отправку уходят уже с ними
      net({ settings: { ...SRV, pageName: 'Чужая' } });
      reset([], []);
      await syncPush(true);
      const sent = window.__posts.find(p => p.doc === 'settings')?.body?.data?.settings;
      out.pulled = { game: state.settings.sigGame, sub: state.settings.sigSub, page: state.settings.pageName,
                     sentGame: sent?.sigGame, sentSub: sent?.sigSub };

      // Свои подписи входящие не трогают; пустой — только он заполняется
      net({ settings: SRV });
      reset(['Своя игра.'], []);
      await syncPush(true);
      out.own = { game: state.settings.sigGame, sub: state.settings.sigSub };

      // Сервер не ответил — настройки с пустыми пулами не уходят вовсе
      net({ settings: SRV }, true);
      reset([], []);
      await syncPush(true);
      out.failSent = window.__posts.filter(p => p.doc === 'settings').length;
      out.failGame = state.settings.sigGame;

      out.failReturn = await (async () => { net({ settings: SRV }, true); reset([], []); return syncPush(true); })();

      // На сервере настроек нет — отправка идёт как раньше
      net(null);
      reset([], []);
      await syncPush(true);
      out.emptySent = window.__posts.filter(p => p.doc === 'settings').length;

      // Порядок раскатки (ревью 16.10): вкладка уже сверилась, когда пулов на
      // сервере не было; потом сервер их получил; следующая правка — не затирает
      const doc = { settings: { pageName: 'Чужая' } };
      net(doc);
      reset([], []);
      await syncPush(true);                         // на сервере пулов ещё нет
      doc.settings = { ...SRV };                    // Claude1 положил пулы
      state.settings.regions = [...state.settings.regions, 'Тестовый']; save();
      await syncPush();                             // обычная правка
      const after = window.__posts.filter(p => p.doc === 'settings').pop()?.body?.data?.settings;
      out.rollout = { local: state.settings.sigGame.length, sent: after?.sigGame?.length };

      // Единый пул первой версии на сервере — в оба пула
      net({ settings: { sigPool: ['Старая общая.'] } });
      reset([], []);
      await syncPush(true);
      out.legacy = [state.settings.sigGame, state.settings.sigSub];

      // Пул очищен руками — с сервера не возвращается
      net({ settings: SRV });
      reset(['Игра А.'], []);
      state.tab = 'settings'; render();
      document.querySelector('[data-sig-pool="sigGame"]').value = '';
      window.confirm = () => true;
      document.getElementById('sig-save').click();
      await syncPush(true);
      out.cleared = { game: state.settings.sigGame, sub: state.settings.sigSub, off: state.settings.sigOff };
      return out;
    });
    t.ok('пустые пулы забираются с сервера сами, остальные настройки не трогаются',
      JSON.stringify(r.pulled.game) === '["Игра А.","Игра Б."]' && JSON.stringify(r.pulled.sub) === '["Подписка А."]' && r.pulled.page === 'Своя страница',
      JSON.stringify(r.pulled));
    t.ok('и в отправку настроек уходят уже с ними — сервер не теряет подписи',
      JSON.stringify(r.pulled.sentGame) === '["Игра А.","Игра Б."]' && JSON.stringify(r.pulled.sentSub) === '["Подписка А."]', JSON.stringify(r.pulled));
    t.ok('свои подписи входящие не трогают, пустой пул — заполняется',
      JSON.stringify(r.own) === JSON.stringify({ game: ['Своя игра.'], sub: ['Подписка А.'] }), JSON.stringify(r.own));
    t.ok('сервер не ответил — настройки с пустыми пулами не отправляются', r.failSent === 0 && r.failGame.length === 0, JSON.stringify(r));
    t.ok('и «↑ Отправить сейчас» не врёт про успех', r.failReturn === false, String(r.failReturn));
    t.eq('настроек на сервере нет — отправка как раньше', r.emptySent, 1);
    t.ok('пулы пришли на сервер после первой сверки — следующая правка их не затирает, а забирает',
      r.rollout.local === 2 && r.rollout.sent === 2, JSON.stringify(r.rollout));
    t.ok('единый пул первой версии на сервере — в оба пула', JSON.stringify(r.legacy) === '[["Старая общая."],["Старая общая."]]', JSON.stringify(r.legacy));
    t.ok('пул, очищенный руками, с сервера не возвращается; другой пустой — заполняется',
      r.cleared.game.length === 0 && r.cleared.off.sigGame === true && r.cleared.sub.length === 1, JSON.stringify(r.cleared));
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
