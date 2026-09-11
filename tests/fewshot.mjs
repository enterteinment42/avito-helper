// Образцы языка продавца в промпте: избранное + свои эталоны, переток между
// категориями с пометкой, крючки заголовков физтовара.
import { openApp } from './lib.mjs';

const seed = (page, { favorites = [], refs = [] }) => page.evaluate(([f, r]) => {
  state.favorites = f; state.refs = r; save();
}, [favorites, refs]);

// fewShotBlock берёт форму целиком: из неё нужен не только тип категории, но и
// название товара — по нему подбирается самый близкий образец.
const block = (page, cat, form = {}) => page.evaluate(([c, f]) => {
  Math.random = () => 0.42;
  return fewShotBlock({ ...DEF_FORM, category: c, ...f });
}, [cat, form]);

const FAV_PHYS = { id: 1, title: 'PS5 Pro с коробкой', description: 'Забирай сегодня, всё родное.', _category: 'phys' };
const FAV_GAME = { id: 2, title: 'Doom пс5', description: 'Оформляется в цифре, шутер года.', _category: 'game' };

export async function runFewshot(browser, base, t) {
  t.section('fewshot — образцы языка и переток между категориями');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // Пусто — блока нет вовсе
    await seed(page, {});
    t.eq('без образцов блок пустой', await block(page, 'phys'), '');

    // Своя категория
    await seed(page, { favorites: [FAV_PHYS, FAV_GAME] });
    const ownBlock = await block(page, 'phys');
    t.ok('берётся пример своей категории', ownBlock.includes('PS5 Pro с коробкой'), ownBlock);
    t.ok('формулировка прежняя', ownBlock.includes('Примеры твоих же удачных объявлений этой категории'), ownBlock);
    // Голос принадлежит продавцу, а не категории: объявление из другой категории
    // теперь подмешивается ВСЕГДА, но отдельным слотом и с запретом на факты.
    t.ok('чужая категория идёт слотом голоса', ownBlock.includes('Doom'), ownBlock);
    t.ok('и слот подписан как другой товар', ownBlock.includes('Это тоже ты, но ДРУГОЙ товар'), ownBlock);
    t.ok('с запретом переносить факты', ownBlock.includes('факты, комплектацию и правила оттуда НЕ переноси'), ownBlock);
    t.ok('основные примеры при этом свои', ownBlock.indexOf('PS5 Pro с коробкой') < ownBlock.indexOf('Doom'), ownBlock);

    // Своих нет — берём чужие, но с пометкой
    await seed(page, { favorites: [FAV_GAME] });
    const crossBlock = await block(page, 'phys');
    t.ok('чужая категория подхватывается', crossBlock.includes('Doom'), crossBlock);
    t.ok('и явно помечена как чужая', crossBlock.includes('ИЗ ДРУГОЙ КАТЕГОРИИ'), crossBlock);
    t.ok('с запретом переносить формулировки', crossBlock.includes('НЕ переноси оттуда формулировки'), crossBlock);

    // Свои эталоны (✍) идут в промпт, чужие (👀) — нет
    await seed(page, { refs: [
      { id: 1, source: 'mine',  category: 'phys', title: 'Геймпад белый', desc: 'Мой текст руками.' },
      { id: 2, source: 'other', category: 'phys', title: 'Чужое удачное', desc: 'Чужой текст.' },
    ] });
    const refBlock = await block(page, 'phys');
    t.ok('свой эталон попал в промпт', refBlock.includes('Мой текст руками'), refBlock);
    t.ok('чужой эталон в промпт не идёт', !refBlock.includes('Чужой текст'), refBlock);

    // Эталон без заголовка не ломает строку
    await seed(page, { refs: [{ id: 3, source: 'mine', category: 'phys', title: '', desc: 'Только описание.' }] });
    const noTitle = await block(page, 'phys');
    t.ok('эталон без названия выводится описанием', /Пример 1:\nТолько описание\./.test(noTitle), noTitle);
    t.ok('и без пустых кавычек', !noTitle.includes('«»'), noTitle);

    // Избранное и эталоны смешиваются
    await seed(page, { favorites: [FAV_PHYS], refs: [{ id: 4, source: 'mine', category: 'phys', title: 'Из рук', desc: 'Второй образец.' }] });
    const mixed = await block(page, 'phys');
    t.eq('в блок идут оба образца', (mixed.match(/^Пример \d/gm) || []).length, 2, mixed);

    // Игры, которые Денис начнёт вставлять, помогут физтовару
    await seed(page, { refs: [{ id: 5, source: 'mine', category: 'game', title: 'RDR2 пс4', desc: 'Живой текст про игру.' }] });
    const gameToPhys = await block(page, 'phys');
    t.ok('эталон по играм доходит до физтовара', gameToPhys.includes('Живой текст про игру'), gameToPhys);
    t.ok('но с пометкой о чужой категории', gameToPhys.includes('ИЗ ДРУГОЙ КАТЕГОРИИ'), gameToPhys);

    // ── Крючки заголовков физтовара ─────────────────────────
    const info = await page.evaluate(() => {
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' }));
      return catInfoBlock(state.form);
    });
    t.ok('правило про крючки уехало в промпт', info.includes('крючок берётся НЕ из состояния'), info.slice(-400));
    t.ok('слабый крючок назван прямо', info.includes('СЛАБЫЙ крючок'));
    t.ok('требуется вариация написания названия', info.includes('ПС5 Про'));
    t.ok('и добор лимита символов', info.includes('Добивай лимит 50 символов'));

    // ── Чужие эталоны: приёмы вместо текста ─────────────────
    await seed(page, { refs: [
      { id: 11, source: 'other', category: 'phys', title: 'Чужое название', desc: 'Чужой текст с двумя геймпадами и ценой 30000 в Казани.' },
      { id: 12, source: 'other', category: 'phys', title: 'Второе чужое', desc: 'Ещё чужой текст.' },
    ] });
    const before = await page.evaluate(() => ({
      block: fewShotBlock({ ...DEF_FORM, category: 'phys' }) + refTricksBlock('phys'),
      pending: refsToAnalyze().length,
    }));
    t.eq('до разбора чужие в промпт не идут', before.block, '');
    t.eq('и числятся неразобранными', before.pending, 2);

    const analyzed = await page.evaluate(async () => {
      window.__asked = '';
      window.callAI = async (m, opts = {}) => {
        window.__asked = m.map(x => x.content).join('\n');
        window.__sys = opts.system || '';
        return JSON.stringify({ items: [
          { id: 11, tricks: ['начинает с вопроса, который задаёт себе покупатель', 'список через тире, а не запятыми'] },
          { id: 12, tricks: [] },
        ] });
      };
      await doRefTricks();
      return {
        tricks: state.refs.find(r => r.id === 11).tricks,
        empty: state.refs.find(r => r.id === 12).tricks,
        pending: refsToAnalyze().length,
        askedHasText: window.__asked.includes('Чужой текст с двумя геймпадами'),
        sysBansFacts: window.__sys.includes('НЕ переноси факты'),
      };
    });
    t.eq('приёмы сохранены', analyzed.tricks.length, 2);
    t.ok('приём сформулирован как ход', analyzed.tricks[0].includes('начинает с вопроса'), analyzed.tricks[0]);
    t.eq('объявление без приёмов помечено пустым списком', analyzed.empty.length, 0);
    t.eq('повторно оно на разбор не пойдёт', analyzed.pending, 0);
    t.ok('на разбор чужой текст уходит (иначе разбирать нечего)', analyzed.askedHasText);
    t.ok('промпт разбора запрещает переносить факты', analyzed.sysBansFacts);

    const after = await page.evaluate(() => ({
      tricks: refTricksBlock('phys'),
      full: learnedBlock({ ...DEF_FORM, category: 'phys' }),
    }));
    t.ok('приёмы подмешиваются в генерацию', after.tricks.includes('начинает с вопроса'), after.tricks);
    t.ok('и помечены как чужие ходы', after.tricks.includes('это ходы, а не текст'), after.tricks);
    t.ok('чужой ТЕКСТ в промпт не попадает', !after.full.includes('Чужой текст с двумя геймпадами'), after.full);
    t.ok('и чужие факты тоже', !after.full.includes('30000') && !after.full.includes('Казани'), after.full);

    // Приёмы своей категории в приоритете, но при их отсутствии берутся любые
    await seed(page, { refs: [
      { id: 13, source: 'other', category: 'game', title: 'Игровое', desc: 'x', tricks: ['ход из игр'] },
    ] });
    t.ok('приёмы из другой категории подхватываются, если своих нет',
      (await page.evaluate(() => refTricksBlock('phys'))).includes('ход из игр'));

    // ── Находки код-ревью разбора приёмов ───────────────────
    // Большая пачка режется на чанки: один запрос упирался бы в max_tokens,
    // ответ обрывался, JSON.parse падал — и кнопка не срабатывала бы никогда
    const chunked = await page.evaluate(async () => {
      state.refs = Array.from({ length: 14 }, (_, i) => ({
        id: 100 + i, source: 'other', category: 'phys', title: 'Ч' + i, desc: 'текст ' + i,
      }));
      save();
      const sizes = [];
      window.callAI = async (m, opts = {}) => {
        const ids = [...m[0].content.matchAll(/id: (\d+)/g)].map(x => +x[1]);
        sizes.push({ n: ids.length, max: opts.max_tokens });
        return JSON.stringify({ items: ids.map(id => ({ id, tricks: ['ход ' + id] })) });
      };
      await doRefTricks();
      return { sizes, done: state.refs.filter(r => Array.isArray(r.tricks)).length };
    });
    t.eq('пачка разбита на чанки', chunked.sizes.length, 3);
    t.ok('в чанке не больше шести объявлений', chunked.sizes.every(s => s.n <= 6), JSON.stringify(chunked.sizes));
    t.ok('лимит ответа зависит от размера чанка', chunked.sizes[0].max > chunked.sizes[2].max,
      JSON.stringify(chunked.sizes));
    t.eq('разобраны все', chunked.done, 14);

    // Не вернувшиеся в ответе эталоны остаются на следующий заход
    const partial = await page.evaluate(async () => {
      state.refs = [
        { id: 201, source: 'other', category: 'phys', title: 'A', desc: 'a' },
        { id: 202, source: 'other', category: 'phys', title: 'B', desc: 'b' },
        { id: 203, source: 'other', category: 'phys', title: 'C', desc: 'c' },
      ];
      save();
      // Модель ответила только про первое и второе (второе — без приёмов)
      window.callAI = async () => JSON.stringify({ items: [
        { id: 201, tricks: ['ход'] },
        { id: 202, tricks: [] },
      ] });
      await doRefTricks();
      return {
        a: state.refs.find(r => r.id === 201).tricks,
        b: state.refs.find(r => r.id === 202).tricks,
        c: state.refs.find(r => r.id === 203).tricks,
        pending: refsToAnalyze().map(r => r.id),
      };
    });
    t.eq('ответивший с приёмами сохранён', partial.a.length, 1);
    t.eq('ответивший без приёмов помечен пустым', partial.b.length, 0);
    t.eq('неотвеченный НЕ помечен', partial.c, undefined);
    t.eq('и вернётся в следующий заход', partial.pending.join(','), '203');

    // Чужой id не цепляет посторонний эталон
    const forgedId = await page.evaluate(async () => {
      state.refs = [
        { id: 301, source: 'mine',  category: 'phys', title: 'Моё', desc: 'мой текст' },
        { id: 302, source: 'other', category: 'phys', title: 'Чужое', desc: 'чужой текст' },
      ];
      save();
      window.callAI = async () => JSON.stringify({ items: [{ id: 301, tricks: ['подмена'] }] });
      await doRefTricks();
      return { mine: state.refs.find(r => r.id === 301).tricks, other: state.refs.find(r => r.id === 302).tricks };
    });
    t.eq('приёмы не прицепились к своему эталону', forgedId.mine, undefined);
    t.eq('и чужой не помечен по чужому id', forgedId.other, undefined);

    // Приёмы фильтруются тем же списком запретов, что и объявления
    const clean = await page.evaluate(async () => {
      state.refs = [{ id: 401, source: 'other', category: 'phys', title: 'Ч', desc: 'ч' }];
      save();
      window.callAI = async () => JSON.stringify({ items: [{ id: 401, tricks: [
        'зовёт продолжить общение в телеграм — пишите в telegram',
        'предлагает передать аккаунт вместе с товаром',
        'даёт ссылку https://example.com на обзор',
        'начинает с вопроса покупателя',
        'x'.repeat(300),
      ] }] });
      await doRefTricks();
      return state.refs[0].tricks;
    });
    t.ok('приём про мессенджер отброшен', !clean.some(s => /телеграм|telegram/i.test(s)), JSON.stringify(clean));
    t.ok('приём про аккаунт отброшен', !clean.some(s => /аккаунт/i.test(s)), JSON.stringify(clean));
    t.ok('приём со ссылкой отброшен', !clean.some(s => /https?:/i.test(s)), JSON.stringify(clean));
    t.ok('безопасный приём сохранён', clean.some(s => s.includes('начинает с вопроса')), JSON.stringify(clean));
    t.ok('длина приёма ограничена', clean.every(s => s.length <= 160), JSON.stringify(clean.map(s => s.length)));

    // Падение одного чанка не роняет остальные
    const resilient = await page.evaluate(async () => {
      state.refs = Array.from({ length: 8 }, (_, i) => ({
        id: 500 + i, source: 'other', category: 'phys', title: 'Ч' + i, desc: 'т' + i,
      }));
      save();
      let call = 0;
      window.callAI = async (m) => {
        call++;
        if (call === 1) return 'не json вовсе';
        const ids = [...m[0].content.matchAll(/id: (\d+)/g)].map(x => +x[1]);
        return JSON.stringify({ items: ids.map(id => ({ id, tricks: ['ход'] })) });
      };
      await doRefTricks();
      return { done: state.refs.filter(r => Array.isArray(r.tricks)).length, pending: refsToAnalyze().length };
    });
    t.eq('второй чанк отработал, несмотря на падение первого', resilient.done, 2);
    t.eq('упавший чанк вернётся в следующий заход', resilient.pending, 6);

    // Разбирать нечего — вызова нет
    const noop = await page.evaluate(async () => {
      state.refs = []; save();          // предыдущий тест намеренно оставил неразобранные
      let called = 0;
      window.callAI = async () => { called++; return '{}'; };
      await doRefTricks();
      return called;
    });
    t.eq('без неразобранных запрос не уходит', noop, 0);

    // ── Отбор под накопленный корпус (сессия 2026-09-11) ────
    // При сотне эталонов жребий подсовывал по «PS5 Pro» пример про что угодно, а
    // собственный отточенный текст именно по этому товару модель не видела.
    const TARGET = 'ЦЕЛЕВОЙ текст именно про эту модель.';
    await page.evaluate(t => {
      state.refs = [
        { id: 601, source: 'mine', category: 'phys', title: 'PS5 Pro белая', desc: t },
        ...Array.from({ length: 7 }, (_, i) => ({
          id: 610 + i, source: 'mine', category: 'phys', title: 'Геймпад ' + i, desc: 'Обычный текст ' + i,
        })),
      ];
      state.favorites = [];
      save();
      // Свой ГПСЧ: helper block() ранее прибил Math.random константой, а тут нужна
      // как раз изменчивость выборки
      let s = 1;
      Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    }, TARGET);

    const hybrid = await page.evaluate(t => {
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      const runs = Array.from({ length: 8 }, () => fewShotBlock(f));
      return {
        always: runs.every(b => b.includes(t)),
        count: (runs[0].match(/^Пример \d/gm) || []).length,
        variety: new Set(runs.map(b => (b.match(/«[^»]+»/g) || []).join('|'))).size,
      };
    }, TARGET);
    t.ok('близкий к товару эталон попадает в промпт всегда', hybrid.always, 'в какой-то выборке целевого эталона не было');
    // Корпус в этом тесте целиком из одной категории: чужому слоту A взять нечего,
    // слот B достаётся своей — три основных примера плюс он
    t.eq('примеров в блоке — четыре', hybrid.count, 4);
    t.ok('но остальные меняются от запуска к запуску (антидубль)', hybrid.variety > 1, `выборка повторилась во всех прогонах`);

    // Товар не заполнен — скоринг не должен цепляться за слово «Товар»
    const noProduct = await page.evaluate(() => {
      const f = { ...DEF_FORM, category: 'phys', physName: '' };
      return { name: currentProductName(f), block: fewShotBlock(f) };
    });
    t.eq('без названия товара имя — заглушка', noProduct.name, 'Товар');
    t.ok('и блок всё равно собирается', noProduct.block.includes('Пример 1'), noProduct.block.slice(0, 200));

    // Полный текст вместо обрезки по 220 знаков
    const longText = 'Строка один.\nСтрока два со списком: GTA 5, Hogwarts, Skyrim.\n' + 'Хвост объявления. '.repeat(40) + '\n💲12 месяцев — 3000 рублей. Финальный призыв.';
    const full = await page.evaluate(txt => {
      state.refs = [{ id: 701, source: 'mine', category: 'phys', title: 'Длинное', desc: txt }];
      state.favorites = []; save();
      return fewShotBlock({ ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' });
    }, longText);
    t.ok('длинный эталон показан целиком', full.includes('Финальный призыв'), `длина эталона ${longText.length}, блок обрывается`);
    t.ok('переносы строк сохранены', full.includes('Строка один.\nСтрока два'), JSON.stringify(full.slice(0, 200)));
    t.ok('и ничего не помечено обрезанным', !full.includes('обрезан по длине'), full.slice(-200));

    // Потолок существует, но срабатывает только на аномально длинном тексте
    const capped = await page.evaluate(() => {
      const huge = 'а'.repeat(2600);
      state.refs = [{ id: 702, source: 'mine', category: 'phys', title: 'Огромное', desc: huge }];
      save();
      const b = fewShotBlock({ ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' });
      return { marked: b.includes('обрезан по длине'), len: b.length, cap: FEWSHOT_MAX };
    });
    t.ok('аномально длинный эталон обрезан', capped.marked, `длина блока ${capped.len}`);
    t.eq('потолок выше самого длинного реального эталона (1720)', capped.cap >= 1800, true);

    // ── Финальный текст с Авито как образец голоса ──────────
    // Вариант из избранного написала модель, а человек его одобрил. Финал он
    // ДОРАБОТАЛ рукой уже в форме Авито — это самый точный слепок голоса, и до
    // сессии 2026-09-11 он вообще не участвовал в генерации.
    const finals = await page.evaluate(() => {
      state.refs = [{ id: 1201, source: 'mine', category: 'phys', title: 'Эталон', desc: 'Текст эталона.' }];
      state.favorites = [];
      state.db = [
        { id: 1301, product: 'PS5 Pro', region: 'Москва', title: 'Бот', description: 'Бот-версия описания.',
          finalTitle: 'Рука', finalDesc: 'ФИНАЛ, доведённый рукой.', _category: 'phys' },
        // Финал, где описание не вставляли: диалог подставляет бот-версию сам,
        // и о голосе такой «финал» не говорит ничего
        { id: 1302, product: 'PS5 Pro', region: 'Казань', title: 'Бот2', description: 'Бот-версия два.',
          finalTitle: 'Бот2', finalDesc: 'Бот-версия два.', _category: 'phys' },
        // Старая запись без категории — положить её некуда, правила категорий разные
        { id: 1303, product: 'PS5 Pro', region: 'Омск', title: 'Стар', description: 'Старая бот-версия.',
          finalTitle: 'Стар', finalDesc: 'СТАРЫЙ ФИНАЛ без категории.' },
      ];
      save();
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      const blocks = Array.from({ length: 5 }, () => fewShotBlock(f));
      return {
        blocks,
        sample: blocks[0],
        poolHasFinal: fewShotSamples('phys').list.some(s => s.final),
      };
    });
    t.ok('финал попал в пул примеров', finals.poolHasFinal);
    t.ok('и берётся в КАЖДОЙ выборке — слот под него зарезервирован',
      finals.blocks.every(b => b.includes('ФИНАЛ, доведённый рукой')), 'в какой-то выборке финала не было');
    t.ok('он подписан как финальный, а не как обычный пример',
      finals.sample.includes('ФИНАЛЬНЫЙ текст'), finals.sample.slice(0, 400));
    t.ok('невставленное описание финалом не считается',
      !finals.sample.includes('Бот-версия два'), finals.sample);
    t.ok('финал без категории не подмешивается',
      !finals.blocks.join('').includes('СТАРЫЙ ФИНАЛ'), 'финал без категории просочился');
    t.ok('обычные эталоны при этом никуда не делись',
      finals.blocks.some(b => b.includes('Текст эталона')), finals.sample);

    // Категория проставляется записи Истории в момент «✓ Размещено» — без неё
    // финал по этой записи потом некуда положить
    const stamped = await page.evaluate(() => {
      state.db = []; state.results = [{
        id: 1, title: 'Т', description: 'Д', _product: 'PS5 Pro', _category: 'phys', _chain: 'c1',
      }];
      state.form = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      window.prompt = () => 'Москва';
      save();
      state.tab = 'generator'; render();   // кнопка «✓ Размещено» живёт на карточке варианта
      document.querySelector('[data-act="mark-posted"][data-vid="1"]')?.click();
      document.getElementById('final-overlay')?.remove();
      return state.db[0]?._category || null;
    });
    t.eq('запись Истории получает категорию варианта', stamped, 'phys');

    // Находка ревью: ☆ на варианте → «✓ Размещено» → донос финала кладёт в корпус
    // ДВА почти одинаковых текста, и второй слот доставался бы бот-близнецу финала.
    const twin = await page.evaluate(() => {
      state.refs = [];
      state.favorites = [
        { _fid: 1, title: 'Бот', description: 'БОТ-БЛИЗНЕЦ финала, отличается парой слов.', _category: 'phys', _chain: 'ch-1' },
        { _fid: 2, title: 'Другое', description: 'СОВСЕМ ДРУГОЕ объявление про станцию.', _category: 'phys', _chain: 'ch-2' },
      ];
      state.db = [{ id: 1, product: 'PS5 Pro', region: 'Москва', title: 'Бот', description: 'БОТ-БЛИЗНЕЦ финала, отличается парой слов.',
        finalTitle: 'Рука', finalDesc: 'БОТ-БЛИЗНЕЦ финала, отличается ПАРОЙ СЛОВ и рукой.', _category: 'phys', _chain: 'ch-1' }];
      save();
      const b = fewShotBlock({ ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' });
      return { b, pool: fewShotSamples('phys').list.length };
    });
    t.eq('бот-версия того же объявления выброшена из пула', twin.pool, 2);
    t.ok('в промпте финал', twin.b.includes('и рукой'), twin.b);
    t.ok('и НЕ его бот-близнец', !/БОТ-БЛИЗНЕЦ финала, отличается парой слов/.test(twin.b), twin.b);
    t.ok('а второй пример — другое объявление', twin.b.includes('СОВСЕМ ДРУГОЕ'), twin.b);

    // Находка ревью: заголовок, поправленный рукой, тоже должен попадать в блок
    // названий — ради него блок и делался
    const handTitle = await page.evaluate(() => {
      state.refs = Array.from({ length: 30 }, (_, i) => ({
        id: 1500 + i, source: 'mine', category: 'phys', title: 'Сгенерированный ' + i, desc: 'текст',
      }));
      state.favorites = [];
      state.db = [{ id: 2, product: 'PS5 Pro', region: 'Москва', title: 'Бот-заголовок',
        description: 'д', finalTitle: 'ПОПРАВЛЕННЫЙ РУКОЙ заголовок', finalDesc: 'д2', _category: 'phys' }];
      save();
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      return Array.from({ length: 5 }, () => titleSamplesBlock(f));
    });
    t.ok('правленый рукой заголовок в блоке названий',
      handTitle.every(b => b.includes('ПОПРАВЛЕННЫЙ РУКОЙ заголовок')), 'в какой-то выборке его не было');
    t.ok('и бот-версия этого же заголовка не подмешана',
      !handTitle[0].includes('Бот-заголовок'), handTitle[0]);

    // Находка ревью: категория записи Истории не должна браться из ЖИВОЙ формы —
    // на старом избранном без штампа финал по вещи уехал бы в примеры игр
    const noBleed = await page.evaluate(() => {
      state.db = [];
      state.results = [{ id: 1, title: 'Т', description: 'Д', _product: 'Старое', _chain: 'c9' }]; // без _category
      state.form = { ...DEF_FORM, category: 'game', gameName: 'GTA 5' };  // генератор переключён на игры
      window.prompt = () => 'Москва';
      save();
      state.tab = 'generator'; render();
      document.querySelector('[data-act="mark-posted"][data-vid="1"]')?.click();
      document.getElementById('final-overlay')?.remove();
      return state.db.length ? String(state.db[0]._category) : 'записи нет';
    });
    t.eq('без штампа варианта категория не подставляется из формы', noBleed, 'null');

    // ── Переразметка голоса ─────────────────────────────────
    // «Моё/чужое» оказалось не тем признаком: часть объявлений написана нейросетью,
    // но принята человеком, а часть «чужих» — его же объявления чужим голосом.
    const voice = await page.evaluate(async () => {
      state.refs = [{ id: 1401, source: 'other', category: 'phys', title: 'Переключаемое', desc: 'ТЕКСТ ПЕРЕКЛЮЧАЕМОГО.' }];
      state.favorites = []; state.db = []; save();
      state.tab = 'database'; render();
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      const before = fewShotBlock(f);
      document.querySelector('[data-act="ref-voice"][data-id="1401"]')?.click();
      await new Promise(r => setTimeout(r, 30));
      const after = fewShotBlock(f);
      const src = state.refs[0].source;
      document.querySelector('[data-act="ref-voice"][data-id="1401"]')?.click();
      return { before, after, src, back: state.refs[0].source, label: document.querySelector('[data-act="ref-voice"]')?.textContent.trim() };
    });
    t.ok('до переключения «не мой голос» в примеры не идёт', !voice.before.includes('ТЕКСТ ПЕРЕКЛЮЧАЕМОГО'), voice.before);
    t.eq('нажатие меняет метку голоса', voice.src, 'mine');
    t.ok('и текст сразу начинает идти в примеры', voice.after.includes('ТЕКСТ ПЕРЕКЛЮЧАЕМОГО'), voice.after);
    t.eq('переключается обратно', voice.back, 'other');
    t.ok('метка на кнопке говорит про голос, а не про авторство', /голос|не мой/.test(voice.label || ''), voice.label);

    // ── Схема примеров «3 + 2» ──────────────────────────────
    // Три своих + слот A (гарантированно другая категория, категории равновероятны)
    // + слот B (жребий по всему корпусу, чаще свой там, где своего сырья больше).
    const scheme = await page.evaluate(() => {
      state.db = []; state.favorites = [];
      // Корпус с перекосом как у Дениса: подписок сильно больше остальных
      state.refs = [
        ...Array.from({ length: 20 }, (_, i) => ({ id: 2000 + i, source: 'mine', category: 'gaming_sub', title: 'Подписка ' + i, desc: 'Текст подписки ' + i })),
        ...Array.from({ length: 3 },  (_, i) => ({ id: 2100 + i, source: 'mine', category: 'phys', title: 'Вещь ' + i, desc: 'Текст вещи ' + i })),
        ...Array.from({ length: 3 },  (_, i) => ({ id: 2200 + i, source: 'mine', category: 'game', title: 'Игра ' + i, desc: 'Текст игры ' + i })),
      ];
      save();
      const run = cat => {
        const f = { ...DEF_FORM, category: cat, subType: 'PS Plus Extra', physName: 'Геймпад', gameName: 'GTA 5' };
        const counts = { alien: 0, slotA: {} };
        let examples = 0;
        for (let i = 0; i < 200; i++) {
          const b = fewShotBlock(f);
          examples += (b.match(/^Пример \d+/gm) || []).length;
          const alienPart = b.split('Это тоже ты, но ДРУГОЙ товар')[1] || '';
          counts.alien += (alienPart.match(/^Пример \d+/gm) || []).length;
          // Слот A рендерится первым в чужом блоке — по нему и судим о равновесии
          // категорий; слот B взвешен по объявлениям и меряется отдельно
          const firstAlien = alienPart.split(/^Пример \d+/m)[1] || '';
          for (const [name, c] of [['Подписка ', 'gaming_sub'], ['Вещь ', 'phys'], ['Игра ', 'game']]) {
            if (firstAlien.includes(name)) counts.slotA[c] = (counts.slotA[c] || 0) + 1;
          }
        }
        return { avgExamples: examples / 200, alienPerRun: counts.alien / 200, slotA: counts.slotA };
      };
      return { sub: run('gaming_sub'), phys: run('phys') };
    });
    t.eq('в промпте пять примеров', Math.round(scheme.sub.avgExamples), 5);
    t.ok('в богатой категории чужих примеров около одного (слот B чаще свой)',
      scheme.sub.alienPerRun > 0.9 && scheme.sub.alienPerRun < 1.5, `чужих на запрос: ${scheme.sub.alienPerRun}`);
    t.ok('в бедной категории чужих около двух (слот B чаще чужой)',
      scheme.phys.alienPerRun > 1.5, `чужих на запрос: ${scheme.phys.alienPerRun}`);
    t.ok('слот A всегда приносит чужую категорию', scheme.sub.alienPerRun >= 1, JSON.stringify(scheme.sub));
    // Главное свойство равновесного жребия в слоте A: подписки (20 объявлений из 26)
    // НЕ должны занимать его в 8 случаях из 10 только потому, что их больше
    const a = scheme.phys.slotA;
    const aSub = a.gaming_sub || 0, aGame = a.game || 0;
    t.ok('слот A: подписки не давят числом — категории равновероятны',
      aSub < 200 * 0.68, `подписка ${aSub} раз из 200: ${JSON.stringify(a)}`);
    t.ok('слот A: вторая категория выпадает сопоставимо часто',
      aGame > 200 * 0.3, `игра ${aGame} раз из 200: ${JSON.stringify(a)}`);

    // ── Пометка про цены в чужом примере ────────────────────
    const priceWarn = await page.evaluate(() => {
      state.db = []; state.favorites = [];
      state.refs = [
        { id: 2300, source: 'mine', category: 'phys', title: 'Вещь', desc: 'Текст вещи без цифр.' },
        { id: 2301, source: 'mine', category: 'gaming_sub', title: 'Подписка', desc: 'Подписка на год. 💲12 месяцев — 3000 рублей.' },
      ];
      save();
      const phys = fewShotBlock({ ...DEF_FORM, category: 'phys', physName: 'Геймпад' });
      const sub  = fewShotBlock({ ...DEF_FORM, category: 'gaming_sub', subType: 'PS Plus Extra' });
      return { phys, sub, physRule: scanRuleOn('phys', 'game_price'), subRule: scanRuleOn('gaming_sub', 'game_price') };
    });
    t.ok('у физтовара цена в тексте запрещена', priceWarn.physRule);
    t.ok('у подписки — разрешена', !priceWarn.subRule);
    t.ok('в генерации вещи чужой пример с ценами получает предупреждение',
      priceWarn.phys.includes('цена в тексте ЗАПРЕЩЕНА'), priceWarn.phys);
    t.ok('в генерации подписки предупреждения нет — там цены нормальны',
      !priceWarn.sub.includes('цена в тексте ЗАПРЕЩЕНА'), priceWarn.sub);

    // ── Гарантированный слот финала — только от двух ────────
    const oneFinal = await page.evaluate(() => {
      state.favorites = [];
      state.refs = Array.from({ length: 15 }, (_, i) => ({
        id: 2400 + i, source: 'mine', category: 'gaming_sub', title: 'EA Play ' + i, desc: 'Текст про EA Play ' + i,
      }));
      // Один финал, и он про ДРУГОЙ товар категории
      state.db = [{ id: 2500, product: 'PS Plus Extra', region: 'М', title: 'Бот', description: 'Бот-версия.',
        finalTitle: 'Рука', finalDesc: 'ЕДИНСТВЕННЫЙ ФИНАЛ про PS Plus Extra.', _category: 'gaming_sub', _chain: 'f1' }];
      save();
      const otherProduct = Array.from({ length: 30 }, () =>
        fewShotBlock({ ...DEF_FORM, category: 'gaming_sub', subType: 'EA Play' }));
      const sameProduct = Array.from({ length: 10 }, () =>
        fewShotBlock({ ...DEF_FORM, category: 'gaming_sub', subType: 'PS Plus Extra' }));
      return {
        inOther: otherProduct.filter(b => b.includes('ЕДИНСТВЕННЫЙ ФИНАЛ')).length,
        inSame: sameProduct.filter(b => b.includes('ЕДИНСТВЕННЫЙ ФИНАЛ')).length,
      };
    });
    t.ok('одиночный финал НЕ лезет в каждый запрос соседних товаров',
      oneFinal.inOther < 25, `попал в ${oneFinal.inOther} из 30 генераций другого товара`);
    t.eq('но приходит туда, где уместен — в генерацию того же товара', oneFinal.inSame, 10);

    const twoFinals = await page.evaluate(() => {
      state.db.push({ id: 2501, product: 'EA Play', region: 'К', title: 'Бот2', description: 'Бот-версия 2.',
        finalTitle: 'Рука2', finalDesc: 'ВТОРОЙ ФИНАЛ про EA Play.', _category: 'gaming_sub', _chain: 'f2' });
      save();
      const runs = Array.from({ length: 20 }, () =>
        fewShotBlock({ ...DEF_FORM, category: 'gaming_sub', subType: 'Game Pass' }));
      return {
        withFinal: runs.filter(b => /ФИНАЛ/.test(b)).length,
        rotates: new Set(runs.map(b => /ЕДИНСТВЕННЫЙ ФИНАЛ/.test(b) ? 'a' : (/ВТОРОЙ ФИНАЛ/.test(b) ? 'b' : '-'))).size,
      };
    });
    t.eq('с двух финалов слот резервируется в каждом запросе', twoFinals.withFinal, 20);
    t.ok('и финалы чередуются между собой', twoFinals.rotates > 1, 'в слот всегда попадает один и тот же финал');

    // ── Мера близости: тип товара важнее платформы ──────────
    // Настоящий случай из корпуса Дениса: на «PS5 Pro» побеждал эталон про ДИСК
    // (совпало слово ps5), а четыре объявления про приставки с комплектом —
    // Xbox Series X/S и две про Пс4 — получали ноль. Слово ps5 стоит почти в
    // каждом его объявлении и потому не отличает одно от другого.
    const realish = await page.evaluate(() => {
      // Корпус как у Дениса: «ps5» стоит в большинстве объявлений и потому
      // ничего не отличает, а «консоль/приставка» — только в двух.
      state.refs = [
        { id: 1101, source: 'mine', category: 'phys', title: 'Новый диск (в пленке) Call Of Duty MW 3 PS5', desc: 'Диск запечатан, для ps5 и пс4. Забирай.' },
        { id: 1102, source: 'mine', category: 'phys', title: 'Зарядная станция геймпадов PS5 (новая, в коробке)', desc: 'Станция для геймпадов ps5, в коробке.' },
        { id: 1103, source: 'mine', category: 'phys', title: 'Xbox Series X + Game Pass Ultimate', desc: 'ПРИСТАВКА-ЯКОРЬ. Консоль Xbox Series X, два геймпада, коробка, чек, подписка в подарок.' },
        { id: 1104, source: 'mine', category: 'phys', title: 'Пс4 слим 1тб два геймпада, подписка на 420 игр', desc: 'Консоль PS4 слим, два геймпада, коробка, чек, подписка.' },
        { id: 1105, source: 'mine', category: 'phys', title: 'Диски новые (MW3, MK1, Re4) пс4, пс5', desc: 'Новые диски для ps5, запечатаны.' },
        { id: 1106, source: 'mine', category: 'phys', title: 'Призрак цусимы ps4 (диск)', desc: 'Диск, идёт и на ps5.' },
      ];
      state.favorites = []; save();
      // Форма заполнена как у человека: не только название, но и комплектация
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro',
        physKit: ['коробка', 'чек', 'два геймпада'], physState: 'отличное' };
      const q = fewShotQuery(f);
      const idf = fewShotIdf(fewShotSamples('phys').all);
      const toks = [...new Set(fewShotTokens(q))];
      const scored = fewShotSamples('phys').list
        .map(s => ({ t: s.title, sc: fewShotScore(s, toks, idf) }))
        .sort((a, b) => b.sc - a.sc);
      return {
        q,
        top: scored[0].t,
        idfPs5: +idf('ps5').toFixed(3),
        idfKonsol: +idf('консол').toFixed(3),
        blocks: Array.from({ length: 5 }, () => fewShotBlock(f)),
      };
    });
    t.ok('в запрос идёт не только название товара', /геймпад/.test(realish.q), realish.q);
    t.ok('частое слово «ps5» весит меньше редкого «консоль»', realish.idfPs5 < realish.idfKonsol,
      `ps5=${realish.idfPs5}, консоль=${realish.idfKonsol}`);
    t.eq('якорем становится приставка, а не диск с игрой', realish.top, 'Xbox Series X + Game Pass Ultimate');
    t.ok('и она попадает в промпт в каждом прогоне',
      realish.blocks.every(b => b.includes('ПРИСТАВКА-ЯКОРЬ')), 'в каком-то прогоне якоря не было');

    // ── Блок настоящих заголовков ───────────────────────────
    const titles = await page.evaluate(() => {
      state.refs = Array.from({ length: 20 }, (_, i) => ({
        id: 800 + i, source: 'mine', category: 'phys', title: 'Заголовок номер ' + i, desc: 'текст ' + i,
      }));
      state.refs.push({ id: 899, source: 'mine', category: 'phys', title: 'Заголовок номер 0', desc: 'дубль названия' });
      state.favorites = []; save();
      const f = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      const b = titleSamplesBlock(f);
      const listed = (b.match(/^- .+ \(\d+\)$/gm) || []);
      return {
        block: b, n: listed.length,
        uniq: new Set(listed).size,
        inMsg: buildMsg(3, [], f).includes('Твои НАСТОЯЩИЕ заголовки'),
        inTitles: buildTitlesMsg(5).includes('Твои НАСТОЯЩИЕ заголовки'),
      };
    });
    t.eq('заголовков в блоке не больше потолка', titles.n, 12);
    t.eq('дубли названий схлопнуты', titles.uniq, titles.n);
    t.ok('у каждого показана длина', /\(1[0-9]\)/.test(titles.block), titles.block.slice(0, 200));
    t.ok('есть запрет копировать дословно', titles.block.includes('НЕ копируй их дословно'), titles.block.slice(-200));
    t.ok('блок заголовков уходит в обычную генерацию', titles.inMsg);
    t.ok('и в воронку «сначала заголовки»', titles.inTitles);

    // Своих заголовков в этой категории нет — берутся из другой, но с пометкой
    const crossTitles = await page.evaluate(() => {
      state.refs = [{ id: 901, source: 'mine', category: 'game', title: 'RDR2 пс4 дёшево', desc: 'текст' }];
      save();
      return titleSamplesBlock({ ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' });
    });
    t.ok('заголовки из другой категории подхватываются', crossTitles.includes('RDR2 пс4 дёшево'), crossTitles);
    t.ok('и помечены как чужая категория', crossTitles.includes('из другой категории товара'), crossTitles);

    // ── Предпросмотр «что уходит в промпт» ──────────────────
    // Гарантия, которую просил Денис: не обещание, что сырьё используется, а
    // возможность увидеть точный блок глазами.
    const preview = await page.evaluate(async () => {
      state.refs = [{ id: 1001, source: 'mine', category: 'phys', title: 'Видимый эталон', desc: 'ВИДИМЫЙ ТЕКСТ образца.' }];
      state.form = { ...DEF_FORM, category: 'phys', physName: 'PS5 Pro' };
      save();
      state.tab = 'database'; render();
      document.querySelector('[data-act="ref-preview"]')?.click();
      await new Promise(r => setTimeout(r, 50));
      const ov = document.getElementById('learned-overlay');
      const text = ov?.querySelector('pre')?.textContent || '';
      const title = ov?.querySelector('.card-title')?.textContent || '';
      document.querySelector('[data-act="learned-close"]')?.click();
      return { text, title, closed: !document.getElementById('learned-overlay') };
    });
    t.ok('кнопка показывает блок, который уходит в промпт', preview.text.includes('ВИДИМЫЙ ТЕКСТ образца'), preview.text.slice(0, 200));
    t.ok('и называет товар, по которому он собран', preview.title.includes('PS5 Pro'), preview.title);
    t.ok('закрывается', preview.closed);

    // Диагностика упавшего чанка пишется в консоль намеренно (как у пакетной
    // генерации) — её же и вызвал тест устойчивости выше
    const unexpected = consoleErrors.filter(e => !/Разбор приёмов: чанк не удался/.test(e));
    t.ok('консоль чистая', unexpected.length === 0, unexpected.join('\n'));
  } finally {
    await ctx.close();
  }
}
