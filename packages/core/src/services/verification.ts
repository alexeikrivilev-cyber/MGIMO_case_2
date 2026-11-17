/**
 * Верификация студента по фото студенческого билета (BRIEF v2).
 *
 * Поток: студент загружает фото → фото сохраняется в ПРИВАТНОЕ хранилище
 * (storage.ts, вне webroot, без публичных ссылок) → мок-распознавание
 * сверяет номер с синтетическим реестром IdentityRegistry → заявка
 * получает статус PENDING (на проверке сотрудника) или REJECTED (номер
 * не найден в реестре). Окончательное решение принимает сотрудник
 * деканата: reviewVerification.
 *
 * Гейт: до успешной верификации закрыты успеваемость и переписка
 * с преподавателями. Профиль, расписание своей группы и общедоступная
 * информация доступны всегда. Проверка гейта — на сервере
 * (requireVerifiedStudent), не только в UI.
 *
 * Реальные фото и персональные данные не обрабатываются: мок не смотрит
 * на изображение (см. mockOcr.ts), реестр — синтетический.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStudent, requireStaffAccess } from '../ownership';
import { ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { firstIssues } from '../validation';
import { saveIdCardPhoto, deleteIdCardPhoto, ID_CARD_ALLOWED_MIME } from '../storage';
import { recognizeIdCard, type IdentityRegistryEntryLike } from '../mockOcr';
import type { AuthSession } from '../session';
import type { VerificationStatus } from '@udgu/db';

/** Схема заявки на верификацию. */
export const verificationSubmitSchema = z.object({
  cardNumber: z
    .string()
    .trim()
    .min(4, 'Номер студенческого билета слишком короткий')
    .max(32, 'Номер студенческого билета слишком длинный')
    // \p{L}/\p{N}: номера УдГУ содержат кириллические коды направлений
    // (например, «ПИ-2023-0138»), — латиница тут была бы ошибкой.
    .regex(/^[\p{L}\p{N}-]+$/u, 'Номер может содержать только буквы, цифры и дефис'),
  photoBuffer: z.instanceof(Buffer),
  mime: z.enum(Object.keys(ID_CARD_ALLOWED_MIME) as [string, ...string[]], {
    message: `Допустимые форматы: ${Object.keys(ID_CARD_ALLOWED_MIME).join(', ')}`,
  }),
});

export type SubmitVerificationInput = z.infer<typeof verificationSubmitSchema>;

/** Схема решения сотрудника по верификации. */
export const verificationReviewSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED']),
    comment: z.string().max(1000).optional(),
  })
  .refine(
    (value) => value.status !== 'REJECTED' || (value.comment ?? '').trim().length > 0,
    'Для отказа нужен комментарий (причина).',
  );

export type ReviewVerificationInput = z.infer<typeof verificationReviewSchema>;

/** Возможности кабинета, закрываемые до верификации. */
export const VERIFICATION_GATED_FEATURES = ['grades', 'messaging'] as const;

/** Все возможности кабинета студента. */
export const CABINET_FEATURES = [
  'profile',
  'schedule',
  'teacher-schedule',
  'grades',
  'requests',
  'notifications',
  'announcements',
  'sick-leave',
  'verification',
  'messaging',
] as const;

export type CabinetFeature = (typeof CABINET_FEATURES)[number];

export interface VerificationGate {
  readonly verified: boolean;
  readonly unlocked: readonly CabinetFeature[];
  readonly locked: readonly CabinetFeature[];
}

/** Публичное представление заявки на верификацию (без пути к фото). */
export interface MyVerification {
  readonly id: string;
  readonly status: VerificationStatus;
  readonly recognizedLastName: string;
  readonly recognizedFirstName: string;
  readonly recognizedGroupName: string;
  readonly recognizedCardNumber: string;
  readonly matchScore: number | null;
  readonly reviewComment: string | null;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
}

/**
 * Гейт верификации (BRIEF v2): что открыто студенту сессии.
 * До верификации закрыты успеваемость и переписка.
 */
export async function getVerificationGate(session: AuthSession): Promise<VerificationGate> {
  const { studentId } = requireStudent(session);
  const verification = await prisma().studentVerification.findUnique({
    where: { studentId },
    select: { status: true },
  });
  const verified = verification?.status === 'VERIFIED';
  const gated: readonly string[] = VERIFICATION_GATED_FEATURES;
  return {
    verified,
    unlocked: verified
      ? CABINET_FEATURES
      : CABINET_FEATURES.filter((feature) => !gated.includes(feature)),
    locked: verified ? [] : VERIFICATION_GATED_FEATURES,
  };
}

