/**
 * Тесты успеваемости: GPA на фиксированном наборе, долги, тренд
 * (включая серию semesterAverages для диаграммы), «что подтянуть»,
 * леверидж до целевого балла и гейт верификации.
 *
 * Числа средних посчитаны вручную и зашиты в ожидания — тест ловит
 * расхождения формулы, а не «подгонку под реализацию».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyGrades,
  getMyAcademicSummary,
  calculateLeverage,
  getMyVerification,
  submitVerification,
  reviewVerification,
  summarizeGrades,
  GRADE_TYPE_LABELS,
  VerificationRequiredError,
  ValidationError,
  type AuthSession,
  type MyGradeEntry,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createSubject,
  createGrade,
  createUser,
  authSessionFor,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

let studentSession: AuthSession;
let studentUserId: string;
let studentId: string;
let subjectIds: {
  math: string;
  db: string;
  web: string;
  law: string;
  art: string;
  pe: string;
};

test.before(async () => {
  await resetTestData();

  const group = await createGroup('УСП-22-1', FACULTY);
  const student = await createStudent('student-grades', group.id, { lastName: 'Успеваемый' });
  studentUserId = student.userId;
  studentId = student.studentId;

  // Object literal (не Record) — обращения к ключам типизированы точно.
  subjectIds = {
    math: await createSubject('УСП-101', 'Математический анализ'),
    db: await createSubject('УСП-102', 'Базы данных'),
    web: await createSubject('УСП-103', 'Веб-технологии'),
    law: await createSubject('УСП-104', 'Правоведение'),
    art: await createSubject('УСП-105', 'Рисунок'),
    pe: await createSubject('УСП-106', 'Физическая культура'),
  };

  // Семестр 1: 5, 4, 3 (экзамены) + 4 (курсовая) → среднее 4.0;
  // зачёт по рисоваку не сдан (долг).
  await createGrade({ studentId, subjectId: subjectIds.math, value: 5, type: 'EXAM', date: '2026-01-12', semester: 1 });
  await createGrade({ studentId, subjectId: subjectIds.db, value: 4, type: 'EXAM', date: '2026-01-14', semester: 1 });
  await createGrade({ studentId, subjectId: subjectIds.web, value: 3, type: 'EXAM', date: '2026-01-16', semester: 1 });
  await createGrade({ studentId, subjectId: subjectIds.law, value: 4, type: 'COURSEWORK', date: '2026-01-18', semester: 1 });
  await createGrade({ studentId, subjectId: subjectIds.art, value: null, passed: false, type: 'CREDIT', date: '2026-01-20', semester: 1 });

  // Семестр 2: 4, 5 (экзамены) + 5 (курсовая) → среднее 4.67; долг по физре.
  await createGrade({ studentId, subjectId: subjectIds.math, value: 4, type: 'EXAM', date: '2026-06-10', semester: 2 });
  await createGrade({ studentId, subjectId: subjectIds.db, value: 5, type: 'EXAM', date: '2026-06-12', semester: 2 });
  await createGrade({ studentId, subjectId: subjectIds.web, value: 5, type: 'COURSEWORK', date: '2026-06-14', semester: 2 });
  await createGrade({ studentId, subjectId: subjectIds.pe, value: null, passed: false, type: 'CREDIT', date: '2026-06-16', semester: 2 });

  studentSession = await authSessionFor(studentUserId);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Гейт верификации
// ---------------------------------------------------------------------------

test('до верификации успеваемость закрыта (гейт BRIEF v2)', async () => {
  await assert.rejects(
    () => getMyGrades(studentSession),
    (error: unknown) => error instanceof VerificationRequiredError && error.code === 'VERIFICATION_REQUIRED',
  );
  await assert.rejects(
    () => getMyAcademicSummary(studentSession),
    (error: unknown) => error instanceof VerificationRequiredError,
  );
});

test('верификация проведена сотрудником → гейт открыт', async () => {
  const staff = await createUser('staff-grades', 'STAFF');

  await submitVerification(studentSession, {
    cardNumber: 'UDGU-2023-001',
    photoBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    mime: 'image/jpeg',
  });

  const verification = await getMyVerification(studentSession);
  assert.ok(verification !== null);
  // Номера карточки нет в реестре → заявка сразу в REJECTED; окончательное
  // решение принимает сотрудник деканата (как в реальном процессе).
  assert.equal(verification.status, 'REJECTED');

  await reviewVerification(await authSessionFor(staff.id), verification.id, {
    status: 'VERIFIED',
    comment: 'Фото проверено',
  });

  const afterReview = await getMyVerification(studentSession);
  assert.equal(afterReview?.status, 'VERIFIED');
});

test('оценки и зачёты по дисциплинам с группировкой по семестрам', async () => {
  const result = await getMyGrades(studentSession);

  assert.equal(result.semesters.length, 2, 'два семестра');
  assert.equal(result.semesters[0]?.semester, 2, 'сначала новый семестр');
  assert.equal(result.semesters[1]?.semester, 1);

  const firstSemester = result.semesters[1];
  assert.equal(firstSemester?.entries.length, 5);
  // Внутри семестра — по дате от новых к старым: незачёт (20.01) первым.
  assert.equal(firstSemester?.entries[0]?.typeLabel, 'Зачёт');
  assert.equal(firstSemester?.entries[0]?.subjectName, 'Рисунок');
  assert.equal(firstSemester?.entries.at(-1)?.subjectName, 'Математический анализ');

  const credit = firstSemester?.entries.find((entry) => entry.type === 'CREDIT');
  assert.equal(credit?.passed, false, 'незачёт виден');
  assert.equal(credit?.value, null);
});

test('фильтр по семестру', async () => {
  const result = await getMyGrades(studentSession, 2);
  assert.equal(result.semesters.length, 1);
  assert.equal(result.semesters[0]?.semester, 2);
  assert.equal(
    result.semesters[0]?.entries.every((entry) => entry.semester === 2),
    true,
  );
});

test('средний балл: только экзамены и курсовые (30/7 = 4.29)', async () => {
  const summary = await getMyAcademicSummary(studentSession);

  assert.equal(summary.gradedCount, 7);
  assert.equal(summary.averageScore, 4.29, 'зачёты в средний балл не входят');
});

test('долги: незачёты обоих семестров', async () => {
  const summary = await getMyAcademicSummary(studentSession);

  assert.deepEqual(
    summary.debts.map((debt) => [debt.subjectName, debt.semester]),
    [
      ['Рисунок', 1],
      ['Физическая культура', 2],
    ],
  );
});

test('тренд: последний семестр выше предыдущего (4.0 → 4.67, UP)', async () => {
  const summary = await getMyAcademicSummary(studentSession);

  assert.equal(summary.trend.lastSemester, 2);
  assert.equal(summary.trend.previousSemester, 1);
  assert.equal(summary.trend.lastSemesterAverage, 4.67);
  assert.equal(summary.trend.previousSemesterAverage, 4);
  assert.equal(summary.trend.delta, 0.67);
  assert.equal(summary.trend.direction, 'UP');
});

// ---------------------------------------------------------------------------
// Тренд: серия средних по семестрам (диаграмма «Динамика по семестрам»)
// ---------------------------------------------------------------------------

test('тренд: semesterAverages — серия по возрастанию семестра (4.0 → 4.67)', async () => {
  const summary = await getMyAcademicSummary(studentSession);

  assert.deepEqual(summary.trend.semesterAverages, [
    { semester: 1, average: 4 },
    { semester: 2, average: 4.67 },
  ]);
});

/** Запись оценки для чистых тестов summarizeGrades (без БД). */
function gradeEntry(
  semester: number,
  type: 'EXAM' | 'CREDIT' | 'COURSEWORK',
  value: number | null,
  passed: boolean | null = null,
): MyGradeEntry {
  return {
    id: `grade-${semester}-${type}-${String(value)}`,
    subjectName: 'Предмет',
    subjectCode: 'ТЕСТ-001',
    type,
    typeLabel: GRADE_TYPE_LABELS[type],
    value,
    passed,
    date: new Date('2026-06-01T00:00:00.000Z'),
    semester,
  };
}

