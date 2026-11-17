/**
 * POST /api/assistant — вопрос AI-ассистенту студента (BRIEF v2 §5).
 *
 * Ассистент помогает в учёбе и закрытии долгов по данным ВЛАДЕЛЬЦА СЕССИ:
 * распознавание интента, сбор фактов и ответ считает packages/core
 * (services/assistant.ts) — здесь только граница API.
 *
 * - requireSession: без сессии → 401 (studentId из тела не принимается
 *   вообще, поэтому подмена «чьих данных» через запрос невозможна);
 * - LLM опционален и включается ТОЛЬКО переменными окружения сервера
 *   (ASSISTANT_LLM_*): без ключа ответ всегда детерминированный, ошибка
 *   LLM не ломает ответ (фолбэк внутри askAssistant);
 * - ответ: { answer, intent, suggestions, mode } — mode сообщает, это
 *   ответ движка или LLM по его же данным.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { askAssistant, createLlmClientFromEnv } from '@udgu/core';
import { assistantQuestionSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const { question } = await parseJsonBody(request, assistantQuestionSchema);

    const answer = await askAssistant(session, question, {
      // null без ключа в env — детерминированный режим (BRIEF v2 §5).
      llm: createLlmClientFromEnv(),
    });

    return NextResponse.json({
      answer: answer.answer,
      intent: answer.intent,
      suggestions: answer.suggestions,
      mode: answer.mode,
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
