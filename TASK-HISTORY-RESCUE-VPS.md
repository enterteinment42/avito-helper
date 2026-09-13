# TASK: расследование пропажи записей Истории в avito-helper (ТОЛЬКО ЧТЕНИЕ)

**Дата постановки:** 2026-09-13
**Сервер:** VPS с `poigraem-api` (PM2), каталоги `~/avito-sync/`, `~/avito-journal/`
**Кто ставит задачу:** сессия Claude Code по репозиторию `avito-helper` (клиентская сторона)

---

## 0. ЖЕЛЕЗНЫЕ ПРАВИЛА — прочитать до первой команды

Данные в `~/avito-sync/` — это **невосполнимое сырьё владельца**: 155+ эталонов
объявлений и финальные тексты, отредактированные руками. Из них строится обучение
инструмента. Восстановить их неоткуда.

1. **Задача целиком читающая.** Запрещено: `POST` на `/api/avito-sync/*`,
   `rm`, `mv`, `truncate`, перенаправление `>` в любой файл внутри `~/avito-sync/`
   и `~/avito-journal/`, `pm2 restart`, правка `server.js`, `git checkout`/`pull`
   в `poigraem-backend`.
2. **Писать можно только в `~/avito-rescue/`** — рабочий каталог этой задачи.
   Скрипты класть в `~/` (`~/vcheck.js` и т.п.), они безобидны.
3. **Никаких «уборок»**. В прошлой задаче (`TASK-AVITO-SYNC-VPS.md`) блок
   «удалить тестовые документы после проверки» при повторном прогоне уничтожил бы
   живое сырьё. Ничего не удалять, даже файлы, выглядящие временными
   (`*.SAVED-*`, `*.bak`) — именно они сейчас могут оказаться единственной копией.
4. **Токены и ключи не печатать** ни в выводе, ни в отчёте. `ADMIN_TOKEN` брать
   только как `$(grep -m1 '^ADMIN_TOKEN=' ~/poigraem-backend/.env | cut -d= -f2-)`,
   и только если понадобится (в этой задаче, скорее всего, не понадобится вовсе).
5. **Выводы о клиентском поведении не делать.** Кода браузерного приложения
   (`avito-helper.html`) на сервере нет. Если появится гипотеза «клиент делает X» —
   записать её как вопрос в отчёт, а не как факт. В прошлый раз вывод о клиенте,
   сделанный по тексту задачи, оказался неверным и чуть не привёл к «починке»
   работающего кода.

---

## 1. Что произошло (факты со стороны клиента)

Во вкладке «🗂 История» инструмента у владельца отображается **2 записи с
донесённым финальным текстом**. По журналу самообучения их должно быть **5**:

| Когда (UTC) | Товар | Регион | Длина финала |
|---|---|---|---|
| 2026-09-10T14:09:50 | Claude Pro | Сыктывкар | 1599 |
| 2026-09-12T10:26:42 | Claude Pro | **Пермь** | 737 |
| 2026-09-12T13:16:38 | PS Plus Extra | Киров | 1247 |
| 2026-09-12T13:40:13 | Marvel's Wolverine | Сыктывкар | 1338 |
| 2026-09-13T01:23:29 | Marvel's Wolverine | **Саратов** | 1022 |

Локальный бэкап владельца, снятый **2026-09-12T13:49:51Z**, содержит только 3
записи — записи по **Перми** в нём уже нет, хотя её финал донесён за три часа до
бэкапа. То есть минимум одна пропажа случилась **до** правок клиента от 12-13.09,
и объяснять всё только ими нельзя.

Второй бэкап, снятый **2026-09-13T13:08:57Z**, содержит уже только 2 записи:

| Запись | бэкап 12.09 16:49 | бэкап 13.09 16:08 |
|---|---|---|
| Claude Pro / Сыктывкар (10.09) | есть, финал 1599 | **исчезла** |
| PS Plus Extra / Киров (12.09) | есть, финал 1247 | есть |
| Marvel's Wolverine / Сыктывкар (12.09) | есть, финал 1338 | **исчезла** |
| Marvel's Wolverine / Саратов (13.09) | — | есть, финал 1022 |

### Что известно о причине

- **Владелец работает с ОДНОГО устройства и одного браузера.** Версия «записи
  остались на втором устройстве» отпадает.
- В инструменте **корзина содержит 3 записи** (статус синхронизации на 13.09:
  «Отправлено: 13.09.2026, 04:23:35 · получено: 13.09.2026, 02:31:24 · в корзине: 3»).
  Число совпадает с числом пропавших. Похоже, записи были удалены через интерфейс
  и лежат в корзине — восстановление идёт кнопкой «↩ вернуть» на стороне клиента.
- ⚠️ **Корзина и кладбище НЕ входят в файл-бэкап** (`backupPayload`), поэтому по
  экспортам они выглядят пустыми. Это известный открытый вопрос проекта, а не
  признак того, что удалений не было. Не делать выводов об удалениях по бэкапу.

