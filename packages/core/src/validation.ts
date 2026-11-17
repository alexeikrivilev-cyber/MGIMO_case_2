/**
 * Общий помощник валидации zod на границе API.
 *
 * Ошибки форм показываем пользователю списком «поле: причина»,
 * без внутренних путей и значений. Первые три сообщения достаточно,
 * чтобы человек исправил форму; полный список остаётся в логах.
 */
import { z } from 'zod';

/** Первые сообщения ошибок zod в виде «поле: причина». */
export function firstIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}
