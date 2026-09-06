// Уточняющие чипы: модель сообщает, где по фото различить невозможно, человек
// выбирает сам. Порог узкий сознательно — урок из скоринга обложек магазина:
// метка по факту, а не по ощущению, иначе она превращается в шум.
import { openApp } from './lib.mjs';

// Ответ распознавания с блоком uncertain
const reply = (uncertain, fields = {}) => ({
  recognized: 'Игровая консоль PlayStation 5, вид сбоку',
  confidence: 'medium', category: 'phys',
  fields: { physName: 'PlayStation 5', physState: 'Хорошее', ...fields },
  uncertain, notes: '', priceQuery: 'PS5 бу цена',
});

// Прогоняем настоящий doVisionRecognize со стабом на границе callAI
const recognize = (page, r) => page.evaluate(async json => {
  window.__jlog = [];
  const origJ = window.jlog;
  window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
  window.callAI = async () => JSON.stringify(json);
  state.form = JSON.parse(JSON.stringify(DEF_FORM));
  state.vision.media = { media_type: 'image/jpeg', data: 'AAAA' };
  state.vision.dataUrl = 'data:image/jpeg;base64,AAAA';
  await doVisionRecognize();
  return {
    uncertain: state.vision.uncertain,
    form: { name: state.form.physName, state: state.form.physState, kit: state.form.physKit },
    logged: window.__jlog.filter(x => x.ev === 'vision_uncertain').map(x => x.data),
  };
}, r);

