/**
 * POST /api/teacher/study-plans — загрузка учебного плана преподавателем
 * (BRIEF v2 §5, RAG-ассистент преподавателя).
 * GET   — свои планы, свежие сверху (без storagePath: приватное хранилище).
 *
 * Multipart (POST): поле title + файл плана (.md/.txt, ≤1 МБ, текст UTF-8).
 * Файл уходит ТОЛЬКО в приватное хранилище packages/core
 * (storage/study-plans/<teacherId>/, вне webroot, публичных ссылок нет) —
 * в базе остаётся запись StudyPlan с относительным путём.
 *
 * Владение: teacherId берётся из сессии (requireTeacher внутри сервиса),
 * маршрут не принимает никаких идентификаторов владельца. Студент,
 * сотрудник деканата и админ без профиля преподавателя → 403.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  MAX_STUDY_PLAN_SIZE_BYTES,
  STUDY_PLAN_ALLOWED_MIME,
  IdCardStorageError,
  firstIssues,
  listMyStudyPlans,
  uploadStudyPlan,
  ValidationError,
} from '@udgu/core';
import { studyPlanUploadSchema } from '@/lib/validation';
import { coreErrorResponse, requireSession } from '@/lib/session';

/**
 * MIME файла плана: браузер не всегда знает тип .md (часто приходит
 * пустая строка), поэтому восстанавливаем его по расширению имени.
 * Неизвестное расширение → null (маршрут ответит понятной ошибкой).
 */
function studyPlanMime(file: File): string | null {
  if (file.type in STUDY_PLAN_ALLOWED_MIME) {
    return file.type;
  }
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'md') {
    return 'text/markdown';
  }
  if (extension === 'txt') {
    return 'text/plain';
  }
  return null;
}

/** Свои планы: сервис резолвит teacherId из сессии, storagePath не отдаём. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const plans = await listMyStudyPlans(session);
    return NextResponse.json({ plans });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError('INVALID_INPUT', 'Ожидалась форма multipart/form-data.');
    }

    const parsed = studyPlanUploadSchema.safeParse({
      title: typeof form.get('title') === 'string' ? form.get('title') : '',
    });
    if (!parsed.success) {
      throw new ValidationError('INVALID_INPUT', 'Некорректные данные плана.', firstIssues(parsed.error));
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new ValidationError('INVALID_INPUT', 'Прикрепите файл учебного плана.');
    }
    if (file.size === 0) {
      throw new ValidationError('INVALID_INPUT', 'Файл плана пустой.');
    }
    if (file.size > MAX_STUDY_PLAN_SIZE_BYTES) {
      throw new ValidationError('INVALID_INPUT', 'Размер плана не должен превышать 1 МБ.');
    }
    const mime = studyPlanMime(file);
    if (mime === null) {
      throw new ValidationError(
        'INVALID_INPUT',
        'Нужен текстовый план: файл .md или .txt до 1 МБ.',
      );
    }

    let plan;
    try {
      plan = await uploadStudyPlan(session, {
        title: parsed.data.title,
        fileName: file.name,
        mime,
        buffer: Buffer.from(await file.arrayBuffer()),
      });
    } catch (error) {
      // Ошибки хранилища (размер, тип) — это проблема входных данных,
      // а не сервера: текст сообщения от хранилища понятен пользователю.
      if (error instanceof IdCardStorageError) {
        throw new ValidationError('INVALID_INPUT', error.message);
      }
      throw error;
    }

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