/**
 * Серверная проверка гейта: бросает VerificationRequiredError, если
 * студент не верифицирован. Вызывается из сервисов, закрытых до
 * верификации (успеваемость).
 */
export async function requireVerifiedStudent(
  session: AuthSession,
): Promise<{ studentId: string }> {
  const { studentId } = requireStudent(session);
  const verification = await prisma().studentVerification.findUnique({
    where: { studentId },
    select: { status: true },
  });
  if (verification?.status !== 'VERIFIED') {
    throw new VerificationRequiredError();
  }
  return { studentId };
}

/** Ошибка гейта: данные доступны только после верификации студбилета. */
export class VerificationRequiredError extends ValidationError {
  constructor() {
    super(
      'VERIFICATION_REQUIRED',
      'Раздел доступен после верификации студенческого билета.',
    );
    this.name = 'VerificationRequiredError';
  }
}

/**
 * Подаёт заявку на верификацию: сохраняет фото в приватное хранилище,
 * запускает мок-распознавание и создаёт/обновляет StudentVerification.
 *
 * - номер есть в реестре → PENDING (ждёт решения сотрудника);
 * - номера нет в реестре → REJECTED с комментарием (в реестре ничего
 *   не выдумываем: распознанные ФИО/группа остаются пустыми).
 *
 * Повторная подача после отказа разрешена; после одобрения — нет.
 */
export async function submitVerification(
  session: AuthSession,
  input: SubmitVerificationInput,
): Promise<MyVerification> {
  const { studentId } = requireStudent(session);
  const parsed = verificationSubmitSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректные данные верификации.', firstIssues(parsed.error));
  }
  const { cardNumber, photoBuffer, mime } = parsed.data;

  const existing = await prisma().studentVerification.findUnique({
    where: { studentId },
    select: { id: true, status: true, idCardPhotoPath: true },
  });
  if (existing?.status === 'VERIFIED') {
    throw new ValidationError('CONFLICT', 'Студенческий билет уже верифицирован.');
  }

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    select: { userId: true, groupId: true, group: { select: { name: true } } },
  });
  if (student === null) {
    throw new ValidationError('NOT_FOUND', 'Профиль студента не найден. Обратитесь в деканат.');
  }

  // 1. Фото — в приватное хранилище (вне webroot, публичных ссылок нет).
  const photoPath = await saveIdCardPhoto(studentId, photoBuffer, mime);

  // 2. Мок-распознавание: поиск номера в синтетическом реестре.
  //    Реестр прототипа маленький, поэтому выбираем его целиком;
  //    в продакшне здесь был бы точечный запрос по номеру карточки.
  const registryRows = await prisma().identityRegistry.findMany({
    select: {
      cardNumber: true,
      lastName: true,
      firstName: true,
      middleName: true,
      group: { select: { name: true } },
    },
  });
  const registry: readonly IdentityRegistryEntryLike[] = registryRows.map((row) => ({
    cardNumber: row.cardNumber,
    lastName: row.lastName,
    firstName: row.firstName,
    middleName: row.middleName,
    groupName: row.group.name,
  }));
  const recognition = recognizeIdCard(cardNumber, registry);

  let status: VerificationStatus;
  let matchScore: number | null;
  let reviewComment: string | null;

  if (recognition.found) {
    status = 'PENDING';
    // Группа на карточке должна совпадать с группой студента: расхождение —
    // сигнал сотруднику (карточка одногруппника или устаревшие данные).
    matchScore = recognition.groupName === student.group.name ? recognition.confidence : 0.55;
    reviewComment = null;
  } else {
    status = 'REJECTED';
    matchScore = 0;
    reviewComment = 'Номер студенческого билета не найден в реестре университета.';
  }

  const verification = await prisma().studentVerification.upsert({
    where: { studentId },
    create: {
      studentId,
      status,
      idCardPhotoPath: photoPath,
      recognizedLastName: recognition.lastName,
      recognizedFirstName: recognition.firstName,
      recognizedGroupName: recognition.groupName,
      recognizedCardNumber: recognition.cardNumber,
      matchScore,
      reviewComment,
    },
    update: {
      status,
      idCardPhotoPath: photoPath,
      recognizedLastName: recognition.lastName,
      recognizedFirstName: recognition.firstName,
      recognizedGroupName: recognition.groupName,
      recognizedCardNumber: recognition.cardNumber,
      matchScore,
      reviewComment,
      reviewerId: null,
      reviewedAt: null,
    },
  });

  // Старое фото повторной заявки удаляем: в хранилище остаётся только
  // актуальный снимок (исключение проглатываем намеренно — запись уже
  // создана, и отсутствие старого файла не должно ломать подачу).
  if (existing !== null && existing.idCardPhotoPath !== photoPath) {
    try {
      await deleteIdCardPhoto(existing.idCardPhotoPath);
    } catch {
      // Файл уже удалён или недоступен — подача заявки продолжается.
    }
  }

  await prisma().notification.create({
    data: {
      userId: student.userId,
      type: 'SYSTEM',
      title:
        status === 'PENDING'
          ? 'Заявка на верификацию отправлена'
          : 'Верификация не пройдена',
      body:
        status === 'PENDING'
          ? 'Сотрудник деканата проверит фото студенческого билета. После проверки откроются оценки и переписка.'
          : 'Номер студенческого билета не найден в реестре университета. Проверьте номер и попробуйте снова.',
      link: '/verification',
    },
  });

  await writeAuditEvent({
    actorUserId: student.userId,
    action: 'verification.submit',
    entity: 'StudentVerification',
    entityId: verification.id,
    meta: { status, cardNumber: recognition.cardNumber },
  });

  return toMyVerification(verification);
}