export async function runUncertain(browser, base, t) {
  t.section('uncertain — уточняющие чипы распознавания');
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`);
  try {
    // ── Загрузка фото настоящим input[type=file] ────────────
    // Регресс: функция выбора файла называется visionPick, и одноимённая
    // функция выбора варианта молча её перезаписала — фото перестало грузиться.
    // Стенд этого не поймал, потому что нигде не грузил файл по-настоящему.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    await page.setInputFiles('#vision-file', { name: 'ps5.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => !!state.vision.dataUrl || !!state.vision.error, null, { timeout: 5000 })
      .catch(() => {});
    const loaded = await page.evaluate(() => ({
      hasUrl: !!state.vision.dataUrl,
      hasMedia: !!(state.vision.media && state.vision.media.data),
      err: state.vision.error,
      btn: !document.querySelector('[data-act="vision-recognize"]')?.disabled,
    }));
    t.ok('фото загрузилось через выбор файла', loaded.hasUrl, 'ошибка: ' + loaded.err);
    t.ok('и подготовлено для отправки в модель', loaded.hasMedia);
    t.ok('кнопка «Распознать» стала активной', loaded.btn);
    await page.evaluate(() => visionClear());

    // ── Промпт ──────────────────────────────────────────────
    const vs = await page.evaluate(() => visionSys());
    t.ok('схема ответа содержит uncertain', /"uncertain": \[\{ "field"/.test(vs));
    t.ok('порог узкий: только физически неразличимое', /РАЗЛИЧИТЬ ФИЗИЧЕСКИ НЕВОЗМОЖНО/.test(vs));
    t.ok('признак виден — вариантов не давать', /Если признак ВИДЕН — вариантов не давай вообще/.test(vs));
    t.ok('запрещены варианты «на всякий случай»', /Сомнение в принципе — не повод/.test(vs));
    t.ok('в why требуется причина, а не «возможны варианты»', /ЧЕГО не хватает на фото/.test(vs));

    // ── Нормальный случай ───────────────────────────────────
    const ok = await recognize(page, reply([
      { field: 'physName', options: ['PlayStation 5 Pro', 'PlayStation 5 Slim'], why: 'панель в тени' },
    ]));
    t.eq('неоднозначность разобрана', ok.uncertain.length, 1);
    t.eq('подпись поля подставлена из дескриптора', ok.uncertain[0].label, 'Что продаём');
    t.eq('причина сохранена', ok.uncertain[0].why, 'панель в тени');
    t.eq('в форму пока попало значение из fields', ok.form.name, 'PlayStation 5');
    t.eq('событие журнала записано', ok.logged.length, 1);
    t.eq('и содержит варианты', ok.logged[0].items[0].options.join(','), 'PlayStation 5 Pro,PlayStation 5 Slim');

    // Чипы отрисованы
    const ui = await page.evaluate(() => {
      const html = formHTML();
      return {
        block: html.includes('По фото не отличить'),
        chips: (html.match(/data-act="vision-pick"/g) || []).length,
        why: html.includes('панель в тени'),
      };
    });
    t.ok('блок выбора отрисован', ui.block);
    t.eq('чипов ровно по числу вариантов', ui.chips, 2);
    t.ok('причина показана человеку', ui.why);

    // ── Выбор человека ──────────────────────────────────────
    const picked = await page.evaluate(() => {
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      // Второй вариант — то есть человек НЕ согласился с догадкой модели
      visionPickOption('physName', 'PlayStation 5 Slim');
      const log = window.__jlog.find(x => x.ev === 'vision_pick');
      // Первый вариант — согласие с моделью
      window.__jlog = [];
      visionPickOption('physName', 'PlayStation 5 Pro');
      const agree = window.__jlog.find(x => x.ev === 'vision_pick');
      return {
        form: state.form.physName, pick: state.vision.picks.physName,
        marked: formHTML().includes('class="chip on" data-act="vision-pick" data-k="physName" data-val="PlayStation 5 Pro"'),
        changed: log?.data.changed, suggested: log?.data.suggested, picked: log?.data.picked,
        agreeChanged: agree?.data.changed,
      };
    });
    t.eq('выбор подставлен в форму', picked.form, 'PlayStation 5 Pro');
    t.eq('и запомнен как решённый вопрос', picked.pick, 'PlayStation 5 Pro');
    t.ok('чип отмечен выбранным', picked.marked);
    t.eq('журнал знает, что человек поправил модель', picked.changed, true);
    t.eq('и что согласился, когда выбрал предложенное', picked.agreeChanged, false);
    t.eq('и что именно предлагалось первым', picked.suggested, 'PlayStation 5 Pro');
    t.eq('и что выбрано', picked.picked, 'PlayStation 5 Slim');

    // Чужое значение через подставленный data-val не пройдёт
    const forged = await page.evaluate(() => {
      visionPickOption('physName', 'PlayStation 6 Ultra');
      return state.form.physName;
    });
    t.eq('вариант не из списка игнорируется', forged, 'PlayStation 5 Pro');

    // ── Отсев шума (главное) ────────────────────────────────
    const noise = await page.evaluate(async () => {
      const run = async u => {
        window.callAI = async () => JSON.stringify({
          recognized: 'x', confidence: 'medium', category: 'phys',
          fields: { physName: 'PlayStation 5' }, uncertain: u, notes: '', priceQuery: '',
        });
        state.form = JSON.parse(JSON.stringify(DEF_FORM));
        state.vision.media = { media_type: 'image/jpeg', data: 'AAAA' };
        await doVisionRecognize();
        return state.vision.uncertain;
      };
      return {
        single: await run([{ field: 'physName', options: ['PS5'], why: 'x' }]),
        unknown: await run([{ field: 'нет_такого_поля', options: ['a', 'b'], why: 'x' }]),
        price: await run([{ field: 'physPrice', options: ['1000', '2000'], why: 'x' }]),
        badOpts: await run([{ field: 'physState', options: ['Отличное', 'Космическое'], why: 'x' }]),
        allBad: await run([{ field: 'physState', options: ['Космическое', 'Небывалое'], why: 'x' }]),
        many: await run([
          { field: 'physName', options: ['a', 'b'], why: '1' },
          { field: 'physState', options: ['Новое', 'Б/у с дефектами'], why: '2' },
          { field: 'physDefects', options: ['c', 'd'], why: '3' },
        ]),
        tooMany: await run([{ field: 'physName', options: ['a', 'b', 'c', 'd', 'e', 'f'], why: 'x' }]),
        empty: await run([]),
        garbage: await run('не массив'),
      };
    });
    t.eq('единственный вариант — не выбор', noise.single.length, 0);
    t.eq('неизвестное поле отброшено', noise.unknown.length, 0);
    t.eq('поле цены не спрашивается', noise.price.length, 0);
    // «Космическое» нет в списке состояний → остаётся один вариант → вопрос снят
    t.eq('вариант не из списка опций вычищен, вопрос снят', noise.badOpts.length, 0, JSON.stringify(noise.badOpts));
    t.eq('все варианты мимо списка — вопроса нет', noise.allBad.length, 0);
    t.eq('больше двух полей не показываем', noise.many.length, 2);
    t.eq('вариантов не больше четырёх', noise.tooMany[0].options.length, 4);
    t.eq('пустой блок ничего не рисует', noise.empty.length, 0);
    t.eq('мусор вместо массива не роняет разбор', noise.garbage.length, 0);

    // ── Откат формы убирает и вопросы ───────────────────────
    const undone = await page.evaluate(async () => {
      window.callAI = async () => JSON.stringify({
        recognized: 'x', confidence: 'medium', category: 'phys',
        fields: { physName: 'PlayStation 5' },
        uncertain: [{ field: 'physName', options: ['PS5 Pro', 'PS5 Slim'], why: 'тень' }],
        notes: '', priceQuery: '',
      });
      state.form = JSON.parse(JSON.stringify(DEF_FORM));
      state.vision.media = { media_type: 'image/jpeg', data: 'AAAA' };
      await doVisionRecognize();
      visionPickOption('physName', 'PS5 Pro');
      visionUndoForm();
      return { shown: formHTML().includes('По фото не отличить'), picks: Object.keys(state.vision.picks).length };
    });
    t.eq('после «Вернуть форму» чипы скрыты', undone.shown, false);
    t.eq('и выбор сброшен', undone.picks, 0);

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
