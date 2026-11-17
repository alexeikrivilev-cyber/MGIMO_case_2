/**
 * Область видимости сотрудника деканата (ARCHITECTURE §4, BRIEF v2 §6).
 *
 * ЕДИНАЯ точка правила «кто есть сотрудник деканата и какие данные он
 * видит» — все сервисы кабинета STAFF начинаются с requireStaffScope:
 *
 *   - роль STAFF ИЛИ ADMIN → требование роли (requireStaffAccess);
 *   - сотрудник деканата = STAFF с непустым users.faculty;
 *   - ADMIN (faculty = null) видит ВСЕ факультеты;
 *   - преподаватель (STAFF + профиль Teacher, faculty = null) в кабинет
 *     деканата НЕ попадает: его кабинет — отдельная фича P2. Fail-closed:
 *     без faculty сотрудник не видит чужих данные вообще (STAFF_ONLY);
 *   - студент — тоже STAFF_ONLY (ответ 404, не 403: раздел для него
 *     «не существует», см. lib/session.ts mapCoreError).
 *
 * Функция намеренно ЧИСТАЯ (данные берутся из сессии, БД не нужна):
 * faculty попадает в SessionUser при validateSession — один источник
 * истины, и его нельзя подменить снаружи.
 */
import { requireStaffAccess } from '../ownership';
import { OwnershipError } from '../errors';
import type { AuthSession, SessionUser } from '../session';

/** Область видимости сотрудника деканата. */
export interface StaffScope {
  readonly user: SessionUser;
  /** Факультет сотрудника; null только у ADMIN (все факультеты). */
  readonly faculty: string | null;
  /** true только для ADMIN: данные всех факультетов без фильтра. */
  readonly allFaculties: boolean;
}

/**
 * Резолвит область видимости сотрудника из сессии.
 *
 * Бросает OwnershipError:
 * - STAFF_ONLY — не сотрудник/админ (студент, преподаватель без faculty);
 * - FORBIDDEN_ROLE — роль не STAFF/ADMIN (та же семантика, что в
 *   requireStaffAccess; сохраняем единый код STAFF_ONLY для всех
 *   «не своих» случаев).
 */
export function requireStaffScope(session: AuthSession): StaffScope {
  const user = requireStaffAccess(session);

  // ADMIN видит всё: faculty не требуется.
  if (user.role === 'ADMIN') {
    return { user, faculty: null, allFaculties: true };
  }

  // STAFF без факультета = преподаватель или непривязанный сотрудник:
  // в кабинет деканата не пускаем (fail-closed).
  if (typeof user.faculty !== 'string' || user.faculty.trim() === '') {
    throw new OwnershipError(
      'STAFF_ONLY',
      'Операция доступна только сотрудникам деканата.',
    );
  }

  return { user, faculty: user.faculty, allFaculties: false };
}

/**
 * Фильтр студентов по факультету сотрудника: для ADMIN — все студенты,
 * для сотрудника — только его институт. Возвращается готовое условие
 * Prisma для связи `student: { faculty }`, чтобы ни один сервис не
 * собирал условие вручную (единая реализация правила §4).
 */
export function facultyStudentFilter(
  scope: StaffScope,
): { student: { faculty: string } } | Record<string, never> {
  return scope.allFaculties ? {} : { student: { faculty: scope.faculty as string } };
}

/**
 * Проверяет, что факультет попадает в область видимости сотрудника.
 * Используется для сущностей, привязанных к факультету косвенно
 * (группа объявления, студент верификации): чужой факультет →
 * NOT_OWNER (→ 404, ответ не отличается от «не существует»).
 */
export function assertFacultyInScope(scope: StaffScope, faculty: string | null): void {
  if (scope.allFaculties) {
    return;
  }
  if (faculty !== scope.faculty) {
    throw new OwnershipError(
      'NOT_OWNER',
      'Запрошенные данные не найдены.',
    );
  }
}
