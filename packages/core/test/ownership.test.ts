/**
 * Тесты авторизации владения данными (анти-IDOR).
 *
 * Самый критичный модуль безопасности: проверяем, что запрос с сессией
 * одного студента не проходит для данных другого, что сотрудники не
 * проходят в студенческие операции, и что невалидная сессия не проходит
 * никуда. Сервисный уровень (возврат только своих данных) проверяется
 * отдельным сквозным тестом — test/idor.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireUser,
  requireRole,
  requireStudent,
  requireOwnStudent,
  requireStaffAccess,
  OwnershipError,
  type SessionUser,
  type AuthSession,
} from '../src/index.js';

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    login: 'student1',
    role: 'STUDENT',
    studentId: 'student-1',
    teacherId: null,
    faculty: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionUser> = {}): AuthSession {
  return {
    user: makeUser(overrides),
    session: {
      id: 'session-1',
      userId: makeUser(overrides).id,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      ip: '127.0.0.1',
      userAgent: 'node:test',
    },
  };
}

test('requireUser: валидная сессия проходит, пустая — нет', () => {
  assert.equal(requireUser(makeSession()).id, 'user-1');
  assert.equal(requireUser(makeSession({ id: 'user-42', login: 'other' })).id, 'user-42');

  for (const broken of [
    {} as AuthSession,
    { user: null } as unknown as AuthSession,
    { user: {} } as unknown as AuthSession,
  ]) {
    assert.throws(
      () => requireUser(broken),
      (error: unknown) => error instanceof OwnershipError && error.code === 'UNAUTHENTICATED',
    );
  }
});

test('requireRole: точное совпадение роли', () => {
  assert.equal(requireRole(makeSession({ role: 'ADMIN' }), 'ADMIN').role, 'ADMIN');
  assert.throws(
    () => requireRole(makeSession({ role: 'STUDENT' }), 'ADMIN'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'FORBIDDEN_ROLE',
  );
});

test('requireStudent: только студент с профилем', () => {
  const { user, studentId } = requireStudent(makeSession());
  assert.equal(studentId, 'student-1');
  assert.equal(user.role, 'STUDENT');

  // Сотрудник деканата — не студент.
  assert.throws(
    () => requireStudent(makeSession({ role: 'STAFF', studentId: null })),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
  // Студент без профиля (битые данные) — тоже нет.
  assert.throws(
    () => requireStudent(makeSession({ studentId: null })),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});

test('requireOwnStudent: свой идентификатор проходит, чужой — нет', () => {
  const session = makeSession({ studentId: 'student-1' });

  assert.equal(requireOwnStudent(session, 'student-1'), 'student-1');

  // Классическая IDOR-атака: подставить чужой идентификатор.
  for (const foreign of ['student-2', '', null, undefined, 42, 'STUDENT-1']) {
    assert.throws(
      () => requireOwnStudent(session, foreign),
      (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
      `идентификатор ${String(foreign)} должен быть отклонён`,
    );
  }
});

test('requireOwnStudent: студент без профиля не проходит даже со своим id', () => {
  const session = makeSession({ studentId: null });
  assert.throws(
    () => requireOwnStudent(session, 'student-1'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});

test('requireStaffAccess: STAFF и ADMIN проходят, студент — нет', () => {
  assert.equal(requireStaffAccess(makeSession({ role: 'STAFF' })).role, 'STAFF');
  assert.equal(requireStaffAccess(makeSession({ role: 'ADMIN' })).role, 'ADMIN');

  assert.throws(
    () => requireStaffAccess(makeSession({ role: 'STUDENT' })),
    (error: unknown) => error instanceof OwnershipError && error.code === 'STAFF_ONLY',
  );
  assert.throws(
    () => requireStaffAccess({} as AuthSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'UNAUTHENTICATED',
  );
});

test('сообщения OwnershipError обобщены и не раскрывают существование объектов', () => {
  const session = makeSession({ studentId: 'student-1' });
  try {
    requireOwnStudent(session, 'student-2');
    assert.fail('ожидалась ошибка');
  } catch (error) {
    assert.ok(error instanceof OwnershipError);
    assert.ok(!error.message.includes('student-2'), 'в сообщении нет чужого идентификатора');
    assert.ok(error.message.length > 0);
  }
});