/** Своя заявка на верификацию (null, если заявка ещё не подана). */
export async function getMyVerification(session: AuthSession): Promise<MyVerification | null> {
  const { studentId } = requireStudent(session);
  const verification = await prisma().studentVerification.findUnique({
    where: { studentId },
  });
  return verification === null ? null : toMyVerification(verification);
}

/**
 * Решение сотрудника деканата по заявке на верификацию.
 * Только STAFF/ADMIN (requireStaffAccess). REJECTED требует комментария.
 * Студенту приходит уведомление, решение пишется в аудит.
 */
export async function reviewVerification(
  session: AuthSession,
  verificationId: string,
  input: ReviewVerificationInput,
): Promise<MyVerification> {
  const staff = requireStaffAccess(session);
  const parsed = verificationReviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректное решение по верификации.', firstIssues(parsed.error));
  }
  const { status, comment } = parsed.data;

  if (typeof verificationId !== 'string' || verificationId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }

  const existing = await prisma().studentVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, studentId: true },
  });
  if (existing === null) {
    throw new ValidationError('NOT_FOUND', 'Заявка на верификацию не найдена.');
  }

  const updated = await prisma().studentVerification.update({
    where: { id: verificationId },
    data: {
      status,
      reviewerId: staff.id,
      reviewedAt: new Date(),
      reviewComment: comment ?? null,
    },
  });

  const student = await prisma().student.findUnique({
    where: { id: existing.studentId },
    select: { userId: true },
  });
  if (student !== null) {
    await prisma().notification.create({
      data: {
        userId: student.userId,
        type: 'SYSTEM',
        title: status === 'VERIFIED' ? 'Верификация пройдена' : 'Верификация отклонена',
        body:
          status === 'VERIFIED'
            ? 'Студенческий билет подтверждён. Открыты оценки и переписка с преподавателями.'
            : `Верификация отклонена. ${comment ?? ''}`.trim(),
        link: '/verification',
      },
    });
  }

  await writeAuditEvent({
    actorUserId: staff.id,
    action: 'verification.review',
    entity: 'StudentVerification',
    entityId: updated.id,
    meta: { status, comment: comment ?? null },
  });

  return toMyVerification(updated);
}

function toMyVerification(verification: {
  id: string;
  status: VerificationStatus;
  recognizedLastName: string;
  recognizedFirstName: string;
  recognizedGroupName: string;
  recognizedCardNumber: string;
  matchScore: number | null;
  reviewComment: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
}): MyVerification {
  return {
    id: verification.id,
    status: verification.status,
    recognizedLastName: verification.recognizedLastName,
    recognizedFirstName: verification.recognizedFirstName,
    recognizedGroupName: verification.recognizedGroupName,
    recognizedCardNumber: verification.recognizedCardNumber,
    matchScore: verification.matchScore,
    reviewComment: verification.reviewComment,
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
  };
}