Задача сервера — не восстановление (оно делается в клиенте), а **проверка
сохранности и целостности хранилища**: совпадает ли серверная копия с тем, что
видит клиент, цела ли корзина на сервере, почему при записи 13.09 01:23 не
появился `voice.bak.json`, и что за каталог `history/`.

Известное состояние каталога на 13.09 13:02:

```
drwxrwxr-x  2 ubuntu ubuntu   4096 Sep 13 01:23 history
-rw-r--r--  1 ubuntu ubuntu   1998 Sep 12 23:31 settings.json
-rw-r--r--  1 ubuntu ubuntu 277121 Sep 12 23:31 voice.bak.json.SAVED-20260913-0016
-rw-r--r--  1 ubuntu ubuntu 272665 Sep 13 01:23 voice.json
-rw-r--r--  1 ubuntu ubuntu 268791 Sep 12 23:31 voice.json.SAVED-20260913-0016
```

Два обстоятельства требуют объяснения:
- **живого `voice.bak.json` нет**, хотя запись в `voice.json` была в 01:23 —
  по коду перед перезаписью предыдущая версия должна уходить в `.bak`;
- **каталог `history/` создан ровно в 01:23** — возможно, механизм резервных
  копий кем-то изменён; выяснить, что это и откуда.

---

## 2. Шаг 0 — страховка (выполнить ПЕРВЫМ, до всего остального)

```bash
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p ~/avito-rescue/snapshot-$STAMP
cp -a ~/avito-sync/. ~/avito-rescue/snapshot-$STAMP/
cp -a ~/avito-journal/. ~/avito-rescue/snapshot-$STAMP/journal/ 2>/dev/null
du -sh ~/avito-rescue/snapshot-$STAMP
find ~/avito-rescue/snapshot-$STAMP -type f -printf '%10s  %TY-%Tm-%Td %TH:%TM  %p\n' | sort -k3
```

В отчёт: путь снимка и полный листинг. Дальше работать **только с копиями внутри
снимка**, оригиналы в `~/avito-sync/` не открывать на запись ни при каких условиях.

---

## 3. Шаг 1 — инвентаризация всех версий `voice`

```bash
ls -la ~/avito-sync/ ~/avito-sync/history/
stat -c '%n | размер %s | изменён %y' ~/avito-sync/voice* ~/avito-sync/history/* 2>/dev/null
```

В отчёт: полный список файлов в `history/` с размерами и датами.

---

## 4. Шаг 2 — что внутри каждой версии

Создать разборщик (пишет только в stdout):

```bash
cat > ~/vcheck.js << 'EOF'
const fs = require("fs");
for (const f of process.argv.slice(2)) {
  let d;
  try { d = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.log("=== " + f + " — НЕ ЧИТАЕТСЯ: " + e.message); continue; }
  const x = d.data || d;
  const db = x.db || [], refs = x.refs || [], fav = x.favorites || [];
  const trash = x.trash || [], dead = x.deleted || [];
  console.log("=== " + f);
  console.log("    db:", db.length, "| refs:", refs.length, "| favorites:", fav.length,
              "| trash:", trash.length, "| deleted:", dead.length);
  db.forEach((r, i) => console.log("    #" + (i + 1),
    "uid=" + (r._uid || "-"), "| id=" + r.id, "|", r.product, "|", r.region,
    "|", r.date, "| финал:", r.finalDesc ? r.finalDesc.length + " зн." : "НЕТ"));
  dead.forEach(t => console.log("    [кладбище]", JSON.stringify(t)));
  trash.forEach(t => console.log("    [корзина]", t.kind, t.at, "|",
    ((t.rec && (t.rec.product || t.rec.title)) || "").slice(0, 60)));
}
EOF
node ~/vcheck.js ~/avito-rescue/snapshot-*/voice.json \
                 ~/avito-rescue/snapshot-*/voice.json.SAVED-* \
                 ~/avito-rescue/snapshot-*/voice.bak.json.SAVED-* \
                 ~/avito-rescue/snapshot-*/history/* 2>/dev/null
```

В отчёт: **вывод целиком**, по всем файлам. Это главный результат задачи.
Особое внимание: в какой из версий присутствует запись **Claude Pro / Пермь** и
запись **Marvel's Wolverine / Саратов**, и что лежит в `deleted` (кладбище) — если
там есть ключи вида `db|Claude Pro|Пермь|...`, надо привести их **дословно**
вместе с полем `at` (временем удаления).

---

## 5. Шаг 3 — как сервер пишет резервную копию

Только чтение кода, без правок:

```bash
cd ~/poigraem-backend && git log --oneline -8 && git status --short
grep -n "avito-sync\|avito_sync\|AVITO_SYNC\|\.bak\|history" ~/poigraem-backend/server.js | head -60
```

Ответить в отчёте на три вопроса:
1. Под каким именем код сохраняет предыдущую версию (`voice.bak.json`?
   `voice.json.bak`?) — и совпадает ли оно с тем, что реально лежит на диске.
2. Пишет ли код что-либо в `history/`. Если нет — кто создал этот каталог
   (посмотреть `git log` на предмет правок после 12.09, историю shell:
   `grep -n "history" ~/.bash_history | tail -20`).
