// Проба «Товара в интерьере» на image-моделях OpenRouter. Секретов в файле нет.
// Запуск НА СЕРВЕРЕ, где ключ уже в окружении (в вывод и в файлы он не попадает):
//   node tests/image-model-test.mjs <фото.jpg> [id модели ...]
// Необязательно, через окружение: PRODUCT="Наушники Sony WH-1000XM5"  EXTRA="..."
//   SCENE="на письменном столе рядом с монитором..." (текст сцены, по умолчанию — «Игровой сетап»)
// Результаты — картинки в ./image-test-out/ (относительно текущего каталога).
//
// Маршруты (проба 23.11.2026): OpenAI-модели на chat/completions отвечают 404 — для них
// /api/v1/images, как у боевого /api/image (prompt, input_references, aspect_ratio, quality).
// Остальные (gemini) — chat/completions с modalities; ⚠ без параметра качества, поэтому
// их цена и время с GPT на quality=high НЕ сопоставимы.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENROUTER_AVITO_KEY || process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Нет ключа OpenRouter в окружении'); process.exit(1); }
const PHOTO = process.argv[2];
if (!PHOTO || !fs.existsSync(PHOTO)) { console.error('Первым аргументом — путь к фото'); process.exit(1); }
const OUT = path.resolve('image-test-out');
fs.mkdirSync(OUT, { recursive: true });

const MODELS = process.argv.length > 3 ? process.argv.slice(3) : ['openai/gpt-image-2.6-sunburst'];

const PRODUCT = process.env.PRODUCT ?? 'Xbox Series S с геймпадом';
const EXTRA = process.env.EXTRA ?? (process.env.PRODUCT ? '' : 'на телевизоре на заднем плане — заставка игры GTA VI.');
const SCENE = process.env.SCENE || 'в игровом уголке с приглушённым светом и мягкой цветной подсветкой на стене, вечер';

// CLEAN=1 — студийная сцена (белый/серый фон, кадр сверху): блок REALISM_CLEAN вместо комнатного.
// UNBOX=1 — сцена «Распаковка»: коробку и содержимое с фото сохранить.
const CLEAN = process.env.CLEAN === '1';
const UNBOX = process.env.UNBOX === '1';

const REALISM_ROOM = [
  '\nСНИМОК ДОЛЖЕН ВЫГЛЯДЕТЬ КАК ОБЫЧНОЕ ФОТО, А НЕ КАК КАРТИНКА ИЗ НЕЙРОСЕТИ:',
  '- Съёмка на смартфон в реальной комнате: естественный свет из окна или обычная комнатная лампа, живые тени и отражения',
  '- Аккуратная, чистая комната; слегка неровный ракурс, как при съёмке с рук',
  '- Обычная глубина резкости телефонной камеры, естественное зерно, без вылизанной резкости по всему кадру',
  '- НЕ надо: глянцевый рекламный рендер, 3D-графика, CGI, иллюстрация, цифровой арт, HDR-обработка, идеально симметричная композиция, «пластиковые» блики, вылизанные градиенты, светящиеся ореолы вокруг предмета, неестественно насыщенные цвета, контурная студийная подсветка',
  '- Товар и фон в одном освещении и в одной перспективе: предмет не должен выглядеть вклеенным в сцену',
].join('\n');
const REALISM_CLEAN = [
  '\nЭТО ЧЕСТНАЯ ПРЕДМЕТНАЯ СЪЁМКА, А НЕ КАРТИНКА ИЗ НЕЙРОСЕТИ:',
  '- Настоящая фотография предмета на фоне: обычный мягкий свет, одна естественная тень под товаром, реальная фактура поверхностей',
  '- Обычная детализация фотографии, естественное зерно, без вылизанной резкости по всему кадру',
  '- НЕ надо: 3D-рендер, CGI, иллюстрация, цифровой арт, HDR-обработка, «пластиковые» блики, светящиеся ореолы, контурная подсветка, неестественно насыщенные цвета, идеально ровные градиенты фона',
  '- Товар и фон в одном освещении: предмет не должен выглядеть вклеенным',
].join('\n');

