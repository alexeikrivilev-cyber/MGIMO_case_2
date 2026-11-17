/**
 * Тесты верификации студбилета: мок-распознавание по реестру, статусы
 * PENDING/REJECTED, приватное хранилище фото, гейт доступа, решение
 * сотрудника (только STAFF/ADMIN).
 *
 * Фото пишутся во временный каталог (STORAGE_DIR) — реальное хранилище
 * репозитория не трогается.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  submitVerification,
  getMyVerification,
  reviewVerification,
  getVerificationGate,
  VerificationRequiredError,
  ValidationError,
  OwnershipError,
  recognizeIdCard,
  notFoundRecognition,
  MOCK_OCR_CONFIDENCE,
  idCardRoot,
  idCardPhotoRelativePath,
  ID_CARD_DIR_NAME,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  createIdentityRegistryEntry,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';

const FACULTY = 'Институт математики, информационных технологий и физики';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

async function studentIdByLogin(login: string): Promise<string> {
  const student = await prisma().student.findFirstOrThrow({
    where: { user: { login } },
    select: { id: true },
  });
  return student.id;
}

async function userIdByLogin(login: string): Promise<string> {
  const user = await prisma().user.findUniqueOrThrow({
    where: { login },
    select: { id: true },
  });
  return user.id;
}

let storageDir: string;
let previousStorageDir: string | undefined;
let studentSession: AuthSession;
let staffSession: AuthSession;
let studentSession2: AuthSession;
let studentId2: string;

test.before(async () => {
  await resetTestData();

  previousStorageDir = process.env.STORAGE_DIR;
  storageDir = await mkdtemp(join(tmpdir(), 'udgu-verify-'));
  process.env.STORAGE_DIR = storageDir;

  const group = await createGroup('ВЕР-51-1', FACULTY);
  const student = await createStudent('student-verify', group.id, { lastName: 'Верифицируемый' });
  const student2 = await createStudent('student-verify2', group.id, { lastName: 'Второй' });
  const staff = await createUser('staff-verify', 'STAFF');
  const studentUser = await createUser('student-plain', 'STUDENT');

  studentId2 = student2.studentId;

  // Реестр: карточка нашего студента (совпадает группа) и карточка
  // из ДРУГОЙ группы (для проверки понижения matchScore).
  const foreignGroup = await createGroup('ВЕР-77-7', 'Институт языка и литературы');
  await createIdentityRegistryEntry({
    cardNumber: 'PI-2023-001',
    lastName: 'Верифицируемый',
    firstName: 'Студент',
    groupId: group.id,
    groupName: group.name,
  });
  await createIdentityRegistryEntry({
    cardNumber: 'PI-2023-777',
    lastName: 'Другой',
    firstName: 'Человек',
    groupId: foreignGroup.id,
    groupName: foreignGroup.name,
  });

  studentSession = await authSessionFor(student.userId);
  studentSession2 = await authSessionFor(student2.userId);
  staffSession = await authSessionFor(staff.id);
  await authSessionFor(studentUser.id); // сессия обычного студента для проверки роли
});

test.after(async () => {
  if (previousStorageDir === undefined) {
    delete process.env.STORAGE_DIR;
  } else {
    process.env.STORAGE_DIR = previousStorageDir;
  }
  await rm(storageDir, { recursive: true, force: true });
  await resetTestData();
  await closeTestDb();
});

test('мок-распознавание: найденный номер даёт поля реестра, несуществующий — notFound', () => {
  const registry = [
    { cardNumber: 'PI-2023-001', lastName: 'Верифицируемый', firstName: 'Студент', middleName: null, groupName: 'ВЕР-51-1' },
  ];

  const found = recognizeIdCard('PI-2023-001', registry);
  assert.equal(found.found, true);
  assert.equal(found.lastName, 'Верифицируемый');
  assert.equal(found.groupName, 'ВЕР-51-1');
  assert.equal(found.confidence, MOCK_OCR_CONFIDENCE);

  // Регистр и пробелы не важны, детерминированность — да.
  assert.deepEqual(recognizeIdCard(' pi-2023-001 ', registry), found);

  const missing = recognizeIdCard('XX-0000-999', registry);
  assert.equal(missing.found, false);
  assert.equal(missing.lastName, '');
  assert.equal(missing.groupName, '');
  assert.equal(missing.confidence, 0);
  assert.deepEqual(recognizeIdCard('XX-0000-999', registry), notFoundRecognition('XX-0000-999'));
});

test('submit: номер в реестре → PENDING, фото в приватном хранилище', async () => {
  const verification = await submitVerification(studentSession, {
    cardNumber: 'PI-2023-001',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });

  assert.equal(verification.status, 'PENDING');
  assert.equal(verification.recognizedLastName, 'Верифицируемый');
  assert.equal(verification.recognizedFirstName, 'Студент');
  assert.equal(verification.recognizedGroupName, 'ВЕР-51-1');
  assert.equal(verification.recognizedCardNumber, 'PI-2023-001');
  assert.equal(verification.matchScore, MOCK_OCR_CONFIDENCE);
  assert.equal(verification.reviewComment, null);
  assert.equal(verification.reviewedAt, null);

  // В DTO нет пути к фото — клиенту он не нужен.
  assert.ok(!('idCardPhotoPath' in verification));

  // Файл реально лежит в приватном хранилище вне webroot.
  const studentId = await studentIdByLogin('student-verify');
  const row = await prisma().studentVerification.findUniqueOrThrow({ where: { studentId } });
  assert.match(row.idCardPhotoPath, /^id-cards\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/);
  const stored = await readFile(join(idCardRoot(), row.idCardPhotoPath.slice(`${ID_CARD_DIR_NAME}/`.length)));
  assert.deepEqual(stored, JPEG);
  const stats = await stat(join(storageDir, 'id-cards'));
  assert.ok(stats.isDirectory(), 'хранилище создано в STORAGE_DIR');
});

test('submit: номер не в реестре → REJECTED, ничего не выдумано', async () => {
  const group = await createGroup('ВЕР-52-1', FACULTY);
  const student = await createStudent('student-verify-unknown', group.id);
  const session = await authSessionFor(student.userId);

  const verification = await submitVerification(session, {
    cardNumber: 'XX-0000-999',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });

  assert.equal(verification.status, 'REJECTED');
  assert.equal(verification.recognizedLastName, '', 'ФИО не выдуманы');
  assert.equal(verification.recognizedGroupName, '');
  assert.equal(verification.matchScore, 0);
  assert.match(verification.reviewComment ?? '', /не найден в реестре/);
});

test('submit: чужой номер карточки из реестра → PENDING с пониженным баллом', async () => {
  const group = await createGroup('ВЕР-53-1', FACULTY);
  const student = await createStudent('student-verify-foreign', group.id);
  const session = await authSessionFor(student.userId);

  const verification = await submitVerification(session, {
    cardNumber: 'PI-2023-777',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });

  assert.equal(verification.status, 'PENDING');
  assert.equal(verification.recognizedGroupName, 'ВЕР-77-7', 'распознана группа из реестра');
  assert.equal(verification.matchScore, 0.55, 'группа не совпадает — сигнал проверяющему');
});

test('submit: невалидные данные → ValidationError', async () => {
  const garbage: unknown[] = [
    { cardNumber: 'PI', photoBuffer: JPEG, mime: 'image/jpeg' },
    { cardNumber: 'PI-2023-001', photoBuffer: JPEG, mime: 'image/gif' },
    { cardNumber: 'PI 2023 001', photoBuffer: JPEG, mime: 'image/jpeg' },
    { cardNumber: 'PI-2023-001', photoBuffer: 'не буфер', mime: 'image/jpeg' },
    { cardNumber: 'PI-2023-001', photoBuffer: JPEG },
  ];

  for (const input of garbage) {
    await assert.rejects(
      () => submitVerification(studentSession2, input as never),
      (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
    );
  }
});

test('submit: повторная подача после отказа разрешена, после одобрения — нет', async () => {
  const group = await createGroup('ВЕР-54-1', FACULTY);
  const student = await createStudent('student-verify-resubmit', group.id);
  const session = await authSessionFor(student.userId);

  const first = await submitVerification(session, {
    cardNumber: 'XX-0000-999',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });
  assert.equal(first.status, 'REJECTED');

  const second = await submitVerification(session, {
    cardNumber: 'PI-2023-001',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });
  assert.equal(second.status, 'PENDING', 'после отказа можно податься снова');
  assert.equal(second.id, first.id, 'заявка обновляется, а не дублируется');

  const staffUser = await createUser('staff-verify-2', 'ADMIN');
  const staffSession2 = await authSessionFor(staffUser.id);
  await reviewVerification(staffSession2, second.id, { status: 'VERIFIED', comment: 'ок' });

  await assert.rejects(
    () => submitVerification(session, { cardNumber: 'PI-2023-001', photoBuffer: JPEG, mime: 'image/jpeg' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );
});

test('гейт: до верификации закрыты успеваемость и переписка', async () => {
  const gate = await getVerificationGate(studentSession2);
  assert.equal(gate.verified, false);
  assert.deepEqual([...gate.locked], ['grades', 'messaging']);
  assert.ok(gate.unlocked.includes('profile'));
  assert.ok(gate.unlocked.includes('schedule'));
  assert.ok(!gate.unlocked.includes('grades'), 'успеваемость закрыта');
  assert.ok(!gate.unlocked.includes('messaging'), 'переписка закрыта');
});

test('гейт: после решения сотрудника открыт полностью', async () => {
  const verification = await getMyVerification(studentSession);
  assert.ok(verification !== null);

  await reviewVerification(staffSession, verification.id, {
    status: 'VERIFIED',
    comment: 'Фото и номер совпадают',
  });

  const gate = await getVerificationGate(studentSession);
  assert.equal(gate.verified, true);
  assert.deepEqual([...gate.locked], []);
  assert.ok(gate.unlocked.includes('grades'));
  assert.ok(gate.unlocked.includes('messaging'));

  const after = await getMyVerification(studentSession);
  assert.equal(after?.status, 'VERIFIED');
  assert.equal(after?.reviewComment, 'Фото и номер совпадают');
  assert.ok(after?.reviewedAt !== null);

  // Уведомление студенту о решении.
  const studentUserId = await userIdByLogin('student-verify');
  const notifications = await prisma().notification.findMany({
    where: { userId: studentUserId, title: 'Верификация пройдена' },
  });
  assert.equal(notifications.length, 1);

  // Аудит решения (именно по этой заявке).
  const audit = await prisma().auditEvent.findMany({
    where: { action: 'verification.review', entityId: verification.id },
  });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.entityId, verification.id);
});

test('reviewVerification: только STAFF/ADMIN', async () => {
  const verification = await getMyVerification(studentSession2);
  assert.equal(verification, null, 'у второго студента заявки нет');

  await submitVerification(studentSession2, {
    cardNumber: 'PI-2023-001',
    photoBuffer: JPEG,
    mime: 'image/jpeg',
  });
  const pending = await getMyVerification(studentSession2);
  assert.ok(pending !== null);
  assert.equal(pending.status, 'PENDING');

  await assert.rejects(
    () => reviewVerification(studentSession2, pending.id, { status: 'VERIFIED' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'STAFF_ONLY',
  );
  await assert.rejects(
    () => reviewVerification(staffSession, '00000000-0000-4000-8000-000000000000', { status: 'VERIFIED' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'NOT_FOUND',
  );
  // Отказ без комментария запрещён.
  await assert.rejects(
    () => reviewVerification(staffSession, pending.id, { status: 'REJECTED' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  const rejected = await reviewVerification(staffSession, pending.id, {
    status: 'REJECTED',
    comment: 'Фото нечитаемо',
  });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.reviewComment, 'Фото нечитаемо');
});

test('гейт-ошибка бросается сервисом успеваемости для неверифицированного', async () => {
  const { getMyGrades } = await import('../src/index.js');
  await assert.rejects(
    () => getMyGrades(studentSession2),
    (error: unknown) => error instanceof VerificationRequiredError,
  );
});

test('путь к фото строится через помощник хранилища', () => {
  assert.equal(
    idCardPhotoRelativePath('student-1', 'photo.jpg'),
    `${ID_CARD_DIR_NAME}/student-1/photo.jpg`,
  );
});
