/**
 * POST /api/teacher/assistant — вопрос AI-ассистенту ПРЕПОДАВАТЕЛЯ
 * (BRIEF v2 §5): RAG по загруженному учебному плану.
 *
 * Тело: { planId?, question }. Без planId отвечает самый свежий план
 * преподавателя. Всё считает packages/core (askStudyPlanAssistant):
 * поиск разделов плана, цитаты-подсказки, сопоставление с долгами
 * студентов его групп.
 *
 * - requireSession: без сессии → 401; teacherId из тела не принимается
 *   вообще, поэтому «чей план» определяется только сессией;
 * - LLM опционален и включается ТОЛЬКО переменными окружения сервера
 *   (ASSISTANT_LLM_*): без ключа ответ детерминированный, ошибка LLM
 *   не ломает ответ (фолбэк внутри askStudyPlanAssistant);
 * - в модель уходят ТОЛЬКО чанки плана владельца сессии и его вопрос;
 * - ответ: { answer, mode, citations, suggestions, plan } — citations
 *   несут раздел плана и оценку релевантности.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { askStudyPlanAssistant, createLlmClientFromEnv } from '@udgu/core';
import { teacherAssistantQuestionSchema } from '@/lib/validation';
import { parseJsonBody } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';
import { enforceSessionRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    // Rate-limit кабинета: 30 вопросов ассистенту в минуту на сессию.
    const limited = enforceSessionRateLimit(session, 'teacher-assistant');
    if (limited !== null) {
      return limited;
    }
    const { planId, question } = await parseJsonBody(request, teacherAssistantQuestionSchema);

    const answer = await askStudyPlanAssistant(
      session,
      { question, ...(planId === undefined ? {} : { planId }) },
      {
        // null без ключа в env — детерминированный режим (BRIEF v2 §5).
        llm: createLlmClientFromEnv(),
      },
    );

    return NextResponse.json({
      answer: answer.answer,
      mode: answer.mode,
      citations: answer.citations,
      suggestions: answer.suggestions,
      plan: answer.plan,
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
