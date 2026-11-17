/**
 * Профиль студента. Доступен всегда (в том числе до верификации) —
 * BRIEF v2: «До верификации студент видит свой профиль, расписание своей
 * группы и общедоступную информацию».
 *
 * Функция принимает сессию и сама резолвит studentId; идентификатор
 * студента извне не принимается (правило ownership.ts).
 */
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import { ValidationError } from '../errors';
import type { AuthSession } from '../session';
import type { VerificationStatus } from '@udgu/db';

export interface MyProfile {
  readonly studentId: string;
  readonly fullName: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly faculty: string;
  readonly direction: string;
  readonly course: number;
  readonly groupName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly studentCardNumber: string;
  /** Статус верификации студбилета; NO_APPLICATION — заявки не было. */
  readonly verificationStatus: VerificationStatus | 'NO_APPLICATION';
  /** Инициалы для аватара: «ИА». */
  readonly avatarInitials: string;
}

function initialsOf(lastName: string, firstName: string): string {
  return `${lastName.trim().charAt(0)}${firstName.trim().charAt(0)}`.toUpperCase();
}

function fullNameOf(lastName: string, firstName: string, middleName: string | null): string {
  return middleName === null
    ? `${lastName} ${firstName}`
    : `${lastName} ${firstName} ${middleName}`;
}

export async function getMyProfile(session: AuthSession): Promise<MyProfile> {
  const { studentId } = requireStudent(session);

  const student = await prisma().student.findUnique({
    where: { id: studentId },
    include: {
      group: { select: { name: true } },
      verification: { select: { status: true } },
    },
  });

  if (student === null) {
    // Сессия ссылается на отсутствующий профиль: гонка удаления или
    // повреждение данных. Отдаём честную ошибку, а не чужие данные.
    throw new ValidationError('NOT_FOUND', 'Профиль студента не найден. Обратитесь в деканат.');
  }

  return {
    studentId: student.id,
    fullName: fullNameOf(student.lastName, student.firstName, student.middleName),
    lastName: student.lastName,
    firstName: student.firstName,
    middleName: student.middleName,
    faculty: student.faculty,
    direction: student.direction,
    course: student.course,
    groupName: student.group.name,
    email: student.email,
    phone: student.phone,
    studentCardNumber: student.studentCardNumber,
    verificationStatus: student.verification?.status ?? 'NO_APPLICATION',
    avatarInitials: initialsOf(student.lastName, student.firstName),
  };
}