test('semesterAverages: несколько семестров — значения и порядок по возрастанию', () => {
  const summary = summarizeGrades([
    gradeEntry(2, 'EXAM', 5),
    gradeEntry(1, 'EXAM', 5),
    gradeEntry(1, 'EXAM', 4),
    gradeEntry(2, 'COURSEWORK', 3),
    gradeEntry(2, 'EXAM', 4),
    gradeEntry(3, 'CREDIT', null, true),
  ]);

  assert.deepEqual(summary.trend.semesterAverages, [
    { semester: 1, average: 4.5 }, // (5+4)/2
    { semester: 2, average: 4 }, // (5+3+4)/3
  ], 'зачёт 3 семестра точку не даёт');
});

test('semesterAverages: семестр только с зачётами точки не даёт', () => {
  const summary = summarizeGrades([
    gradeEntry(1, 'EXAM', 5),
    gradeEntry(2, 'CREDIT', null, true),
    gradeEntry(2, 'CREDIT', null, false),
  ]);

  assert.deepEqual(summary.trend.semesterAverages, [{ semester: 1, average: 5 }]);
});

test('semesterAverages: без оценок — пустая серия', () => {
  assert.deepEqual(summarizeGrades([]).trend.semesterAverages, []);
  assert.deepEqual(
    summarizeGrades([gradeEntry(1, 'CREDIT', null, true)]).trend.semesterAverages,
    [],
    'одни зачёты — тоже пусто',
  );
});

