/**
 * Авторизация владения данными (анти-IDOR).
 *
 * ГЛАВНОЕ АРХИТЕКТУРНОЕ ПРАВИЛО ПРОЕКТА (ARCHITECTURE §3, BRIEF, ACCEPTANCE):
 * ни один сервис packages/core/services не принимает studentId (или другой
 * идентификатор владельца данных) «снаружи» — все сервисы принимают
 * session/user и сами резолвят studentId из сессии. Исключение —
 * requireOwnStudent(session, requestedStudentId), который существует
 * ровно для одной задачи: отклонить запрос, если запрошенный
 * идентификатор не принадлежит сессии. Подмена ID в URL не открывает
 * чужие данные — это проверяется тестом packages/core/test/idor.test.ts.
 *
 * Сервисы, которым нужен доступ сотрудника деканата к чужим данным
 * (кабинет STAFF, P2), реализуются ОТДЕЛЬНЫМИ функциями со своей
 * проверкой requireStaffAccess — они не проходят через requireOwnStudent.
 *
 * Все функции бросают OwnershipError с машинным кодом и обобщённым
 * сообщением: ответ API не отличается для «не существует» и «не твоё»,
 * чтобы нельзя было перебором находить чужие идентификаторы.
 */
import { OwnershipError } from './errors';
import type { AuthSession, SessionUser } from './session';

/**
 * Проверяет, что сессия валидна и несёт пользователя.
 * Возвращает пользователя сессии (role, studentId, teacherId).
 */
export function requireUser(session: AuthSession): SessionUser {
  const user = session?.user;
  if (user === undefined || user === null || typeof user.id !== 'string' || user.id === '') {
    throw new OwnershipError('UNAUTHENTICATED', 'Требуется вход в систему.');
  }
  return user;
}

/** Проверяет точную роль пользователя сессии. */
export function requireRole(session: AuthSession, role: SessionUser['role']): SessionUser {
  const user = requireUser(session);
  if (user.role !== role) {
    throw new OwnershipError('FORBIDDEN_ROLE', 'Недостаточно прав для операции.');
  }
  return user;
}

/**
 * Проверяет, что сессия принадлежит студенту, и возвращает его studentId.
 * Сотрудники и админы проходят мимо: их доступ к студенческим данным
 * реализуется в кабинете деканата (P2) через requireStaffAccess.
 */
export function requireStudent(session: AuthSession): { user: SessionUser; studentId: string } {
  const user = requireUser(session);
  if (user.role !== 'STUDENT' || user.studentId === null) {
    throw new OwnershipError('NOT_A_STUDENT', 'Операция доступна только студенту.');
  }
  return { user, studentId: user.studentId };
}

/**
 * Проверяет, что сессия принадлежит преподавателю, и возвращает его
 * teacherId.
 *
 * Преподаватель в этой системе — учётная запись с привязанным профилем
 * Teacher (в сидере роль STAFF + teacherId). Студент, сотрудник деканата
 * и админ БЕЗ профиля преподавателя не проходят: их инструменты живут в
 * своих разделах (кабинет студента, кабинет деканата), а раздел
 * преподавателя (учебные планы, RAG-ассистент) закрыт для них.
 *
 * Как и остальные функции пакета, не принимает идентификатор извне:
 * teacherId берётся только из сессии.
 */
export function requireTeacher(session: AuthSession): { user: SessionUser; teacherId: string } {
  const user = requireUser(session);
  if (typeof user.teacherId !== 'string' || user.teacherId === '') {
    throw new OwnershipError('NOT_A_TEACHER', 'Операция доступна только преподавателю.');
  }
  return { user, teacherId: user.teacherId };
}

/**
 * Проверяет, что запрошенный studentId принадлежит сессии.
 *
 * Это ЕДИНСТВЕННАЯ функция пакета, которая сравнивает приходящий извне
 * идентификатор с владельцем сессии. Fail-closed: отсутствующий или
 * нестроковый идентификатор считается чужим.
 */
export function requireOwnStudent(session: AuthSession, requestedStudentId: unknown): string {
  const { studentId } = requireStudent(session);
  if (typeof requestedStudentId !== 'string' || requestedStudentId !== studentId) {
    throw new OwnershipError('NOT_OWNER', 'Запрошенные данные не принадлежат вашей учётной записи.');
  }
  return studentId;
}

/** Проверяет доступ сотрудника деканата или администратора. */
export function requireStaffAccess(session: AuthSession): SessionUser {
  const user = requireUser(session);
  if (user.role !== 'STAFF' && user.role !== 'ADMIN') {
    throw new OwnershipError('STAFF_ONLY', 'Операция доступна только сотрудникам деканата.');
  }
  return user;
}
