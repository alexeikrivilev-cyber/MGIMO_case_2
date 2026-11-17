/**
 * Верификация студбилетов в кабинете сотрудника деканата: очередь заявок
 * на проверку и просмотр фото из ПРИВАТНОГО хранилища (BRIEF v2 §6).
 *
 * Владение: сотрудник видит заявки ТОЛЬКО студентов своего факультета
 * (ARCHITECTURE §4); чужая заявка → NOT_OWNER (→ 404). ADMIN — все.
 *
 * Фото студбилета:
 * - отдаётся ТОЛЬКО буфером + mime (роут строит поток сам), путь из БД
 *   клиенту не уходит никогда;
 * - каждый просмотр фото пишется в аудит (verification.photo_view):
 *   доступ к персональным данным должен быть объясним.
 *
 * Решение по верификации (VERIFIED/REJECTED) НЕ дублируется здесь: это
 * существующий reviewVerification из services/verification.ts. decideStaffVerification
 * — тонкая обёртка: проверяет faculty-scope и делегирует решение ядру,
 * чтобы сотрудник не решал судьбу заявки чужого факультета.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStaffScope, facultyStudentFilter } from './staff-scope';
import { OwnershipError, ValidationError } from '../errors';
import { writeAuditEvent } from '../audit';
import { readIdCardPhoto, ID_CARD_ALLOWED_MIME } from '../storage';
import { reviewVerification, verificationReviewSchema } from './verification';
import type { AuthSession } from '../session';
import type { VerificationStatus } from '@udgu/db';

/** Схема фильтра очереди верификаций (query ?status=). */
export const staffVerificationsFilterSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
});

export type StaffVerificationsFilter = z.infer<typeof staffVerificationsFilterSchema>;

/** Заявка на верификацию в очереди сотрудника. */
export interface StaffVerificationItem {
  readonly id: string;
  readonly status: VerificationStatus;
  readonly student: {
    readonly id: string;
    readonly fullName: string;
    readonly groupName: string;
    readonly faculty: string;
  };
  readonly recognizedLastName: string;
  readonly recognizedFirstName: string;
  readonly recognizedGroupName: string;
  readonly recognizedCardNumber: string;
  readonly matchScore: number | null;
  readonly submittedAt: Date;
}

/** Приоритет статуса в очереди: PENDING всегда сверху. */
const STATUS_PRIORITY: Readonly<Record<VerificationStatus, number>> = {
  PENDING: 0,
  VERIFIED: 1,
  REJECTED: 1,
};

const STUDENT_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  middleName: true,
  faculty: true,
  group: { select: { name: true } },
} as const;

/**
 * Очередь верификаций: сначала PENDING (старые заявки — раньше решения),
 * внутри статуса — по дате подачи.
 */
export async function listStaffVerifications(
  session: AuthSession,
  filter: StaffVerificationsFilter = {},
): Promise<StaffVerificationItem[]> {
  const scope = requireStaffScope(session);
  const parsed = staffVerificationsFilterSchema.safeParse(filter);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный фильтр верификаций.');
  }

  const rows = await prisma().studentVerification.findMany({
    where: {
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...facultyStudentFilter(scope),
    },
    include: { student: { select: STUDENT_SELECT } },
    orderBy: { submittedAt: 'asc' },
  });

  return rows
    .map((row) => ({
      id: row.id,
      status: row.status,
      student: {
        id: row.student.id,
        fullName:
          row.student.middleName === null
            ? `${row.student.lastName} ${row.student.firstName}`
            : `${row.student.lastName} ${row.student.firstName} ${row.student.middleName}`,
        groupName: row.student.group.name,
        faculty: row.student.faculty,
      },
      recognizedLastName: row.recognizedLastName,
      recognizedFirstName: row.recognizedFirstName,
      recognizedGroupName: row.recognizedGroupName,
      recognizedCardNumber: row.recognizedCardNumber,
      matchScore: row.matchScore,
      submittedAt: row.submittedAt,
    }))
    .sort(
      (left, right) =>
        STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] ||
        left.submittedAt.getTime() - right.submittedAt.getTime(),
    );
}

/** Фото студбилета из приватного хранилища: буфер + mime, без пути. */
export async function getStaffVerificationPhoto(
  session: AuthSession,
  verificationId: string,
): Promise<{ buffer: Buffer; mime: string }> {
  const scope = requireStaffScope(session);
  if (typeof verificationId !== 'string' || verificationId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }

  const verification = await prisma().studentVerification.findUnique({
    where: { id: verificationId },
    select: {
      id: true,
      idCardPhotoPath: true,
      student: { select: { faculty: true } },
    },
  });
  // Единый ответ для «не существует» и «чужой факультет» (NOT_OWNER → 404).
  if (
    verification === null ||
    (scope.allFaculties === false && verification.student.faculty !== scope.faculty)
  ) {
    throw new OwnershipError('NOT_OWNER', 'Заявка не найдена или недоступна.');
  }

  const mime = mimeForPhotoPath(verification.idCardPhotoPath);
  const buffer = await readIdCardPhoto(verification.idCardPhotoPath);

  // Аудит просмотра фото: доступ к персональным данным объясним.
  await writeAuditEvent({
    actorUserId: scope.user.id,
    action: 'verification.photo_view',
    entity: 'StudentVerification',
    entityId: verification.id,
    meta: null,
  });

  return { buffer, mime };
}

/**
 * Решение по верификации через СУЩЕСТВУЮЩИЙ reviewVerification (не дубль):
 * здесь только faculty-scope, дальше — ядро со своими правилами
 * (REJECTED требует комментарий, уведомление студенту, аудит).
 */
export async function decideStaffVerification(
  session: AuthSession,
  verificationId: string,
  input: { status: 'VERIFIED' | 'REJECTED'; comment?: string },
) {
  const scope = requireStaffScope(session);
  const parsed = verificationReviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректное решение по верификации.');
  }
  if (typeof verificationId !== 'string' || verificationId === '') {
    throw new ValidationError('INVALID_INPUT', 'Идентификатор заявки не указан.');
  }

  const verification = await prisma().studentVerification.findUnique({
    where: { id: verificationId },
    select: { student: { select: { faculty: true } } },
  });
  if (
    verification === null ||
    (scope.allFaculties === false && verification.student.faculty !== scope.faculty)
  ) {
    throw new OwnershipError('NOT_OWNER', 'Заявка не найдена или недоступна.');
  }

  return reviewVerification(session, verificationId, parsed.data);
}

/** MIME по расширению файла фото (хранилище хранит только относительный путь). */
export function mimeForPhotoPath(pathValue: string): string {
  const extension = pathValue.split('.').pop()?.toLowerCase() ?? '';
  for (const [mime, candidate] of Object.entries(ID_CARD_ALLOWED_MIME)) {
    if (candidate === extension) {
      return mime;
    }
  }
  // Неизвестное расширение: отдаём как октет — браузер не отрисует
  // «не тот» файл как изображение, а Content-Type останется честным.
  return 'application/octet-stream';
}
