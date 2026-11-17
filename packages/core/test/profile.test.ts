/**
 * Тесты профиля студента: состав DTO, инициалы аватара, статус
 * верификации, запрет доступа не-студенту.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMyProfile, OwnershipError, type AuthSession } from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  authSessionFor,
} from './helpers.js';

let studentSession: AuthSession;
let staffSession: AuthSession;

test.before(async () => {
  await resetTestData();
  const group = await createGroup('ПРО-61-1');
  const student = await createStudent('student-profile', group.id, {
    lastName: 'Профильный',
    firstName: 'Пётр',
    middleName: null,
  });
  const staff = await createUser('staff-profile', 'STAFF');

  studentSession = await authSessionFor(student.userId);
  staffSession = await authSessionFor(staff.id);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('профиль: состав, инициалы, статус верификации до подачи', async () => {
  const profile = await getMyProfile(studentSession);

  assert.equal(profile.fullName, 'Профильный Пётр', 'без отчества — без отчества');
  assert.equal(profile.avatarInitials, 'ПП');
  assert.equal(profile.groupName, 'ПРО-61-1');
  assert.equal(profile.course, 3);
  assert.equal(profile.direction, '09.03.03 Прикладная информатика');
  assert.equal(profile.email, 'student-profile@udsu.ru');
  assert.match(profile.studentCardNumber, /^UDGU-2023-\d{3}$/);
  assert.equal(profile.verificationStatus, 'NO_APPLICATION', 'заявки на верификацию ещё нет');
});

test('профиль: ФИО с отчеством', async () => {
  const group = await createGroup('ПРО-62-1');
  const student = await createStudent('student-profile-2', group.id, {
    lastName: 'Иванов',
    firstName: 'Александр',
    middleName: 'Дмитриевич',
  });
  const session = await authSessionFor(student.userId);

  const profile = await getMyProfile(session);
  assert.equal(profile.fullName, 'Иванов Александр Дмитриевич');
  assert.equal(profile.avatarInitials, 'ИА');
});

test('профиль: сотруднику деканата недоступен', async () => {
  await assert.rejects(
    () => getMyProfile(staffSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});
