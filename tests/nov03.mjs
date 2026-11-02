// Секция nov03 — просьбы Дениса 03.11.2026:
// 1) «Доп. указания» — главная задача: большое поле, блок ПЕРВЫМ в промпте;
// 2) «💎 Доделать в финал» — черновик идёт вторым референсом, качество high;
// 3) режим «цифровой / физический» для подписок и игр: промпт, примеры, Сканер;
// 4) сверка характеристик по кнопке (веб-поиск);
// 5) заготовка категории «Услуга».
import { openApp } from './lib.mjs';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function runNov03(browser, base, t) {
  t.section('nov03 — доп. указания, финал из черновика, физ.-режим, сверка, услуга');

  // ── 1. Доп. указания ─────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      state.form = { ...JSON.parse(JSON.stringify(DEF_FORM)), category: 'ai_sub', aiService: 'Claude Pro', aiPrice: '2000', aiFeatures: 'Claude Code' };
      const empty = buildMsg();
      state.form.notes = 'Строй всё вокруг Claude Code для программистов';
      const msg = buildMsg();
      const titles = buildTitlesMsg(8);
      const html = formHTML();
      return {
        emptyNoBlock: !empty.includes('ГЛАВНАЯ ЗАДАЧА'),
        first: msg.startsWith('ГЛАВНАЯ ЗАДАЧА ОТ ПРОДАВЦА') && msg.includes('Строй всё вокруг Claude Code'),
        beforeCat: msg.indexOf('ГЛАВНАЯ ЗАДАЧА') < msg.indexOf('Категория:'),
        noOld: !msg.includes('Дополнительно: Строй') && !titles.includes('Дополнительно: Строй'),
        titlesFirst: titles.startsWith('ГЛАВНАЯ ЗАДАЧА'),
        textarea: /<textarea[^>]*data-k="notes"[^>]*class="notes-grow"/.test(html),
      };
    });
    t.ok('указаний нет — блока нет', r.emptyNoBlock);
    t.ok('указания идут первым блоком «ГЛАВНАЯ ЗАДАЧА»', r.first && r.beforeCat);
    t.ok('и в шаге заголовков тоже первым', r.titlesFirst);
    t.ok('старой приписки «Дополнительно:» больше нет', r.noOld);
    t.ok('поле — растущий textarea', r.textarea);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── 2. Доделать в финал ──────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await page.evaluate(() => localStorage.setItem('avito_admin_token', 'test-token'));
    const r = await page.evaluate(async png => {
      state.vision.dataUrl = png;
      state.vision.media = { media_type: 'image/png', data: png.slice(png.indexOf(',') + 1) };
      window.__req = [];
      window.fetch = async (url, opts = {}) => {
        window.__req.push({ url, body: JSON.parse(opts.body || '{}') });
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.slice(png.indexOf(',') + 1), media_type: 'image/png' }] }), text: async () => '' };
      };
      const st = state.vision.staged;
      st.quality = 'medium';
      await doStagedPhoto();
      const draftScene = st.img.scene;
      const btnDraft = stagedCardHTML().includes('data-act="staged-polish"');
      // Сцену переключили после черновика — доводка всё равно повторяет черновик
      const other = SCENES.find(x => x.id !== draftScene).id;
      st.scene = other;
      await doStagedPhoto(true);
      const req = window.__req[1];
      const out = {
        btnDraft,
        refs: req.body.input_references.length,
        quality: req.body.quality,
        rule: req.body.prompt.includes('черновик этого же кадра'),
        scene: st.img.scene === draftScene,
        polished: st.img.polished === true && st.img.quality === 'high',
        btnGone: !stagedCardHTML().includes('data-act="staged-polish"'),
      };
      // Финал не доводится повторно
      await doStagedPhoto(true);
      out.noRepeat = window.__req.length === 2;
      return out;
    }, PNG_1x1);
    t.ok('у черновика есть кнопка «Доделать в финал»', r.btnDraft);
    t.ok('доводка шлёт два референса: фото и черновик', r.refs === 2);
    t.ok('качество доводки — финал', r.quality === 'high' && r.polished);
    t.ok('в промпте правило «повтори черновик»', r.rule);
    t.ok('сцена — черновика, а не переключённая после', r.scene);
    t.ok('у финала кнопки нет, повторно не доводится', r.btnGone && r.noRepeat);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── 3. Физ.-режим ────────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      const base = { ...JSON.parse(JSON.stringify(DEF_FORM)), category: 'gaming_sub', subType: 'PS Plus Extra', platforms: ['PS5'] };
      state.form = { ...base };
      const normal = catInfoBlock(state.form);
      const toggleShown = formHTML().includes('data-act="physmode"');
      state.form.physMode = true;
      const phys = catInfoBlock(state.form);
      state.form = { ...base, category: 'phys', physMode: true, physName: 'Геймпад' };
      const physCat = catInfoBlock(state.form);
      const toggleOnPhys = formHTML().includes('data-act="physmode"');

      const T = 'PS Plus Extra (PS5)';
      const D = 'Подписка на 12 месяцев, оформляется онлайн.';
      const nPhys = checkAds(T, D, 'gaming_sub', [], { phys: true });
      const nNorm = checkAds(T, D, 'gaming_sub', []);
      const clean = checkAds('Пакет игр Extra (PS5)', 'Доступ к сотне игр на год. Пакет на PS5.', 'gaming_sub', [], { phys: true });
      const gameD = checkAds('Doom (PS5)', 'Шутер про демонов.', 'game', [], { phys: true });
      const gameN = checkAds('Doom (PS5)', 'Шутер про демонов.', 'game', []);
      // «место» и «мессенджер» — не «мес»
      const noFalse = checkAds('Пакет (PS5)', 'Место на диске не нужно.', 'gaming_sub', [], { phys: true });
      // Находки разбора Claude1 03.11: латиница в словах, опечатка, «мес» без косой
      const masked = ['Пoдпиcкa Extra', 'Продается в цифpе', 'Продается в цифе', '1 мес — 1800₽', 'Claude AI Pro 1мес', 'стоимость указана за 1 мес']
        .map(x => physModeDirty(x));
      const notMasked = ['PS Plus Extra (PS5)', 'Пакет игр на год', 'Xbox Series X|S'].map(x => physModeDirty(x));

      // Примеры: в физ.-режиме «подписка» в корпус не попадает
      state.refs = [
        { id: 'r1', source: 'mine', category: 'gaming_sub', title: 'Подписка Extra', desc: 'Подписка на месяц, сотни игр' },
        { id: 'r2', source: 'mine', category: 'gaming_sub', title: 'Пакет Extra', desc: 'Пакет игр на год, сотни игр' },
      ];
      state.db = []; state.favorites = [];
      const sp = fewShotSamples('gaming_sub', true).all.map(x => x.title);
      const sn = fewShotSamples('gaming_sub', false).all.map(x => x.title);
      state.form = { ...base, physMode: true };
      const tb = titleSamplesBlock(state.form);
      // Вариант из генерации несёт режим в Сканер
      const v = variantScan({ title: T, description: D }, 'gaming_sub', state.form);
      return {
        normalNo: !normal.includes('ФИЗИЧЕСКИЙ ТОВАР'), physYes: phys.includes('РЕЖИМ «ФИЗИЧЕСКИЙ ТОВАР»') && phys.includes('«пакет», «доступ»'),
        physCatNo: !physCat.includes('РЕЖИМ «ФИЗИЧЕСКИЙ ТОВАР»'), toggleShown, toggleOnPhys,
        errSub: nPhys.errors.some(x => /Подписка/.test(x)), errMonth: nPhys.errors.some(x => /Месяц/.test(x)),
        warnOnline: nPhys.warnings.some(x => /Физ\. режим.*онлайн/i.test(x)),
        normClean: !nNorm.errors.some(x => /Физ\. режим/.test(x)),
        clean: !clean.errors.length && clean.ok.some(x => /Физ\. режим/.test(x)),
        gameNoOnline: !gameD.warnings.some(x => /Нет фразы «оформляется онлайн»/.test(x)) && gameN.warnings.some(x => /Нет фразы «оформляется онлайн»/.test(x)),
        noFalse: !noFalse.errors.length,
        masked: masked.every(Boolean), notMasked: !notMasked.some(Boolean),
        maskedScan: checkAds('Пoдпиcкa (PS5)', 'Игры.', 'gaming_sub', [], { phys: true }).errors.some(x => /Подписка/.test(x)),
        corpusPhys: sp.join('|') === 'Пакет Extra', corpusNorm: sn.length === 2,
        titlesClean: tb.includes('Пакет Extra') && !tb.includes('Подписка Extra'),
        variant: v._phys === true && v._scan.errors.some(x => /Подписка/.test(x)),
      };
    });
    t.ok('режим выключен — промпт прежний', r.normalNo);
    t.ok('режим включён — блок «ФИЗИЧЕСКИЙ ТОВАР» со словарём', r.physYes);
    t.ok('у физтовара переключателя и блока нет', r.physCatNo && !r.toggleOnPhys);
    t.ok('у подписки переключатель есть', r.toggleShown);
    t.ok('Сканер: «подписка» и «месяц» — ошибки в физ.-режиме', r.errSub && r.errMonth);
    t.ok('Сканер: «оформляется онлайн» — предупреждение в физ.-режиме', r.warnOnline);
    t.ok('Сканер: без режима ничего нового не ругается', r.normClean);
    t.ok('Сканер: чистый физ.-текст проходит', r.clean);
    t.ok('Сканер: игра в физ.-режиме не требует «оформляется онлайн»', r.gameNoOnline);
    t.ok('Сканер: «место» не принято за «мес»', r.noFalse);
    t.ok('фильтр видит латиницу в словах, «цифе», «мес» без косой', r.masked);
    t.ok('и не путает с латиницей названий (PS Plus, Xbox)', r.notMasked);
    t.ok('Сканер ловит «Пoдпиcкa» с латиницей', r.maskedScan);
    t.ok('примеры: в физ.-режиме тексты со словом «подписка» отсеяны', r.corpusPhys && r.corpusNorm);
    t.ok('заголовки-образцы отсеяны так же', r.titlesClean);
    t.ok('вариант запоминает режим и проверяется по нему', r.variant);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── 3б. Исправления по ревью 03.11 ───────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    await page.evaluate(() => localStorage.setItem('avito_admin_token', 'test-token'));
    const r = await page.evaluate(async () => {
      const out = {};
      // №1: латинские названия игр — не «мес»
      out.latinTitles = ['MechWarrior 5', 'Mecha BREAK', 'Metro Exodus', 'Cyberpunk 2077 (PS5)'].every(x => !physModeDirty(x));
      out.maskStill = physModeDirty('Пoдпиcкa') && physModeDirty('меcяц');
      // №2: системный промпт в физ.-режиме
      const sN = buildSys('gaming_sub'), sP = buildSys('gaming_sub', true), sPhys = buildSys('phys', true);
      out.sysNormal = sN === buildSys('gaming_sub', false) && sN.includes('«оформляется онлайн»');
      out.sysEditsHit = SYS_PHYS_EDITS.every(([from]) => (SYS_HEAD + SYS_TAIL + SYS_BANS.map(b => typeof b.text === 'string' ? b.text : '').join('\n')).includes(from));
      out.sysPhys = !/оформляется онлайн»/.test(sP.replace('«Оформляется онлайн», «в цифре», «цифровая версия» — НЕ пиши', ''))
        && !sP.includes('помесячная|') && !sP.includes('608₽/мес');
      out.sysOtherCat = sPhys === buildSys('phys');
      let sent = null;
      window.fetch = async (url, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"variants":[]}' }] }), text: async () => '' }; };
      state.settings.provider = 'claude';
      await callAI([{ role: 'user', content: 'x' }], { category: 'gaming_sub', phys: true });
      out.callPhys = !sent.system.includes('помесячная|');
      // №3: ротация и перефраз
      out.rotMid = rotPrompt('mid', { title: 'T', desc: 'D' }, [], true).includes('БЕЗ помесячной') && rotPrompt('mid', { title: 'T', desc: 'D' }, [], true).includes('ФИЗИЧЕСКИЙ ТОВАР');
      out.rotNormal = rotPrompt('mid', { title: 'T', desc: 'D' }, []).includes('была помесячная') && !rotPrompt('light', { title: 'T', desc: 'D' }, []).includes('ФИЗИЧЕСКИЙ');
      const local = { _uid: "u1" }; dbFillFrom(local, { _uid: "u1", finalDesc: "x", finalTitle: "y", _phys: true });
      out.mergePhys = local._phys === true;
      // №5: пустые поля услуги молчат
      state.form = { ...JSON.parse(JSON.stringify(DEF_FORM)), category: 'service', srvName: 'Бот', srvIncludes: 'запись' };
      const info = catInfoBlock(state.form);
      out.srvEmpty = !info.includes('Цена от:') && !info.includes('Сроки:') && !info.includes('Для кого:');
      state.form.srvPrice = '9000';
      out.srvFilled = catInfoBlock(state.form).includes('Цена от: 9000 руб');
      return out;
    });
    t.ok('№1: латинские названия игр не принимаются за «мес»', r.latinTitles);
    t.ok('№1: маскировка латиницей по-прежнему ловится', r.maskStill);
    t.ok('№2: без режима системный промпт прежний', r.sysNormal);
    t.ok('№2: каждая замена находит свою строку в промпте', r.sysEditsHit);
    t.ok('№2: в режиме — без «оформляется онлайн» и помесячных форматов', r.sysPhys);
    t.ok('№2: физтовару флаг ничего не меняет', r.sysOtherCat);
    t.ok('№2: callAI передаёт режим в системный промпт', r.callPhys);
    t.ok('№3: ротация в режиме — без помесячной, с правилами режима', r.rotMid);
    t.ok('№3: ротация без режима прежняя', r.rotNormal);
    t.ok('№3: режим записи переживает слияние с сервером', r.mergePhys);
    t.ok('№5: пустые поля услуги не уходят в промпт', r.srvEmpty && r.srvFilled);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── 4. Сверка характеристик ──────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(async () => {
      let opts = null, msg = '';
      window.callAI = async (m, o) => { opts = o; msg = m[0].content; return JSON.stringify({
        product: 'Sony PS5 Slim', summary: 'Исправьте объём',
        items: [
          { claim: '1024 ГБ', actual: '1 ТБ (Slim)', verdict: 'ok', source: 'sony.com' },
          { claim: 'IP68', actual: 'защиты нет', verdict: 'wrong', source: 'sony.com', note: '<b>x</b>' },
        ] }); };
      state.tab = 'scanner'; render();
      await doSpecCheck('PS5 Slim', 'Память 1024 ГБ, защита IP68', 'CFI-2008');
      const html = document.getElementById('spec-results').innerHTML;
      const emptyCalls = (window.callAI = async () => { throw new Error('не должен звать'); }, null);
      await doSpecCheck('', '', '');
      return {
        web: opts.webSearch === true && opts.provider === 'claude' && opts.system === SPEC_CHECK_SYS,
        model: msg.includes('CFI-2008') && msg.includes('IP68'),
        wrongFirst: html.indexOf('IP68') < html.indexOf('1024'),
        escaped: !html.includes('<b>x</b>'),
        btn: !!document.getElementById('spec-run') && !document.getElementById('spec-run').disabled,
        emptyKept: !!state.spec.result,
      };
    });
    t.ok('сверка идёт через Claude с веб-поиском', r.web);
    t.ok('в запрос уходят текст и модель от продавца', r.model);
    t.ok('расхождения показываются первыми', r.wrongFirst);
    t.ok('ответ модели экранируется', r.escaped);
    t.ok('после ответа кнопка снова активна; пустой текст не тратит запрос', r.btn && r.emptyKept);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }

  // ── 5. Услуга ────────────────────────────────────────────
  {
    const { ctx, page, consoleErrors } = await openApp(browser, base + '/avito-helper.html');
    const r = await page.evaluate(() => {
      state.form = { ...JSON.parse(JSON.stringify(DEF_FORM)), category: 'service', srvName: 'Чат-бот для записи', srvIncludes: 'запись, напоминания', srvPrice: '15000' };
      const info = catInfoBlock(state.form);
      const miss = validateForm();
      const sys = buildSys('service');
      const contact = checkAds('Чат-бот для салона', 'Пишите в Telegram', 'service');
      const platform = checkAds('Чат-бот для салона', 'Бот в Telegram, оплата после запуска', 'service');
      return {
        listed: CATS.some(c => c.id === 'service'), html: formHTML().includes('data-k="srvIncludes"'),
        info: info.includes('Услуга: Чат-бот для записи') && info.includes('ЭТО УСЛУГА') && info.includes('Цена от: 15000 руб'),
        valid: miss.length === 0, payOk: !sys.includes('«платишь», «оплатишь»'),
        contactErr: contact.errors.some(x => /мессенджер/.test(x)),
        platformOk: !platform.errors.length,
      };
    });
    t.ok('категория «Услуга» есть в списке и рисует поля', r.listed && r.html);
    t.ok('поля услуги уходят в промпт со своими правилами', r.info);
    t.ok('заполненная форма проходит проверку', r.valid);
    t.ok('слова оплаты для услуги разрешены', r.payOk);
    t.ok('«пишите в Telegram» — по-прежнему ошибка', r.contactErr);
    t.ok('«бот в Telegram» — не ошибка', r.platformOk);
    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
    await ctx.close();
  }
}
