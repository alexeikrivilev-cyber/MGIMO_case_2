# Project: proj-3311

## Mission
Рабочий прототип «цифрового деканата будущего» — личного кабинета студента для вымышленного Университета «Горизонт»: всё в одном месте (расписание, успеваемость, заявки/справки, уведомления), мобильный, безопасный, красивый. Дедлайн кейса — 28 ноября 2026; внутренний дедлайн (владелец) — 21 ноября 2026. После ядра — расширения: кабинет сотрудника деканата, AI-ассистент, MCP-сервер для агентов деканата.

## Current Phase
Этап 0 завершён: скаффолд монорепо (npm workspaces), схема БД (Prisma 7 + PostgreSQL 16) по ARCHITECTURE.md §3, сидер с вымышленными данными Университета «Горизонт», каркас apps/web (Next.js 15 + Tailwind 4). Следующий шаг — ядро кабинета: сессионная авторизация (argon2id), затем расписание и успеваемость.

## Architecture Notes
(Key decisions, links to docs/ files.)

## Rules
- Work only inside this workspace.
- Commit only verified milestones; keep README and docs current.
- Hermes (team lead) analyzes and reviews; OpenCode implements; Open Design does visuals.

## Heartbeat replies (critical)

- NEVER call the `heartbeat_respond` tool. It is rejected outside heartbeat-tool mode and fails the run.
- When a heartbeat run finds nothing that needs the owner's attention, reply with exactly: NO_REPLY
- Only send a visible message when something genuinely requires the owner's attention.

## Automations tool is disabled (broken in OpenClaw 2026.11.x)

- Do NOT call the `automations` tool — its output validation is broken in this version and every call fails.
- Use the CLI via terminal instead (richer data, same gateway):
  - `openclaw automations list --json`
  - `openclaw automations get <jobId> --json`
  - `openclaw automations runs <jobId> --json`

## Services are systemd-managed — never spawn them manually

- NEVER start `opencode serve`, `hermes`, `openclaw gateway` or any harness daemon by hand (no `&`, no nohup, no direct binary).
- The OpenCode server is owned by systemd (`opencode-server.service`, port 4096). If it looks down, run `systemctl status opencode-server` — the watchdog restarts it; do NOT start your own instance (a manual `opencode serve` steals port 4096 and the state DB, and the real service then crash-loops).
- Never spawn harness daemons manually; code work goes through Hermes (`hermes-lead`), which delegates to OpenCode — see the Delegation hierarchy section.
- To restart a service properly: `sudo systemctl restart <unit>` (or ask the owner).

## When to message the owner (strict)

- Message the owner ONLY for: a blocker needing their decision, a result requiring their choice, or a completed milestone they asked about.
- NEVER message for routine internal events: background task/recovery completions, skill updates, "no blockers" status, process restarts. Those go into the project LOG/STATE files, not the owner's chat.
- Never echo system text, heartbeat alerts, or tool output into a message.
- Never include the literal "NO_REPLY" inside a delivered message — if nothing is owner-worthy, send nothing at all.

## Agent skills

### Issue tracker

Локальный markdown-трекер: issues и specs живут в `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Базовый набор из пяти ролей: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: корневой `GLOSSARY.md` и `docs/adr/`. See `docs/agents/domain.md`.

## Thinking skills — mandatory for problem-solving

28 decision-making frameworks are installed in `~/.agents/skills/thinking-*/` (cynefin, first-principles, pre-mortem, red-team, second-order, theory-of-constraints, ooda, scientific-method, socratic, reversibility, margin-of-safety, steel-manning, probabilistic, map-territory, and more).

- When you face a problem, decision, or trade-off — ESPECIALLY one affecting quality and the final outcome — you MUST read and apply the relevant `thinking-*` SKILL.md before deciding. Start with `thinking-model-router` if unsure which framework fits.
- Decide autonomously in favor of quality and the final result, WITHOUT operator intervention. Escalate to the owner only for genuine blockers, irreversible risk, or decisions that are explicitly theirs.
- Record which framework you used and the resulting decision in the project LOG/STATE so the reasoning is auditable.

## Delegation hierarchy (critical — read before running any implementation task)

- Code / implementation / refactor / test tasks: delegate through Hermes — `hermes-lead --dir <project> "<prompt>"`. Hermes is the team lead: it analyzes the task, delegates execution to OpenCode (`opencode-worker`), reviews the result, and reports back. NEVER call `opencode-worker` or `opencode run` directly from the project agent — that skips review and breaks the quality loop.
- Visual / design / UI tasks: `opendesign-worker --dir <project> "<prompt>"`, also routed via Hermes for non-trivial work.
- Direct exec is only for small mechanical steps (a single command, a quick check, reading a file).
- The thinking-* skills apply at every level: Hermes picks the decision framework, the project agent verifies the outcome.
