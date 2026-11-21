/**
 * Крайние случаи с битыми ссылками (волна 6): сервисы отвечают честной
 * ошибкой владения или честным ответом, но не падают неожиданным
 * исключением и не отдают чужие данные.
 *
 * Здесь зафиксирован кейс: пользователь остаётся в системе (роль
 * STUDENT), а запись Student удалена (отчисление, чистка данных).
 * Сессия выживает — User не каскадится, — но studentId в ней больше
 * нет: validateSession читает профиль заново и отдаёт null. Дальше все
 * сервисы должны отсекать по NOT_A_STUDENT (fail-closed), а не искать
 * данные по мёртвой ссылке.
 *
 * Соседние кейсы брифа закрыты в доменных файлах:
 * - MOVED без movedToDate — schedule.test.ts;
 * - заявка с пустым formData — requests.test.ts (валидация схемы);
 * - больничный с dateTo < dateFrom — sickleave.test.ts;
 * - STAFF без профиля преподавателя и пропавший файл плана —
 *   study-plan.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askAssistant,
  createMyRequest,
  createMySickLeave,
  getMyAcademicSummary,
  getMyGrades,
  getMyNextLesson,
  getMyNotifications,
  getMyProfile,
  getMyRequests,
  listMyConversations,
  OwnershipError,
  type AuthSession,
} from '../src/index.js';
import { prisma } from '../src/db.js';
import {
  closeTestDb,
  createGroup,
  createStudent,
  authSessionFor,
  resetTestData,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

let deletedStudent: AuthSession;

test.before(async () => {
  await resetTestData();

  const group = await createGroup('БИТ-11-1', FACULTY);
  const fixture = await createStudent('edge-deleted-student', group.id);

  // Профиль удаляем ДО создания сессии: validateSession читает
  // пользователя заново, поэтому studentId в новой сессии — честное
  // «профиля нет». Оценки и заявки снимает каскад (Grade → Cascade).
  await prisma().student.delete({ where: { id: fixture.studentId } });
  deletedStudent = await authSessionFor(fixture.userId);

  assert.equal(deletedStudent.user.role, 'STUDENT', 'роль пользователя осталась');
  assert.equal(deletedStudent.user.studentId, null, 'ссылки на удалённый профиль в сессии нет');
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('сессия удалённого студента: сервисы отсекают по NOT_A_STUDENT, а не падают', async () => {
  const calls: readonly (() => Promise<unknown>)[] = [
    () => getMyProfile(deletedStudent),
    () => getMyGrades(deletedStudent),
    () => getMyAcademicSummary(deletedStudent),
    () => getMyRequests(deletedStudent),
    () => getMyNextLesson(deletedStudent),
    () => createMyRequest(deletedStudent, { type: 'REFERENCE', formData: { purpose: 'тест' } }),
    () => createMySickLeave(deletedStudent, { dateFrom: '2026-12-10', dateTo: '2026-12-12' }),
    // Переписка закрыта гейтом верификации, но владение проверяется
    // РАНЬШЕ гейта: requireStudent отсекает мёртвую ссылку на профиль.
    () => listMyConversations(deletedStudent),
  ];
  for (const call of calls) {
    await assert.rejects(
      call,
      (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
      'доступ только владельцу существующего профиля',
    );
  }
});

test('сессия удалённого студента: уведомления привязаны к пользователю, не к профилю', async () => {
  // Лента уведомлений завязана на User: она не падает и не отдаёт чужих
  // данных — просто пуста.
  assert.deepEqual(await getMyNotifications(deletedStudent), []);
});

test('сессия удалённого студента: ассистент тоже fail-closed', async () => {
  // Вопрос про оценки уходит в requireStudent внутри сервиса
  // успеваемости: заглушка гейта верификации тут не при чём, владение
  // проверяется раньше.
  await assert.rejects(
    () => askAssistant(deletedStudent, 'Какие у меня долги?'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});
