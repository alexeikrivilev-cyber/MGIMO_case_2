/**
 * /api/sick-leave — статус «болею» (BRIEF v2).
 *
 * GET  — свои отметки о болезни (сначала новые) + болею ли прямо сейчас
 *        (sickNow) — этим же флагом пользуются преподаватели и деканат
 *        для учёта посещаемости (в прототипе — синтетический реестр).
 * POST — отметить болезнь (multipart/form-data): период
 *        YYYY-MM-DD..YYYY-MM-DD, необязательная причина и необязательное
 *        ФОТО справки. Правила (≤14 дней подряд, без пересечений с
 *        активной отметкой) и уведомление сотрудникам деканата — в
 *        packages/core.
 *
 * Фото справки уходит в ПРИВАТНОЕ хранилище (storage.ts, вне webroot,
 * без публичных ссылок): в БД пишется только относительный путь, доступ
 * есть у владельца и у сотрудников деканата. Клиент проверяет формат и
 * размер заранее (validateIdCardPhoto в lib/api-client), сервер
 * перепроверяет всё сам.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ID_CARD_ALLOWED_MIME,
  MAX_ID_CARD_SIZE_BYTES,
  createMySickLeave,
  deleteSickLeaveCertificate,
  firstIssues,
  getMySickLeaves,
  isSickNow,
  requireStudent,
  saveSickLeaveCertificate,
  ValidationError,
} from '@udgu/core';
import { sickLeaveMultipartSchema } from '@/lib/validation';
import { coreErrorResponse, requireSession } from '@/lib/session';
import { enforceSessionRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const [items, sickNow] = await Promise.all([getMySickLeaves(session), isSickNow(session)]);
    return NextResponse.json({ items, sickNow });
  } catch (error) {
    return coreErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    // Rate-limit кабинета: 30 отметок о болезни в минуту на сессию.
    const limited = enforceSessionRateLimit(session, 'sick-leave');
    if (limited !== null) {
      return limited;
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError('INVALID_INPUT', 'Ожидалась форма multipart/form-data.');
    }

    const raw = {
      dateFrom: typeof form.get('dateFrom') === 'string' ? (form.get('dateFrom') as string) : '',
      dateTo: typeof form.get('dateTo') === 'string' ? (form.get('dateTo') as string) : '',
      reason: typeof form.get('reason') === 'string' ? (form.get('reason') as string) : undefined,
    };
    const parsed = sickLeaveMultipartSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('INVALID_INPUT', 'Некорректные данные отметки о болезни.', firstIssues(parsed.error));
    }

    // Необязательное фото справки — сразу в приватное хранилище.
    const certificate = form.get('certificate');
    let attachmentPath: string | undefined;
    if (certificate !== null && certificate instanceof File) {
      if (certificate.size === 0) {
        throw new ValidationError('INVALID_INPUT', 'Файл справки пустой.');
      }
      if (certificate.size > MAX_ID_CARD_SIZE_BYTES) {
        throw new ValidationError('INVALID_INPUT', 'Размер фото справки не должен превышать 5 МБ.');
      }
      if (!(certificate.type in ID_CARD_ALLOWED_MIME)) {
        throw new ValidationError(
          'INVALID_INPUT',
          `Допустимые форматы фото справки: ${Object.keys(ID_CARD_ALLOWED_MIME).join(', ')}.`,
        );
      }
      // studentId берём из сессии: файл принадлежит автору отметки.
      const { studentId } = requireStudent(session);
      attachmentPath = await saveSickLeaveCertificate(
        studentId,
        Buffer.from(await certificate.arrayBuffer()),
        certificate.type,
      );
    }

    let sickLeave;
    try {
      sickLeave = await createMySickLeave(session, {
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        reason: parsed.data.reason,
        attachmentPath,
      });
    } catch (error) {
      // Период/пересечение отклонили — загруженный файл не оставляем сиротой.
      if (attachmentPath !== undefined) {
        try {
          await deleteSickLeaveCertificate(attachmentPath);
        } catch {
          // Удаление — лучшее усилие: отказ заявки важнее очистки.
        }
      }
      throw error;
    }

    return NextResponse.json({ sickLeave }, { status: 201 });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
