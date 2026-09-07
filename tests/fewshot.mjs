// Образцы языка продавца в промпте: избранное + свои эталоны, переток между
// категориями с пометкой, крючки заголовков физтовара.
import { openApp } from './lib.mjs';

const seed = (page, { favorites = [], refs = [] }) => page.evaluate(([f, r]) => {
  state.favorites = f; state.refs = r; save();
}, [favorites, refs]);

const block = (page, cat) => page.evaluate(c => {
  Math.random = () => 0.42;
  return fewShotBlock(c);
}, cat);

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
    t.ok('и не берётся чужой', !ownBlock.includes('Doom'), ownBlock);
    t.ok('формулировка прежняя', ownBlock.includes('Примеры твоих же удачных объявлений этой категории'), ownBlock);

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
    t.ok('эталон без названия выводится описанием', /1\. Только описание\./.test(noTitle), noTitle);
    t.ok('и без пустых кавычек', !noTitle.includes('«»'), noTitle);

    // Избранное и эталоны смешиваются
    await seed(page, { favorites: [FAV_PHYS], refs: [{ id: 4, source: 'mine', category: 'phys', title: 'Из рук', desc: 'Второй образец.' }] });
    const mixed = await block(page, 'phys');
    t.eq('в блок идут максимум два примера', (mixed.match(/^\d\. /gm) || []).length, 2, mixed);

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
      block: fewShotBlock('phys') + refTricksBlock('phys'),
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
      full: learnedBlock('phys'),
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

    // Диагностика упавшего чанка пишется в консоль намеренно (как у пакетной
    // генерации) — её же и вызвал тест устойчивости выше
    const unexpected = consoleErrors.filter(e => !/Разбор приёмов: чанк не удался/.test(e));
    t.ok('консоль чистая', unexpected.length === 0, unexpected.join('\n'));
  } finally {
    await ctx.close();
  }
}