test('semesterAverages: округление до 2 знаков (13/3 = 4.33)', () => {
  const summary = summarizeGrades([
    gradeEntry(1, 'EXAM', 5),
    gradeEntry(1, 'EXAM', 4),
    gradeEntry(1, 'EXAM', 4),
  ]);

  assert.deepEqual(summary.trend.semesterAverages, [{ semester: 1, average: 4.33 }]);
});

test('что подтянуть: низкие оценки и долги', async () => {
  const summary = await getMyAcademicSummary(studentSession);

  assert.deepEqual(
    summary.toImprove.map((hint) => [hint.subjectName, hint.reason]),
    [
      ['Рисунок', 'DEBT'],
      ['Веб-технологии', 'LOW_GRADE'],
      ['Физическая культура', 'DEBT'],
    ],
  );
});

// ---------------------------------------------------------------------------
// Леверидж: честная арифметика (числа посчитаны вручную)
// ---------------------------------------------------------------------------

test('леверидж: [5,4,4] + 2 предстоящих до 4.5', () => {
  const result = calculateLeverage([{ value: 5 }, { value: 4 }, { value: 4 }, { value: null }, { value: null }], 4.5);

  assert.equal(result.gradedCount, 3);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.currentAverage, 4.33); // 13/3 = 4.333…
  assert.equal(result.neededSumOnPending, 9.5); // 4.5*5 - 13
  assert.equal(result.neededAverageOnPending, 4.75); // 9.5/2
  assert.equal(result.maxPossibleAverage, 4.6); // (13+10)/5
  assert.equal(result.achievable, true);
  assert.equal(result.alreadyAchieved, false);
});

test('леверидж: цель недостижима ([3,3] + 1 до 5)', () => {
  const result = calculateLeverage([{ value: 3 }, { value: 3 }, { value: null }], 5);

  assert.equal(result.currentAverage, 3);
  assert.equal(result.neededSumOnPending, 9); // 5*3 - 6
  assert.equal(result.neededAverageOnPending, 9); // 9/1 — больше 5
  assert.equal(result.maxPossibleAverage, 3.67); // (6+5)/3
  assert.equal(result.achievable, false);
  assert.equal(result.alreadyAchieved, false);
});

test('леверидж: цель уже достигнута', () => {
  const result = calculateLeverage([{ value: 5 }, { value: 5 }], 4.5);

  assert.equal(result.pendingCount, 0);
  assert.equal(result.currentAverage, 5);
  assert.equal(result.alreadyAchieved, true);
  assert.equal(result.achievable, true);
  assert.equal(result.neededSumOnPending, null);
  assert.equal(result.maxPossibleAverage, 5);
});

test('леверидж: предстоящих работ не осталось, цель не достигнута', () => {
  const result = calculateLeverage([{ value: 5 }, { value: 4 }, { value: 4 }, { value: 4 }], 5);

  assert.equal(result.currentAverage, 4.25);
  assert.equal(result.alreadyAchieved, false);
  assert.equal(result.achievable, false);
  assert.equal(result.maxPossibleAverage, 4.25);
});

test('леверидж: граничный случай neededSum ровно 5*pending достижим', () => {
  const result = calculateLeverage([{ value: 5 }, { value: 4 }, { value: null }], 4.5);

  assert.equal(result.neededSumOnPending, 4.5); // 4.5*3 - 9
  assert.equal(result.neededAverageOnPending, 4.5);
  assert.equal(result.achievable, true);
});

test('леверидж: пустой список работ', () => {
  const result = calculateLeverage([], 4);

  assert.equal(result.gradedCount, 0);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.currentAverage, null);
  assert.equal(result.maxPossibleAverage, null);
  assert.equal(result.achievable, false);
  assert.equal(result.alreadyAchieved, false);
});

test('леверидж: невалидные входные данные отклоняются', () => {
  assert.throws(() => calculateLeverage([{ value: 5 }], 6), ValidationError);
  assert.throws(() => calculateLeverage([{ value: 5 }], 1), ValidationError);
  assert.throws(() => calculateLeverage([{ value: 7 }], 4), ValidationError, 'оценка вне шкалы 2-5');
  assert.throws(() => calculateLeverage([{ value: 2.5 }], 4), ValidationError, 'оценка не целая');
  assert.throws(() => calculateLeverage('нет' as unknown as { value: number | null }[], 4), ValidationError);
});
