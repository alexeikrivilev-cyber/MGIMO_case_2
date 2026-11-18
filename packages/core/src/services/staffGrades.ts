/**
 * Успеваемость студента для сотрудника деканата (BRIEF v2 §7, MCP-сервер):
 * сотрудник по ЛОГИНУ студента видит его оценки, зачёты и сводку.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СЕРВИС, А НЕ getMyGrades:
 * getMyGrades резолвит studentId из сессии — это кабинет студента, там
 * «свой» доступ. Сотруднику деканата нужно смотреть данные ДРУГОГО
 * человека, поэтому владение здесь проверяется иначе: через область
 * видимости института (requireStaffScope), а не через владельца сессии.
 * Это ровно та схема, по которой работают staffRequests/staffSchedule:
 * отдельная функция со своей проверкой вместо общего сервиса.
 *
 * ВЛАДЕНИЕ И АНТИ-ПЕРЕБОР:
 *   - студент своего института → результат;
 *   - студент чужого института → NOT_OWNER;
 *   - студент не найден → ТОТ ЖЕ NOT_OWNER.
 * Ответ намеренно не различает «нет такого» и «не вашего института»:
 * иначе по логинам можно было бы перебором узнать, кто в вузе учится.
 *
 * ГЕЙТ ВЕРИФИКАЦИИ здесь НЕ применяется: он защищает кабинет СТУДЕНТА
 * (до сверки студбилета оценки скрыты от него самого). Сотрудник
 * деканата — должностное лицо, которому успеваемость нужна для работы
 * с заявками и справками; скрывать от него факт наличия оценок значило
 * бы ломать кабинет STAFF ради гейта, который о студенте.
 *
 * Результат — та же структура, что у студента (семестры/оценки + сводка),
 * чтобы сотрудник и студент видели ОДНИ И ТЕ ЖЕ числа: группировка и
 * арифметика берутся из services/grades, а не дублируются здесь.
 */
import { z } from 'zod';
import { prisma } from '../db';
import { requireStaffScope } from './staff-scope';
import { OwnershipError, ValidationError } from '../errors';
import { firstIssues } from '../validation';
import { groupGradesBySemester, summarizeGrades, toGradeEntry, type GradeRow } from './grades';
import type { AuthSession } from '../session';

/** Вход инструмента: логин студента (учётная запись кабинета). */
export const staffStudentLoginSchema = z.object({
  login: z.string().trim().min(1, 'Укажите логин студента.').max(64, 'Логин слишком длинный.'),
});

export type StaffStudentLoginInput = z.infer<typeof staffStudentLoginSchema>;

/** Студент в отчёте сотрудника: кто это и откуда (без контактов). */
export interface StaffStudentCard {
  readonly login: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly faculty: string;
  readonly course: number;
  readonly direction: string;
}

/** Успеваемость студента глазами сотрудника деканата. */
export interface StaffStudentGrades {
  readonly student: StaffStudentCard;
  readonly semesters: ReturnType<typeof groupGradesBySemester>;
  readonly summary: ReturnType<typeof summarizeGrades>;
}

const STUDENT_INCLUDE = {
  user: { select: { login: true } },
  group: { select: { name: true } },
} as const;

function fullNameOf(student: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return student.middleName === null
    ? `${student.lastName} ${student.firstName}`
    : `${student.lastName} ${student.firstName} ${student.middleName}`;
}

/**
 * Успеваемость студента по логину для сотрудника деканата.
 *
 * Бросает:
 * - OwnershipError STAFF_ONLY — студент, преподаватель, сотрудник без
 *   факультета (кабинет деканата не для них);
 * - OwnershipError NOT_OWNER — студент чужого института или не найден
 *   (единый обобщённый ответ, анти-перебор);
 * - ValidationError INVALID_INPUT — пустой/слишком длинный логин.
 */
export async function listStudentGradesForStaff(
  session: AuthSession,
  input: StaffStudentLoginInput,
): Promise<StaffStudentGrades> {
  const scope = requireStaffScope(session);
  const parsed = staffStudentLoginSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('INVALID_INPUT', 'Некорректный логин студента.', firstIssues(parsed.error));
  }
  const { login } = parsed.data;

  const student = await prisma().student.findFirst({
    where: { user: { login } },
    include: STUDENT_INCLUDE,
  });

  // Единый ответ для «не существует» и «чужой институт»: существование
  // студента в другом факультете не подтверждается и не отрицается.
  if (student === null || (scope.allFaculties === false && student.faculty !== scope.faculty)) {
    throw new OwnershipError('NOT_OWNER', 'Студент не найден или недоступен.');
  }

  const grades = await prisma().grade.findMany({
    where: { studentId: student.id },
    include: { subject: { select: { name: true, code: true } } },
    orderBy: [{ date: 'desc' }],
  });

  const entries = (grades as GradeRow[]).map(toGradeEntry);

  return {
    student: {
      login: student.user.login,
      fullName: fullNameOf(student),
      groupName: student.group.name,
      faculty: student.faculty,
      course: student.course,
      direction: student.direction,
    },
    semesters: groupGradesBySemester(entries),
    summary: summarizeGrades(entries),
  };
}
