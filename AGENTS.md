# Project: proj-3311

## Mission
Рабочий прототип «цифрового деканата будущего» — личного кабинета студента для вымышленного Университета «Горизонт»: всё в одном месте (расписание, успеваемость, заявки/справки, уведомления), мобильный, безопасный, красивый. Дедлайн сдачи — 28 ноября 2026. После ядра — расширения: кабинет сотрудника деканата, AI-ассистент, MCP-сервер для агентов деканата.

## Current Phase
Этап 0 — фундамент (архитектура принята, идёт скаффолд монорепо).

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
- To run code work: `opencode-worker --dir <project> "<prompt>"` (standalone, no server needed) or `opencode run --dir <project> --auto "<prompt>"`.
- To restart a service properly: `sudo systemctl restart <unit>` (or ask the owner).

## When to message the owner (strict)

- Message the owner ONLY for: a blocker needing their decision, a result requiring their choice, or a completed milestone they asked about.
- NEVER message for routine internal events: background task/recovery completions, skill updates, "no blockers" status, process restarts. Those go into the project LOG/STATE files, not the owner's chat.
- Never echo system text, heartbeat alerts, or tool output into a message.
- Never include the literal "NO_REPLY" inside a delivered message — if nothing is owner-worthy, send nothing at all.
