/**
 * /api/verification — заявка на верификацию студбилета (BRIEF v2).
 *
 * GET  — своя заявка + гейт верификации (null, если заявки не было).
 * POST — multipart/form-data: поле cardNumber + файл photo
 *        (image/jpeg|png|webp, ≤5 МБ). Всё остальное делает
 *        packages/core (submitVerification): фото уходит ТОЛЬКО в
 *        приватное хранилище (storage.ts, вне webroot, без публичных
 *        ссылок), мок-распознавание сверяет номер с синтетическим
 *        реестром, заявка становится PENDING или REJECTED.
 *
 * Владение: маршрут не принимает никаких идентификаторов — студент
 * берётся из сессии.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ID_CARD_ALLOWED_MIME,
  MAX_ID_CARD_SIZE_BYTES,
  getMyVerification,
  getVerificationGate,
  submitVerification,
  ValidationError,
  firstIssues,
} from '@udgu/core';
import { verificationSubmitSchema } from '@/lib/validation';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const [verification, verificationGate] = await Promise.all([
      getMyVerification(session),
      getVerificationGate(session),
    ]);
    return NextResponse.json({ verification, verificationGate });
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

    const parsed = verificationSubmitSchema.safeParse({
      cardNumber: typeof form.get('cardNumber') === 'string' ? form.get('cardNumber') : '',
    });
    if (!parsed.success) {
      throw new ValidationError('INVALID_INPUT', 'Некорректные данные верификации.', firstIssues(parsed.error));
    }

    const photo = form.get('photo');
    if (!(photo instanceof File)) {
      throw new ValidationError('INVALID_INPUT', 'Прикрепите фото студенческого билета.');
    }
    if (photo.size === 0) {
      throw new ValidationError('INVALID_INPUT', 'Файл фото пустой.');
    }
    if (photo.size > MAX_ID_CARD_SIZE_BYTES) {
      throw new ValidationError('INVALID_INPUT', 'Размер фото не должен превышать 5 МБ.');
    }
    if (!(photo.type in ID_CARD_ALLOWED_MIME)) {
      throw new ValidationError(
        'INVALID_INPUT',
        `Допустимые форматы фото: ${Object.keys(ID_CARD_ALLOWED_MIME).join(', ')}.`,
      );
    }

    const verification = await submitVerification(session, {
      cardNumber: parsed.data.cardNumber,
      photoBuffer: Buffer.from(await photo.arrayBuffer()),
      mime: photo.type,
    });

    return NextResponse.json({ verification });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
