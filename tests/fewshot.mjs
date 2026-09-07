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

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
