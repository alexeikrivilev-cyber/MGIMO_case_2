/**
 * Справочник преподавателей (BRIEF v2, требование «расписание
 * преподавателей»): студент видит, кто teaches его группы, когда
 * преподаватель занят парами и когда у него часы приёма.
 *
 * Доступ: любой авторизованный пользователь кабинета (requireUser) —
 * справочник общедоступен внутри кабинета. Идентификатор преподавателя
 * НЕ является идентификатором владения данными, поэтому проверка
 * владения здесь не применяется: она бы ничего не значила и только
 * мешала бы читателю справочника. Вместо неё — проверка существования
 * ссылки (NOT_FOUND).
 *
 * Все функции принимают сессию (единый контракт сервисов core): так
 * справочник остаётся доступным только вошедшим пользователям, и
 * маршрут API не может отдать его анонимно.
 */
import { prisma } from '../db';
import { requireUser } from '../ownership';
import { ValidationError } from '../errors';
import type { AuthSession } from '../session';
import { getTeacherOfficeHours, getTeacherSchedule } from './schedule';
import type { TeacherLesson, TeacherOfficeHour } from './schedule';

/** Преподаватель в списке: ФИО, кафедра, должность. */
export interface TeacherListItem {
  readonly id: string;
  readonly fullName: string;
  readonly department: string;
  readonly position: string;
}

/** Карточка преподавателя: расписание на период + часы приёма. */
export interface TeacherCard {
  readonly id: string;
  readonly fullName: string;
  readonly department: string;
  readonly position: string;
  readonly lessons: readonly TeacherLesson[];
  readonly officeHours: readonly TeacherOfficeHour[];
}

function fullNameOf(teacher: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}): string {
  return teacher.middleName === null
    ? `${teacher.lastName} ${teacher.firstName}`
    : `${teacher.lastName} ${teacher.firstName} ${teacher.middleName}`;
}

const TEACHER_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  middleName: true,
  department: true,
  position: true,
} as const;

/**
 * Список преподавателей вуза (алфавитно по фамилии). Фильтровать по
 * кафедре/факультету — задача кабинета сотрудника (P2); студенту важен
 * весь список, чтобы найти своего преподавателя.
 */
export async function listTeachers(session: AuthSession): Promise<TeacherListItem[]> {
  requireUser(session);
  const teachers = await prisma().teacher.findMany({
    select: TEACHER_SELECT,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return teachers.map((teacher) => ({
    id: teacher.id,
    fullName: fullNameOf(teacher),
    department: teacher.department,
    position: teacher.position,
  }));
}

/**
 * Карточка преподавателя: расписание на период [dateFrom, dateTo]
 * (включительно) и часы приёма. Несуществующий идентификатор —
 * ValidationError NOT_FOUND (404), а не пустая карточка: студенту
 * понятнее «преподаватель не найден», чем пустой экран.
 */
export async function getTeacherCard(
  session: AuthSession,
  teacherId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<TeacherCard> {
  requireUser(session);
  if (typeof teacherId !== 'string' || teacherId === '') {
    throw new ValidationError('NOT_FOUND', 'Преподаватель не найден.');
  }

  const teacher = await prisma().teacher.findUnique({
    where: { id: teacherId },
    select: TEACHER_SELECT,
  });
  if (teacher === null) {
    throw new ValidationError('NOT_FOUND', 'Преподаватель не найден.');
  }

  const [lessons, officeHours]: [TeacherLesson[], TeacherOfficeHour[]] = await Promise.all([
    getTeacherSchedule(teacher.id, dateFrom, dateTo),
    getTeacherOfficeHours(teacher.id),
  ]);

  return {
    id: teacher.id,
    fullName: fullNameOf(teacher),
    department: teacher.department,
    position: teacher.position,
    lessons,
    officeHours,
  };
}
