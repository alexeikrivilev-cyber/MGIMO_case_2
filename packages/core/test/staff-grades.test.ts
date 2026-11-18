/**
 * Успеваемость студента для сотрудника деканата (BRIEF v2 §7, MCP):
 * сотрудник по логину студента видит его оценки, зачёты и сводку.
 *
 * Проверяемые инварианты (ARCHITECTURE §4):
 *   - студенческий токен → STAFF_ONLY (раздел не для студента);
 *   - преподаватель (STAFF без faculty) → STAFF_ONLY;
 *   - чужой факультет → NOT_OWNER — ТОТ ЖЕ обобщённый ответ, что и
 *     «студент не найден»: перебором логинов нельзя узнать, существует
 *     ли студент в другом институте;
 *   - ADMIN видит студентов всех институтов;
 *   - структура результата — как у getMyGrades (семестры/оценки) плюс
 *     сводка, и наружу не уходит ни одного внутреннего поля.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listStudentGradesForStaff,
  OwnershipError,
  ValidationError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  createSubject,
  createGrade,
  createVerification,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';

const FACULTY = 'Институт математики, информационных технологий и физики';
const OTHER_FACULTY = 'Институт языка и литературы';

let staffSession: AuthSession;
let otherStaffSession: AuthSession;
let adminSession: AuthSession;
let teacherSession: AuthSession;
let studentSession: AuthSession;
let ownLogin: string;
let otherLogin: string;

test.before(async () => {
  await resetTestData();

  const ownGroup = await createGroup('УСП-31-1', FACULTY);
  const otherGroup = await createGroup('УСП-ЯЗ-21-1', OTHER_FACULTY, 2, '45.03.01 Филология');

  const ownStudent = await createStudent('grades-own', ownGroup.id, { lastName: 'Успеваем' });
  const otherStudent = await createStudent('grades-other', otherGroup.id, {
    lastName: 'Чужой',
    faculty: OTHER_FACULTY,
  });
  ownLogin = ownStudent.login;
  otherLogin = otherStudent.login;

  const staff = await createUser('staff-grades', 'STAFF');
  await prisma().user.update({ where: { id: staff.id }, data: { faculty: FACULTY } });
  const otherStaff = await createUser('staff-grades-other', 'STAFF');
  await prisma().user.update({ where: { id: otherStaff.id }, data: { faculty: OTHER_FACULTY } });
  const admin = await createUser('admin-grades', 'ADMIN');
  const teacher = await createUser('teacher-grades', 'STAFF');

  staffSession = await authSessionFor(staff.id);
  otherStaffSession = await authSessionFor(otherStaff.id);
  adminSession = await authSessionFor(admin.id);
  teacherSession = await authSessionFor(teacher.id);
  studentSession = await authSessionFor(ownStudent.userId);

  // Оценки: два семестра своего студента — и по одной у чужого.
  const ownSubject = await createSubject('УСП-101', 'Базы данных');
  const ownSubject2 = await createSubject('УСП-102', 'Веб-программирование');
  await createGrade({
    studentId: ownStudent.studentId,
    subjectId: ownSubject,
    value: 5,
    type: 'EXAM',
    date: '2026-06-10',
    semester: 2,
  });
  await createGrade({
    studentId: ownStudent.studentId,
    subjectId: ownSubject2,
    value: 3,
    type: 'EXAM',
    date: '2026-06-12',
    semester: 2,
  });
  await createGrade({
    studentId: ownStudent.studentId,
    subjectId: ownSubject,
    value: null,
    passed: false,
    type: 'CREDIT',
    date: '2025-12-20',
    semester: 1,
  });

  const otherSubject = await createSubject('УСП-ЯЗ-101', 'Филология');
  await createGrade({
    studentId: otherStudent.studentId,
    subjectId: otherSubject,
    value: 4,
    type: 'EXAM',
    date: '2026-06-11',
    semester: 2,
  });

  // Гейт верификации не должен мешать сотруднику: у студента успеваемость
  // открыта без верификации (кабинет студента — отдельная история).
  void createVerification;
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('успеваемость студента: сотрудник своего факультета видит семестры, оценки и сводку', async () => {
  const result = await listStudentGradesForStaff(staffSession, { login: ownLogin });

  assert.equal(result.student.login, ownLogin);
  assert.match(result.student.fullName, /Успеваем/);
  assert.equal(result.student.groupName, 'УСП-31-1');
  assert.equal(result.student.faculty, FACULTY);

  // Семестры с сначала нового: 2-й семестр впереди.
  assert.equal(result.semesters.length, 2);
  assert.equal(result.semesters[0]?.semester, 2);
  assert.equal(result.semesters[0]?.entries.length, 2);
  assert.equal(result.semesters[1]?.semester, 1);
  assert.equal(result.semesters[1]?.entries.length, 1);

  // Внутри семестра — по дате, сначала новые (как в кабинете студента).
  const latest = result.semesters[0]?.entries[0];
  assert.equal(latest?.subjectName, 'Веб-программирование');
  assert.equal(latest?.value, 3);
  assert.equal(result.semesters[0]?.entries[1]?.subjectName, 'Базы данных');
  assert.equal(result.semesters[0]?.entries[1]?.typeLabel, 'Экзамен');

  // Зачёт «не зачтено» — долг, в средний балл не входит.
  const credit = result.semesters[1]?.entries[0];
  assert.equal(credit?.type, 'CREDIT');
  assert.equal(credit?.passed, false);

  // Сводка: средний балл только по оценённым работам + долг.
  assert.equal(result.summary.averageScore, 4);
  assert.equal(result.summary.gradedCount, 2);
  assert.equal(result.summary.debts.length, 1);
  assert.equal(result.summary.debts[0]?.subjectName, 'Базы данных');
  assert.equal(result.summary.toImprove.length, 2, 'низкая оценка и долг');
});

test('успеваемость студента: чужой факультет → NOT_OWNER (ответ как для «не найден»)', async () => {
  // Сотрудник другого института не видит нашего студента.
  await assert.rejects(
    () => listStudentGradesForStaff(otherStaffSession, { login: ownLogin }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
    'сотрудник чужого института не должен видеть успеваемость',
  );

  // Свой сотрудник тоже не видит чужого факультета — и получает тот же код.
  await assert.rejects(
    () => listStudentGradesForStaff(staffSession, { login: otherLogin }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );

  // Несуществующий логин — тот же обобщённый ответ (анти-перебор).
  await assert.rejects(
    () => listStudentGradesForStaff(staffSession, { login: 'нет-такого' }),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
});

test('успеваемость студента: студент и преподаватель → STAFF_ONLY', async () => {
  for (const [session, label] of [
    [studentSession, 'студент'],
    [teacherSession, 'преподаватель'],
  ] as const) {
    await assert.rejects(
      () => listStudentGradesForStaff(session, { login: ownLogin }),
      (error: unknown) => error instanceof OwnershipError && error.code === 'STAFF_ONLY',
      `${label} не должен смотреть успеваемость по логину`,
    );
  }
});

test('успеваемость студента: ADMIN видит все факультеты', async () => {
  const own = await listStudentGradesForStaff(adminSession, { login: ownLogin });
  assert.equal(own.student.faculty, FACULTY);
  assert.equal(own.summary.averageScore, 4);

  const other = await listStudentGradesForStaff(adminSession, { login: otherLogin });
  assert.equal(other.student.faculty, OTHER_FACULTY);
  assert.equal(other.summary.averageScore, 4, 'у чужого студента одна оценка 4');
});

test('успеваемость студента: пустой логин → ValidationError', async () => {
  await assert.rejects(
    () => listStudentGradesForStaff(staffSession, { login: '   ' }),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
});

test('успеваемость студента: студент без оценок — пустые семестры, сводка с null', async () => {
  const group = await createGroup('УСП-31-9', FACULTY);
  const student = await createStudent('grades-empty', group.id, { lastName: 'Безоценок' });
  const result = await listStudentGradesForStaff(staffSession, { login: student.login });

  assert.equal(result.semesters.length, 0);
  assert.equal(result.summary.averageScore, null);
  assert.equal(result.summary.gradedCount, 0);
  assert.equal(result.summary.debts.length, 0);
});
