/**
 * Опциональный слой LLM для ассистента кабинета (BRIEF v2 §5,
 * ARCHITECTURE §1: «серверный сервис с опциональным LLM, ключ только в
 * env + детерминированный fallback»).
 *
 * Правила слоя:
 * - ключ берётся ТОЛЬКО из process.env (ASSISTANT_LLM_API_KEY) и уходит
 *   исключительно в заголовок Authorization исходящего запроса: ни в
 *   ответы, ни в логи, ни в браузер он не попадает;
 * - нет ключа (или base URL, или модели) → клиент не создаётся, и
 *   ассистент работает в детерминированном режиме;
 * - клиент — интерфейс с инъекцией в askAssistant (параметр, не глобал):
 *   тесты идут без сети, продакшен — через env;
 * - любая ошибка/таймаут LLM → ответ детерминированного движка
 *   (services/assistant.ts), пользователь не видит технических деталей;
 * - в модель уходит ТОЛЬКО вычисленная сводка по владельцу сессии
 *   (никогда чужие данные и никогда сырые таблицы БД).
 */
import { ASSISTANT_SYSTEM_PROMPT, TEACHER_ASSISTANT_SYSTEM_PROMPT } from './assistantPrompt';

/** Таймаут запроса к LLM, мс (дольше ждать ответа нельзя). */
export const ASSISTANT_LLM_TIMEOUT_MS = 10_000;

/** Конфигурация LLM из окружения сервера. */
export interface LlmConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** Запрос к LLM: системный промпт + пользовательский контекст. */
export interface LlmRequest {
  readonly system: string;
  readonly user: string;
}

/**
 * Клиент LLM. Реализация по умолчанию — OpenAI-совместимый
 * /chat/completions; в тестах подменяется заглушкой.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/**
 * Системный промпт ассистента (единственный источник — модуль
 * assistantPrompt.ts, чтобы его можно было проверить тестом).
 */
export { ASSISTANT_SYSTEM_PROMPT, TEACHER_ASSISTANT_SYSTEM_PROMPT };

/**
 * Конфигурация из окружения. Любой из обязательных параметров отсутствует
 * (или пустой) → null: режим LLM выключен, работает детерминированный
 * движок. Значение ключа наружу не отдаётся и в сообщениях не участвует.
 */
export function llmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const baseUrl = (env.ASSISTANT_LLM_BASE_URL ?? '').trim();
  const apiKey = (env.ASSISTANT_LLM_API_KEY ?? '').trim();
  const model = (env.ASSISTANT_LLM_MODEL ?? '').trim();
  if (baseUrl === '' || apiKey === '' || model === '') {
    return null;
  }
  // Слеш на конце убираем: baseUrl + '/chat/completions' не должен давать '//'.
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model };
}

/** Клиент LLM из окружения (null — режим выключен). */
export function createLlmClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): LlmClient | null {
  const config = llmConfigFromEnv(env);
  return config === null ? null : createLlmClient(config, fetchImpl);
}

/**
 * Клиент OpenAI-совместимого эндпоинта. Ошибки бросаются как обычные
 * Error БЕЗ заголовков и тела запроса: в логах не должно быть ключа.
 */
export function createLlmClient(
  config: LlmConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): LlmClient {
  return {
    async complete({ system, user }: LlmRequest): Promise<string> {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(ASSISTANT_LLM_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`LLM вернул статус ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: readonly { message?: { content?: unknown } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('LLM вернул пустой ответ');
      }
      return content.trim();
    },
  };
}