3. Есть ли в коде путь, при котором запись в `voice.json` проходит, **а `.bak`
   не создаётся** (например, ошибка копирования проглатывается `try/catch`).

---

## 6. Шаг 4 — не было ли отказов записи

Отсутствие `.bak` и пропажа записей могут иметь общую причину — сбой файловых
операций:

```bash
df -h /home && df -i /home
pm2 logs poigraem-api --lines 800 --nostream 2>/dev/null | grep -i "avito-sync\|ENOSPC\|EACCES\|EDQUOT\|sync write\|rename" | tail -40
ls -la ~/.pm2/logs/ | head
grep -c . ~/avito-journal/2026-09.jsonl
```

В отчёт: свободное место и inodes, найденные ошибки (или явно «ошибок нет»).

---

## 7. Шаг 5 — полная выгрузка сырья из журнала

Журнал — независимый от Истории источник: событие `edited` содержит обе версии
текста целиком. Нужна выжимка для восстановления.

```bash
cat > ~/jdump.js << 'EOF'
const fs = require("fs");
const f = process.env.HOME + "/avito-journal/2026-09.jsonl";
const seen = new Set(), byPair = new Map(), counts = new Map();
for (const l of fs.readFileSync(f, "utf8").split("\n")) {
  if (!l.trim()) continue;
  let e; try { e = JSON.parse(l); } catch (_) { continue; }
  const k = e.eid || (e.ts + e.event);
  if (seen.has(k)) continue;
  seen.add(k);
  counts.set(e.event, (counts.get(e.event) || 0) + 1);
  if (e.event !== "edited") continue;
  const pair = (e.product || "") + " | " + (e.region || "");
  const prev = byPair.get(pair);
  if (!prev || e.ts > prev.ts) byPair.set(pair, e);
}
console.log("Событий по типам:");
[...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("   ", k, v));
console.log("\nУникальных пар «бот → финал»:", byPair.size);
const out = [...byPair.values()].map(e => ({
  ts: e.ts, product: e.product, region: e.region,
  botTitle: e.botTitle, finalTitle: e.finalTitle,
  botDescription: e.botDescription, finalDescription: e.finalDescription,
  editShare: e.editShare, descPasted: e.descPasted, chainId: e.chainId,
}));
out.forEach(o => console.log("   ", o.ts, "|", o.product, "|", o.region,
  "| бот:", (o.botDescription || "").length, "→ финал:", (o.finalDescription || "").length));
fs.writeFileSync(process.env.HOME + "/avito-rescue/finals.json", JSON.stringify(out, null, 2));
console.log("\nЗаписано: ~/avito-rescue/finals.json");
EOF
node ~/jdump.js
```

В отчёт: вывод целиком + подтверждение, что `~/avito-rescue/finals.json` создан,
и его размер. **Сам файл в отчёт не вставлять** — он большой; владелец заберёт его
отдельно.

Дополнительно — были ли в журнале следы удаления записей Истории:

```bash
grep -o '"event":"[a-z_]*"' ~/avito-journal/2026-09.jsonl | sort | uniq -c | sort -rn
grep -n '"act":"db-del"\|"act":"db-save"\|db_del' ~/avito-journal/2026-09.jsonl | head -20
```

---

## 8. Шаг 6 — хронология записей в `voice.json`

Нужно понять, когда именно состав `db` уменьшился:

```bash
for f in ~/avito-rescue/snapshot-*/voice*.json* ~/avito-rescue/snapshot-*/history/*; do
  [ -f "$f" ] || continue
  n=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const x=d.data||d;console.log((x.db||[]).length+" записей, финалов: "+(x.db||[]).filter(r=>r.finalDesc).length)' "$f" 2>/dev/null)
  echo "$(stat -c '%y' "$f" | cut -c1-19)  $f  ->  $n"
done | sort
```

В отчёт: таблица «время файла → сколько записей и сколько с финалами». По ней
видно, на каком шаге исчезли строки.

---

## 9. Формат отчёта

Отчёт положить в `~/avito-rescue/REPORT.md` **и продублировать в чат целиком**.
Структура:

1. **Снимок** — путь, размер, листинг.
2. **Версии `voice`** — таблица «файл → дата → db → финалов», вывод `vcheck.js`
   целиком.
3. **Где Пермь и Саратов** — в каких версиях эти записи есть, в каких нет.
4. **Кладбище и корзина** — дословное содержимое, с временами.
5. **Механизм `.bak`** — ответы на три вопроса шага 3.
6. **Отказы записи** — место, inodes, ошибки в логах (или «нет»).
7. **Журнал** — типы событий со счётчиками, 5 пар «бот → финал», факт создания
   `finals.json`.
8. **Хронология** — таблица шага 6.
9. **Открытые вопросы** — всё, что осталось непонятным. Гипотезы о клиенте
   помечать явно как гипотезы.

Ничего не чинить и не предлагать чинить на сервере: решение принимает владелец
вместе с клиентской сессией, у которой есть код приложения.