// ⚠ КОПИЯ stagedPrompt() (одиночный кадр, без второй картинки) + REALISM_* из
// avito-helper.html, 23.11.2026. Правишь промпт там — правь и здесь.
// «Доделать в финал» и серию скрипт НЕ воспроизводит — их проверяют тесты nov03/series.
const PROMPT = [
  `Возьми товар с приложенного фото и покажи его ${SCENE}.`,
  PRODUCT ? `На фото: ${PRODUCT}. Это подсказка — все детали бери с фото, а не из этого текста.` : '',
  EXTRA ? `Дополнительно: ${EXTRA}` : '',
  '',
  'ОБЯЗАТЕЛЬНО:',
  UNBOX
    ? '- С фото товара бери сам товар, коробку и всё её содержимое, что есть на фото, — их сохрани. Фон, комнату, мебель и пол с этого фото НЕ переносить.'
    : '- С фото товара бери только сам товар. Фон, комнату, мебель, пол и посторонние предметы с этого фото НЕ переносить.',
  '- Ракурс и обстановку фото товара не повторяй — сцену построй заново.',
  '- Сам товар перенеси с фото БЕЗ изменений: та же модель, цвет, надписи, разъёмы, состояние, потёртости. Ничего не «улучшай» и не заменяй похожим.',
  '- Комплектацию не добавляй: если на фото нет коробки, кабеля или второго геймпада — их не должно быть и на картинке.',
  '- Пропорции товара сохрани, товар — главный объект кадра.',
  '- Никаких водяных знаков, логотипов магазинов, ценников, рамок и подписей поверх кадра.',
  '- Надписи на самом товаре и его упаковке оставь как на фото, на любом языке: не переводи, не стирай, не переписывай.',
  '- Новые надписи в сцене (экран, постер) — только латиницей, без русского текста и кириллицы. Выдуманных брендов, логотипов и лишнего текста на предметах вокруг не добавляй.',
  CLEAN ? REALISM_CLEAN : REALISM_ROOM,
].filter(Boolean).join('\n');

const photoUrl = 'data:image/jpeg;base64,' + fs.readFileSync(PHOTO).toString('base64');
const tag = path.basename(PHOTO).replace(/\.\w+$/, '');

async function viaImages(model) {
  const r = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt: PROMPT,
      input_references: [{ type: 'image_url', image_url: { url: photoUrl } }],
      aspect_ratio: '3:4', quality: 'high',
    }),
  });
  const j = await r.json().catch(() => ({ raw: 'не JSON' }));
  const d = j?.data?.[0];
  let b64 = d?.b64_json, ext = String(d?.media_type || 'image/png').split('/')[1];
  // Если вендор ответил ссылкой, а не base64 — скачать, а не считать «нет картинки»
  if (!b64 && d?.url) {
    const img = await fetch(d.url);
    if (img.ok) { b64 = Buffer.from(await img.arrayBuffer()).toString('base64'); ext = (img.headers.get('content-type') || 'image/png').split('/')[1].split(';')[0]; }
  }
  return { r, j, b64, ext };
}

async function viaChat(model) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, modalities: ['image', 'text'], image_config: { aspect_ratio: '3:4' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: photoUrl } },
      ] }],
    }),
  });
  const j = await r.json().catch(() => ({ raw: 'не JSON' }));
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(j?.choices?.[0]?.message?.images?.[0]?.image_url?.url || '');
  return { r, j, b64: m?.[2], ext: m?.[1] };
}

for (const model of MODELS) {
  const t0 = Date.now();
  try {
    const { r, j, b64, ext } = await (model.startsWith('openai/') ? viaImages(model) : viaChat(model));
    if (!r.ok || !b64) {
      const d0 = j?.data?.[0];
      console.log(model, '— нет картинки:', r.status, 'ключи ответа:', Object.keys(j || {}).join(','), d0 ? '/ data[0]: ' + Object.keys(d0).join(',') : '', JSON.stringify(j).slice(0, 300));
      continue;
    }
    const file = path.join(OUT, `${tag}__${model.replace(/\W+/g, '_')}.${ext || 'png'}`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const cost = j?.usage?.cost;
    console.log(model, '— ок,', Math.round((Date.now() - t0) / 1000) + ' с,', cost != null ? '$' + cost : 'стоимость в ответе не пришла', '→', file);
  } catch (e) {
    console.log(model, '— ошибка:', e.message);
  }
}
