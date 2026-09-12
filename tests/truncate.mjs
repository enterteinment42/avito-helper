// Обрыв ответа модели. Живой дефект 12.09: генерация падала на
// «Expected ',' or ']' after array element in JSON at position …» — модель не
// укладывалась в фиксированные max_tokens: 4000, extractJSON срезал недописанный
// хвост по последней «}», и наружу выходила ошибка разбора вместо причины.
// Здесь проверяется всё лечение: бюджет выхода от числа вариантов, распознавание
// stop_reason и спасение целых вариантов из недописанного JSON.
import { openApp } from './lib.mjs';

// В описаниях намеренно есть «{», «}», экранированные кавычки и обратный слэш:
// спасательный сканер идёт по строке вручную, и скобка ВНУТРИ строки не должна
// сойти за границу объекта.
const FULL = {
  variants: [
    { id: 1, title: 'Первый', description: 'Цена {от 1000} за "12 мес" \\ PS4 PS5', style: 'деловой' },
    { id: 2, title: 'Второй', description: 'Список: {GTA5} и "Хогвартс" PS4 PS5', style: 'дерзкий' },
    { id: 3, title: 'Третий', description: 'Финал {итог} — "выгодно" PS4 PS5', style: 'восторженный' },
  ],
};

export async function runTruncate(browser, base, t) {
  t.section('truncate — обрыв ответа модели');
  // Токен кладём заранее: callAI зовёт getProxyToken(), а тот при пустом
  // хранилище открывает prompt() и подвесил бы прогон.
  const { ctx, page, consoleErrors } = await openApp(browser, `${base}/avito-helper.html`, {
    storage: { avito_admin_token: 'test-token' },
  });
  try {
    // Дальше callAI не раз подменяется стабом — держим настоящий под рукой,
    // чтобы проверки его собственного поведения не поймали чужую заглушку.
    await page.evaluate(() => { window.__origCallAI = window.callAI; });

    const pretty = JSON.stringify(FULL, null, 2);
    const payload = {
      full: pretty,
      // Обрыв посреди второго варианта → цел только первый (это и был случай
      // «line 12 column 6» из консоли Дениса).
      after1: pretty.slice(0, pretty.indexOf('"Второй"') + 5),
      // Обрыв посреди третьего → целы два («line 22 column 6»).
      after2: pretty.slice(0, pretty.indexOf('"Третий"') + 5),
      // Обрыв до конца первого варианта → спасать нечего.
      early: pretty.slice(0, pretty.indexOf('"Первый"')),
      // Тот же обрыв, но модель успела открыть markdown-обёртку.
      fenced: '```json\n' + pretty.slice(0, pretty.indexOf('"Третий"') + 5),
      d1: FULL.variants[0].description,
    };

    // ── Бюджет выхода ───────────────────────────────────────
    const gt = await page.evaluate(() => ({
      one: genTokens(1), three: genTokens(3), five: genTokens(5),
      def: genTokens(undefined), str: genTokens('4'), junk: genTokens(null),
    }));
    t.eq('бюджет на 3 варианта больше прежних фиксированных 4000', gt.three, 5800);
    t.eq('на 1 вариант', gt.one, 2600);
    t.eq('на 5 вариантов упирается в потолок 8000', gt.five, 8000);
    t.eq('без аргумента считает как за 3', gt.def, 5800);
    t.eq('строка приводится к числу', gt.str, 7400);
    t.eq('мусор не даёт NaN', gt.junk, 5800);

    // ── Спасение вариантов ──────────────────────────────────
    const s = await page.evaluate(p => {
      const tryParse = txt => {
        try {
          const l = parseVariants(txt);
          return { n: l.length, salv: !!l._salvaged, ids: l.map(v => v.id), titles: l.map(v => v.title), d0: l[0]?.description };
        } catch (e) { return { err: e.message }; }
      };
      return {
        salvFull: salvageVariants(p.full).length,
        salv1: salvageVariants(p.after1).length,
        salv2: salvageVariants(p.after2).length,
        salv0: salvageVariants(p.early).length,
        salvFenced: salvageVariants(p.fenced).length,
        salvJunk: salvageVariants('совсем не json').length,
        pFull: tryParse(p.full),
        p1: tryParse(p.after1),
        p2: tryParse(p.after2),
        p0: tryParse(p.early),
      };
    }, payload);

    t.eq('из целого ответа сканер достаёт все варианты', s.salvFull, 3);
    t.eq('обрыв во втором варианте — спасён первый', s.salv1, 1);
    t.eq('обрыв в третьем — спасены два', s.salv2, 2);
    t.eq('обрыв до первого целого — спасать нечего', s.salv0, 0);
    t.eq('markdown-обёртка не мешает', s.salvFenced, 2);
    t.eq('на мусоре сканер не падает и не выдумывает', s.salvJunk, 0);

    t.eq('целый ответ разбирается строгим путём', s.pFull.n, 3);
    t.ok('и НЕ помечается спасённым', s.pFull.salv === false);
    t.eq('оборванный ответ отдаёт то, что успело прийти', s.p1.n, 1);
    t.ok('и помечен спасённым', s.p1.salv === true);
    t.eq('спасённые нумеруются с 1', JSON.stringify(s.p2.ids), '[1,2]');
    t.eq('порядок вариантов сохранён', JSON.stringify(s.p2.titles), '["Первый","Второй"]');
    // Главная проверка сканера строк: скобка и кавычки внутри описания
    // не должны обрезать объект раньше времени.
    t.eq('описание со скобками и кавычками восстановлено точно', s.p1.d0, payload.d1);
    t.ok('когда спасать нечего — понятная ошибка, а не про JSON',
      /оборван/i.test(s.p0.err || '') && !/position/i.test(s.p0.err || ''), 'получено: ' + s.p0.err);

    // ── stop_reason в callAI ────────────────────────────────
    const stop = await page.evaluate(async () => {
      const mk = body => async () => ({ ok: true, status: 200, json: async () => body });
      const out = {};
      // Claude: обрыв по лимиту приходит обычным 200
      window.fetch = mk({ content: [{ type: 'text', text: '{"variants":[' }], stop_reason: 'max_tokens' });
      let flagged = false;
      out.text = await callAI([{ role: 'user', content: 'x' }], { onTruncated: () => { flagged = true; } });
      out.flagged = flagged;
      // Нормальное завершение колбэк не дёргает
      window.fetch = mk({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
      let flagged2 = false;
      await callAI([{ role: 'user', content: 'x' }], { onTruncated: () => { flagged2 = true; } });
      out.flagged2 = flagged2;
      // Обрыв, при котором текста нет вовсе — работать не с чем, это ошибка
      window.fetch = mk({ content: [{ type: 'text', text: '   ' }], stop_reason: 'max_tokens' });
      try { await callAI([{ role: 'user', content: 'x' }], {}); out.emptyErr = ''; }
      catch (e) { out.emptyErr = e.message; }
      // OpenRouter зовёт тот же обрыв иначе
      state.settings.provider = 'openrouter';
      window.fetch = mk({ choices: [{ message: { content: 'часть' }, finish_reason: 'length' }] });
      let flagged3 = false;
      out.orText = await callAI([{ role: 'user', content: 'x' }], { onTruncated: () => { flagged3 = true; } });
      out.flagged3 = flagged3;
      state.settings.provider = 'claude';
      return out;
    });
    t.ok('Claude: обрыв по лимиту распознан', stop.flagged);
    t.eq('и недописанный текст всё равно отдан наружу', stop.text, '{"variants":[');
    t.ok('нормальный ответ обрывом не считается', stop.flagged2 === false);
    t.ok('обрыв с пустым текстом — понятная ошибка про лимит',
      /лимит/i.test(stop.emptyErr || ''), 'получено: ' + stop.emptyErr);
    t.ok('OpenRouter: finish_reason=length распознан', stop.flagged3);
    t.eq('и текст отдан', stop.orText, 'часть');

    // ── Сквозь настоящий doGenerate ─────────────────────────
    const gen = await page.evaluate(async p => {
      window.__toasts = []; window.__jlog = []; window.__opts = null;
      const origToast = window.toast, origJ = window.jlog;
      window.toast = m => { window.__toasts.push(String(m)); };
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      window.callAI = async (messages, opts = {}) => {
        window.__opts = opts;
        opts.onTruncated?.('max_tokens'); // как настоящий callAI при stop_reason
        return p.after2;
      };
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      const r = {
        n: state.results.length,
        err: state.error,
        loading: state.loading,
        maxTokens: window.__opts?.max_tokens,
        toasts: window.__toasts.slice(),
        stamped: state.results.every(v => v._category === 'game' && !!v._scan && !!v._chain),
        logged: window.__jlog.find(x => x.ev === 'generated')?.data || null,
      };
      window.toast = origToast; window.jlog = origJ;
      return r;
    }, payload);

    t.eq('оборванная генерация даёт спасённые варианты, а не пустоту', gen.n, 2);
    t.ok('ошибка наружу не выставлена', !gen.err, 'ошибка: ' + gen.err);
    t.ok('спиннер снят', gen.loading === false);
    t.eq('запрошен бюджет по числу вариантов', gen.maxTokens, 5800);
    t.ok('продавца предупредили, что набор неполный',
      gen.toasts.some(m => /оборвал/i.test(m) && /2 из 3/.test(m)), 'тосты: ' + JSON.stringify(gen.toasts));
    t.ok('спасённые варианты проштампованы как обычные', gen.stamped);
    t.ok('обрыв виден в журнале', gen.logged?.truncated === true);
    t.eq('и варианты в журнал попали', gen.logged?.variants?.length, 2);

    // Полный ответ предупреждения не даёт — иначе тост превратится в шум
    const clean = await page.evaluate(async p => {
      window.__toasts = [];
      const origToast = window.toast;
      window.toast = m => { window.__toasts.push(String(m)); };
      window.callAI = async () => p.full;
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      const r = { n: state.results.length, toasts: window.__toasts.slice() };
      window.toast = origToast;
      return r;
    }, payload);
    t.eq('целый ответ разобран полностью', clean.n, 3);
    t.ok('и молча — без предупреждения об обрыве',
      !clean.toasts.some(m => /оборвал/i.test(m)), 'тосты: ' + JSON.stringify(clean.toasts));

    // ── Находки код-ревью этой же правки ────────────────────
    // 1. Полный набор, но строгий разбор не прошёл: модель дописала прозу с «}»,
    // и extractJSON захватил её (документированное поведение при веб-поиске — F3).
    // Спасение вернёт все три варианта — предупреждать не о чем.
    const prose = await page.evaluate(async p => {
      window.__toasts = [];
      const origToast = window.toast;
      window.toast = m => { window.__toasts.push(String(m)); };
      window.callAI = async () => p.full + '\n\nГотово: набор {полный} — проверьте цены.}';
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));
      state.results = []; state.extraResults = [];
      await doGenerate();
      const r = { n: state.results.length, salv: !!state.results._salvaged, toasts: window.__toasts.slice() };
      window.toast = origToast;
      return r;
    }, payload);
    t.eq('проза после JSON: варианты всё равно все', prose.n, 3);
    t.ok('и продавца не пугают обрывом, которого не было',
      !prose.toasts.some(m => /оборвал/i.test(m)), 'тосты: ' + JSON.stringify(prose.toasts));

    // 2. Дыра в СЕРЕДИНЕ спасённого набора: воронка заголовков раскладывает
    // выбранные названия по порядку и приклеила бы название №2 к описанию №3.
    const hole = await page.evaluate(async () => {
      // Второй вариант испорчен неэкранированной кавычкой — целыми останутся 1 и 3
      const broken = '{"variants":[' +
        '{"id":1,"title":"м1","description":"описание один","style":"деловой"},' +
        '{"id":2,"title":"м2","description":"тут "кавычка" ломает","style":"дерзкий"},' +
        '{"id":3,"title":"м3","description":"описание три","style":"живой"}]}';
      const salv = salvageVariants(broken);
      window.__toasts = [];
      const origToast = window.toast;
      window.toast = m => { window.__toasts.push(String(m)); };
      window.callAI = async () => broken;
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'] }));
      state.titleStep = {
        titles: [
          { id: 1, title: 'ЗАГОЛОВОК-1', hook: 'a', len: 11 },
          { id: 2, title: 'ЗАГОЛОВОК-2', hook: 'b', len: 11 },
          { id: 3, title: 'ЗАГОЛОВОК-3', hook: 'c', len: 11 },
        ],
        selected: { 1: true, 2: true, 3: true },
        form: JSON.parse(JSON.stringify(state.form)), _chain: 'test',
      };
      state.results = [];
      await doGenDescriptionsForTitles();
      const r = {
        salvaged: salv.map(v => v.id),
        pairs: state.results.map(v => `${v.title}|${v.description}`),
        toasts: window.__toasts.slice(),
      };
      window.toast = origToast;
      return r;
    });
    t.eq('спасены первый и третий — дыра в середине', JSON.stringify(hole.salvaged), '[1,3]');
    t.eq('название приклеено к СВОЕМУ описанию, а не к соседнему',
      JSON.stringify(hole.pairs), JSON.stringify(['ЗАГОЛОВОК-1|описание один', 'ЗАГОЛОВОК-3|описание три']));
    t.ok('и про пропущенное название сказано', hole.toasts.some(m => /2 из 3/.test(m)), 'тосты: ' + JSON.stringify(hole.toasts));

    // 3. Количество, переключённое во время генерации, не должно подменять
    // число, с которым сравнивают полученное (кнопки счётчика не блокируются).
    const swap = await page.evaluate(async p => {
      window.__toasts = [];
      const origToast = window.toast;
      window.toast = m => { window.__toasts.push(String(m)); };
      window.callAI = async (messages, opts = {}) => {
        state.form.count = 5;            // человек переключил счётчик, пока шёл запрос
        opts.onTruncated?.('max_tokens');
        return p.after2;                 // пришло 2 варианта
      };
      state.form = JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));
      state.results = [];
      await doGenerate();
      const r = { toasts: window.__toasts.slice() };
      window.toast = origToast;
      return r;
    }, payload);
    t.ok('предупреждение считает по заказанному, а не по переключённому',
      swap.toasts.some(m => /2 из 3/.test(m)) && !swap.toasts.some(m => /2 из 5/.test(m)),
      'тосты: ' + JSON.stringify(swap.toasts));

    // 4. Совет «уменьшите число вариантов» уместен только там, где счётчик есть.
    const hint = await page.evaluate(async () => {
      window.callAI = window.__origCallAI; // прошлые блоки оставили после себя стаб
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '' }], stop_reason: 'max_tokens' }) });
      const grab = async opts => { try { await callAI([{ role: 'user', content: 'x' }], opts); return ''; } catch (e) { return e.message; } };
      return {
        plain: await grab({}),
        withHint: await grab({ truncHint: 'уменьшите число вариантов' }),
      };
    });
    t.ok('без подсказки текст общий — годится и для распознавания по фото',
      !/вариант/i.test(hint.plain) && /лимит/i.test(hint.plain), 'получено: ' + hint.plain);
    t.ok('в генерации подсказка про варианты остаётся', /уменьшите число вариантов/.test(hint.withHint), 'получено: ' + hint.withHint);

    // 5. Обрыв должен быть виден в журнале на ВСЕХ платных путях генерации,
    // иначе месячный разбор систематически недосчитает именно тот сигнал,
    // ради которого поле заводилось.
    const paths = await page.evaluate(async p => {
      window.__jlog = [];
      const origJ = window.jlog;
      window.jlog = (ev, chain, data) => { window.__jlog.push({ ev, data }); return origJ ? origJ(ev, chain, data) : undefined; };
      window.callAI = async (messages, opts = {}) => {
        opts.onTruncated?.('max_tokens');
        return window.__reply;
      };
      const form = () => JSON.parse(JSON.stringify({ ...DEF_FORM, category: 'game', gameName: 'Doom', gamePlatforms: ['PS5'], count: 3 }));

      window.__reply = p.full;
      state.form = form(); state.results = []; state.extraResults = [];
      await doGenerate();                       // main
      await doGenerateMore();                   // more
      const baseId = state.results[0].id;
      await doRegen(baseId);                    // regen

      state.form = form(); state.batchRegions = ['Москва', 'Питер'];
      await doBatchGenerate();                  // batch
      state.batchRegions = [];

      state.form = form(); state.results = []; state.extraResults = [];
      await doGenerate();                       // нужен набор, чтобы было к чему звать ↻×5
      window.__reply = JSON.stringify({ titles: [{ title: 'т1', hook: 'a' }] });
      await doGenAltTitles(state.results[0].id); // alt_titles

      window.__reply = p.full;
      state.titleStep = {
        titles: [{ id: 1, title: 'З1', hook: 'a', len: 2 }],
        selected: { 1: true }, form: form(), _chain: 'test',
      };
      await doGenDescriptionsForTitles();       // descriptions

      const found = {};
      for (const e of window.__jlog) {
        if (e.ev !== 'generated' && e.ev !== 'regen') continue;
        const key = e.ev === 'regen' ? 'regen' : e.data?.path;
        if (key) found[key] = !!e.data?.truncated;
      }
      window.jlog = origJ;
      return found;
    }, payload);
    for (const path of ['main', 'more', 'regen', 'batch', 'alt_titles', 'descriptions']) {
      t.ok(`обрыв попадает в журнал на пути «${path}»`, paths[path] === true,
        'получено: ' + JSON.stringify(paths));
    }

    t.ok('консоль чистая', consoleErrors.length === 0, consoleErrors.join('\n'));
  } finally {
    await ctx.close();
  }
}
