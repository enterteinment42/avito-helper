// Проба сцены «Игровой сетап» на разных image-моделях OpenRouter. Секретов в файле нет.
// Запуск НА СЕРВЕРЕ, где ключ уже в окружении (в вывод и в файлы он не попадает):
//   node tests/image-model-test.mjs <фото.jpg> [id модели ...]
// Результаты — картинки в ./image-test-out/ (относительно текущего каталога).
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.OPENROUTER_AVITO_KEY || process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Нет ключа OpenRouter в окружении'); process.exit(1); }
const PHOTO = process.argv[2];
if (!PHOTO || !fs.existsSync(PHOTO)) { console.error('Первым аргументом — путь к фото'); process.exit(1); }
const OUT = path.resolve('image-test-out');
fs.mkdirSync(OUT, { recursive: true });

const MODELS = process.argv.length > 3 ? process.argv.slice(3) : [
  'openai/gpt-image-2.5-sunburst', // эталон — то, что стоит на сервере
  'openai/gpt-image-2.6-sunburst',
  'google/gemini-nano-banana-2.1',
];

// Промпт — как stagedPrompt() в avito-helper.html: сцена «setup» + REALISM_ROOM
const PROMPT = [
  'Возьми товар с приложенного фото и покажи его в игровом уголке с приглушённым светом и мягкой цветной подсветкой на стене, вечер.',
  'На фото: Xbox Series S с геймпадом. Это подсказка — все детали бери с фото, а не из этого текста.',
  'Дополнительно: на телевизоре на заднем плане — заставка игры GTA VI.',
  '',
  'ОБЯЗАТЕЛЬНО:',
  '- Сам товар перенеси с фото БЕЗ изменений: та же модель, цвет, надписи, разъёмы, состояние, потёртости. Ничего не «улучшай» и не заменяй похожим.',
  '- Комплектацию не добавляй: если на фото нет коробки, кабеля или второго геймпада — их не должно быть и на картинке.',
  '- Пропорции товара сохрани, товар — главный объект кадра.',
  '- Никаких надписей, водяных знаков, логотипов магазинов, ценников и рамок.',
  '',
  'СНИМОК ДОЛЖЕН ВЫГЛЯДЕТЬ КАК ОБЫЧНОЕ ФОТО, А НЕ КАК КАРТИНКА ИЗ НЕЙРОСЕТИ:',
  '- Съёмка на смартфон в реальной комнате: естественный свет из окна или обычная комнатная лампа, живые тени и отражения',
  '- Допустимы бытовые мелочи: лёгкая пыль, неидеальный порядок вокруг, случайные предметы на заднем плане, слегка неровный ракурс',
  '- Обычная глубина резкости телефонной камеры, естественное зерно, без вылизанной резкости по всему кадру',
  '- НЕ надо: глянцевый рекламный рендер, 3D-графика, CGI, иллюстрация, цифровой арт, HDR-обработка, идеально симметричная композиция, «пластиковые» блики, вылизанные градиенты, светящиеся ореолы вокруг предмета, неестественно насыщенные цвета, контурная студийная подсветка',
  '- Товар и фон в одном освещении и в одной перспективе: предмет не должен выглядеть вклеенным в сцену',
].join('\n');

const photoUrl = 'data:image/jpeg;base64,' + fs.readFileSync(PHOTO).toString('base64');

for (const model of MODELS) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '3:4' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: photoUrl } },
        ] }],
      }),
    });
    const j = await r.json();
    const img = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!r.ok || !img) { console.log(model, '— нет картинки:', r.status, JSON.stringify(j).slice(0, 300)); continue; }
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(img);
    const file = path.join(OUT, model.replace(/\W+/g, '_') + '.' + (m ? m[1] : 'png'));
    fs.writeFileSync(file, Buffer.from(m ? m[2] : img, 'base64'));
    const cost = j?.usage?.cost;
    console.log(model, '— ок,', Math.round((Date.now() - t0) / 1000) + ' с,', cost != null ? '$' + cost : '', '→', file);
  } catch (e) {
    console.log(model, '— ошибка:', e.message);
  }
}
