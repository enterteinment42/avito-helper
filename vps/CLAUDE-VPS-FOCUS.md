<!-- Подключён к CLAUDE.md строкой @CLAUDE-VPS-FOCUS.md, грузится автоматически.
     Не больше 3 блоков и ничего старше самого свежего блока в файле на 30 дней — остальное в CLAUDE-VPS.md. -->

## Текущий фокус

🔵 **16.10 — пулы подписей положены в `~/avito-sync/settings.json`** (`sigGame` 7, `sigSub` 3;
проверено через GET). Копия до правки — `settings.json.SAVED-20261016-sigpools`.
⚠️ **Не закрыто:** `[x]` в `TASK-SIG-POOLS-VPS.md` не стоит — локальный `main` разошёлся
с origin (у нас `792f46f` не запушен, у них 7 коммитов Windows). Ждём решения пользователя:
`pull --rebase` → отметка → коммит → пуш. Ещё не разобраны `TASK-HISTORY-RESCUE-VPS.md`, `TASK-STAGED-SERIES-VPS.md`.

🔵 **15.10 — первый разбор журнала самообучения** (запись в `CLAUDE-VPS.md`): без правки
не ушло ни одно из 14, доля правки 0.35. Windows сделала все правки из
`TASK-JOURNAL-FIXES-WINDOWS.md` в `63a1014` (16.10). Жаргон в заголовках — пока не трогаем.
**Следующий шаг:** при ≥10 публикациях после `63a1014` — повторный разбор (`/bot-selflearn-log`),
сравнить с 15.10; дубли `posted`/`edited` снимать по `botTitle`+`region`.

🔵 **15.10 — папка под git.** `~/avito-helper` → `~/avito-helper-repo/vps/` (sparse-клон
публичного `enterteinment42/avito-helper`). В начале сессии — `git -C ~/avito-helper-repo pull --ff-only`
(при расхождении — не ребейзить молча, спросить); в конце — коммит, пуш по решению пользователя.
