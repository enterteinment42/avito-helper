<!-- Подключён к CLAUDE.md строкой @CLAUDE-VPS-FOCUS.md, грузится автоматически.
     Не больше 3 блоков и ничего старше самого свежего блока в файле на 30 дней — остальное в CLAUDE-VPS.md. -->

## Текущий фокус

🔵 **16.10 → 23.10 — пулы подписей в `~/avito-sync/settings.json`.** Живые: `sigGame` 6 (Windows
`7f4d2aa` убрала длинный), `sigSub` 3, документ с `sigVer`. ⚠️ Копию `.SAVED-20261016-sigpools`
поверх НЕ класть — устарела (запись 23.10). `[x]` в `TASK-SIG-POOLS-VPS.md` поставлен 23.10,
репо сведено с origin и запушено.
Не разобраны `TASK-HISTORY-RESCUE-VPS.md`, `TASK-STAGED-SERIES-VPS.md`.

🔵 **15.10 — первый разбор журнала самообучения** (запись в `CLAUDE-VPS.md`): без правки
не ушло ни одно из 14, доля правки 0.35. Windows сделала правки в `63a1014` (отметки — `9a5b4eb`);
**открыт пункт «фон обложки»**. Жаргон в заголовках — пока не трогаем.
**Следующий шаг:** при ≥10 публикациях после `63a1014` — повторный разбор (`/bot-selflearn-log`),
сравнить с 15.10; дубли `posted`/`edited` снимать по `botTitle`+`region`.

🔵 **23.10 — price-lookup для avito-helper** (`3735378`, запушен): `/api/cover` и `/api/normalize`,
CORS для github.io. Ждём от Windows замены двух `POST …/api/price-lookup` на `GET …/api/cover`.
