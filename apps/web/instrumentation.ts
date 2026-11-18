/**
 * instrumentation.ts — серверные хуки Next.js (Node-runtime).
 *
 * Здесь поднимаются фоновые задачи каналов доступа (BRIEF v3):
 * 1. long-polling живых адаптеров (Telegram / VK / MAX) — startChannelAdapters;
 * 2. интервал разбора outbox уведомлений — runChannelDispatch.
 *
 * ЗАЧЕМ ИМЕННО ЗДЕСЬ: register() вызывается один раз на процесс сервера
 * (next start и next dev), поэтому фоновые задачи не привязаны к запросу
 * и не имеют публичного рота: запускать рассылку или опрос извне нельзя.
 * Обе задачи идемпотентны по природе (start адаптеров — идемпентен,
 * проход очереди берёт только PENDING-записи), поэтому повторный вызов
 * register ничего не ломает.
 *
 * Таймер помечен unref(): он не должен удерживать процесс (например, на
 * время сборки Next.js). В сборке (phase-production-build) задачи не
 * поднимаются вовсе — там нет сервера и базы для рассылки.
 */

/** Интервал разбора outbox по умолчанию, миллисекунды. */
export const BOT_DISPATCH_INTERVAL_DEFAULT_MS = 15_000;

/** Минимально допустимый интервал: защита от опроса БД в цикле. */
const BOT_DISPATCH_INTERVAL_MIN_MS = 1_000;

/**
 * Интервал разбора очереди из BOT_DISPATCH_INTERVAL_MS.
 *
 * Некорректное значение (не число, меньше минимума) — одна строка в лог и
 * значение по умолчанию: молчаливый сбой настройки хуже, чем заметный.
 */
function dispatchIntervalMs(): number {
  const raw = process.env.BOT_DISPATCH_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') {
    return BOT_DISPATCH_INTERVAL_DEFAULT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < BOT_DISPATCH_INTERVAL_MIN_MS) {
    console.warn(
      `[bot:dispatch] BOT_DISPATCH_INTERVAL_MS=${raw} некорректен, используется ${BOT_DISPATCH_INTERVAL_DEFAULT_MS} мс`,
    );
    return BOT_DISPATCH_INTERVAL_DEFAULT_MS;
  }
  return parsed;
}

export async function register(): Promise<void> {
  // Фоновые задачи живут только в Node-runtime: middleware и edge не имеют
  // доступа к Prisma и сети каналов.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  // Фаза сборки: сервера и базы рассылки нет.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const { startChannelAdapters } = await import('./lib/bot/adapters');
  const { runChannelDispatch } = await import('./lib/bot/dispatcher');

  // Приём обновлений каналов: демо-каналы (без токена) молчат.
  startChannelAdapters();

  const interval = dispatchIntervalMs();
  const timer = setInterval(() => {
    void runChannelDispatch();
  }, interval);
  // Таймер не должен удерживать процесс (сборка, тесты, остановка).
  timer.unref();

  console.info(`[bot:dispatch] очередь уведомлений разбирается каждые ${interval} мс`);
}
