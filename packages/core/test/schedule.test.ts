/**
 * Тесты расписания: сегодня/неделя, ближайшая пара, свободные окна,
 * расписание преподавателей и часы приёма.
 *
 * Даты создаются относительно «сегодня» (UTC) — седер и БД хранят
 * @db.Date в полночи UTC, сервисы используют те же границы.
 * Дальние пары (для проверки недель) ставятся за пределом 14-дневного
 * окна «ближайшей пары», чтобы тесты не зависели от дня недели.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyScheduleToday,
  getMyScheduleWeek,
  getMyNextLesson,
  getFreeGaps,
  getTeacherSchedule,
  getTeacherOfficeHours,
  startOfUtcDay,
  addUtcDays,
  mondayOfUtcWeek,
  dateKey,
  OwnershipError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createTeacher,
  createUser,
  createSubject,
  createScheduleEntry,
  createOfficeHour,
  authSessionFor,
} from './helpers.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

let studentSession: AuthSession;
let otherStudentSession: AuthSession;
let staffSession: AuthSession;
let groupId: string;
let otherGroupId: string;
let teacherId: string;
let subjectIds: {
  math: string;
  db: string;
  web: string;
  law: string;
};

test.before(async () => {
  await resetTestData();

  const group = await createGroup('РАС-21-1', FACULTY);
  const otherGroup = await createGroup('РАС-99-9', 'Институт права, социального управления и безопасности');
  const teacher = await createTeacher('teacher-schedule');

  const student = await createStudent('student-schedule', group.id, { lastName: 'Расписаний' });
  const otherStudent = await createStudent('student-other-schedule', otherGroup.id, {
    lastName: 'Чужой',
    faculty: 'Институт права, социального управления и безопасности',
  });
  const staffUser = await createUser('staff-schedule', 'STAFF');

  groupId = group.id;
  otherGroupId = otherGroup.id;
  teacherId = teacher.teacherId;
  // Object literal (не Record) — обращения к ключам типизированы точно.
  subjectIds = {
    math: await createSubject('РАС-101', 'Математический анализ'),
    db: await createSubject('РАС-102', 'Базы данных'),
    web: await createSubject('РАС-103', 'Веб-технологии'),
    law: await createSubject('РАС-104', 'Правоведение'),
  };

  const today = startOfUtcDay(new Date());
  const tomorrow = addUtcDays(today, 1);
  const farWednesday = addUtcDays(mondayOfUtcWeek(today, 2), 2); // среда недели +2 — вне окна 14 дней

  // Сегодня: три пары (окна 09:50–10:00 и 11:20–13:30 между ними).
  await createScheduleEntry({
    groupId,
    subjectId: subjectIds.math,
    teacherId,
    date: dateKey(today),
    startTime: '08:30',
    endTime: '09:50',
    room: 'У-101',
    type: 'LECTURE',
  });
  await createScheduleEntry({
    groupId,
    subjectId: subjectIds.db,
    teacherId,
    date: dateKey(today),
    startTime: '10:00',
    endTime: '11:20',
    room: 'У-204',
    type: 'SEMINAR',
  });
  // Перенесённая пара: остаётся в слоте сегодня с отметкой, состоится завтра в Л-305.
  await createScheduleEntry({
    groupId,
    subjectId: subjectIds.web,
    teacherId,
    date: dateKey(today),
    startTime: '13:30',
    endTime: '14:50',
    room: 'У-311',
    type: 'LAB',
    status: 'MOVED',
    note: 'Перенос согласован с кафедрой',
    movedToDate: dateKey(tomorrow),
    movedToRoom: 'Л-305',
  });

  // Завтра: только отменённая пара (перенесённая приходит через movedToDate).
  await createScheduleEntry({
    groupId,
    subjectId: subjectIds.math,
    teacherId,
    date: dateKey(tomorrow),
    startTime: '15:00',
    endTime: '16:20',
    room: 'У-101',
    status: 'CANCELLED',
    note: 'Отменено: заболевание преподавателя',
  });

  // Пара чужой группы сегодня — не должна попадать в наше расписание.
  await createScheduleEntry({
    groupId: otherGroupId,
    subjectId: subjectIds.law,
    teacherId,
    date: dateKey(today),
    startTime: '08:30',
    endTime: '09:50',
    room: 'У-418',
  });

  // Пара в среде недели +2 — для проверки weekOffset.
  await createScheduleEntry({
    groupId,
    subjectId: subjectIds.db,
    teacherId,
    date: dateKey(farWednesday),
    startTime: '12:00',
    endTime: '13:20',
    room: 'У-204',
  });

  await createOfficeHour(teacherId, {
    weekday: 2,
    startTime: '14:00',
    endTime: '15:00',
    room: 'У-204',
    type: 'RECEPTION',
  });
  await createOfficeHour(teacherId, {
    weekday: 1,
    startTime: '12:00',
    endTime: '13:00',
    room: 'У-101',
    type: 'CONSULTATION',
  });

  studentSession = await authSessionFor(student.userId);
  otherStudentSession = await authSessionFor(otherStudent.userId);
  staffSession = await authSessionFor(staffUser.id);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('расписание на сегодня: свои пары, отметки переноса', async () => {
  const lessons = await getMyScheduleToday(studentSession);

  assert.equal(lessons.length, 3, 'три пары своей группы');
  assert.ok(
    lessons.every((lesson) => lesson.teacherName.includes('Преподавательская')),
    'преподаватель подтягивается',
  );

  const moved = lessons.find((lesson) => lesson.status === 'MOVED');
  assert.ok(moved, 'перенесённая пара на месте');
  assert.match(moved.changeHint ?? '', /Перенесено/);
  assert.match(moved.changeHint ?? '', /аудитория Л-305/);
  assert.equal(moved.movedToRoom, 'Л-305');
  assert.equal(moved.typeLabel, 'Лабораторная');

  const lecture = lessons.find((lesson) => lesson.type === 'LECTURE');
  assert.equal(lecture?.changeHint, null, 'у обычной пары отметки нет');
  assert.equal(lecture?.subjectName, 'Математический анализ');
  assert.equal(lecture?.room, 'У-101');

  // Сортировка по времени.
  const times = lessons.map((lesson) => lesson.startTime);
  assert.deepEqual([...times].sort(), times);
});

test('расписание на сегодня: чужая группа не видна', async () => {
  const lessons = await getMyScheduleToday(otherStudentSession);
  assert.equal(lessons.length, 1, 'у чужой группы своя единственная пара');
  assert.equal(lessons[0]?.subjectName, 'Правоведение');
  assert.equal(lessons[0]?.room, 'У-418');
});

test('расписание на конкретную дату', async () => {
  const tomorrow = addUtcDays(startOfUtcDay(new Date()), 1);
  const lessons = await getMyScheduleToday(studentSession, tomorrow);

  assert.equal(lessons.length, 1, 'завтра только отменённая пара в сетке');
  const cancelled = lessons[0];
  assert.equal(cancelled?.status, 'CANCELLED');
  assert.equal(cancelled?.changeHint, 'Отменено: заболевание преподавателя', 'причина отмены видна');
});

test('расписание на неделю: 7 дней, понедельник первый', async () => {
  const week = await getMyScheduleWeek(studentSession, 0);

  assert.equal(week.days.length, 7);
  assert.equal(dateKey(week.weekStart), dateKey(mondayOfUtcWeek(new Date(), 0)));
  assert.equal(week.days[0]?.weekday, 1, 'неделя начинается с понедельника');
  assert.equal(week.days[6]?.weekday, 7);

  const todayKey = dateKey(startOfUtcDay(new Date()));
  const todayDay = week.days.find((day) => dateKey(day.date) === todayKey);
  assert.equal(todayDay?.lessons.length, 3, 'сегодняшние пары на месте');

  // Все пары недели относятся к своей группе.
  const allLessons = week.days.flatMap((day) => day.lessons);
  assert.ok(allLessons.length >= 3);
  assert.ok(
    allLessons.every((lesson) => lesson.subjectName !== 'Правоведение'),
    'чужая группа не течёт',
  );
});

test('расписание на неделю +2: дальняя пара попадает в свой день', async () => {
  const week = await getMyScheduleWeek(studentSession, 2);
  const farWednesday = addUtcDays(mondayOfUtcWeek(new Date(), 2), 2);

  assert.equal(dateKey(week.weekStart), dateKey(mondayOfUtcWeek(new Date(), 2)));
  const wednesday = week.days.find((day) => dateKey(day.date) === dateKey(farWednesday));
  assert.equal(wednesday?.lessons.length, 1);
  assert.equal(wednesday?.lessons[0]?.subjectName, 'Базы данных');
  assert.equal(wednesday?.lessons[0]?.room, 'У-204');
});

test('свободные окна: перенесённая пара освобождает исходный слот', async () => {
  const gaps = await getFreeGaps(studentSession);

  assert.deepEqual(
    gaps,
    [{ startTime: '09:50', endTime: '10:00', durationMinutes: 10 }],
    'окно только между первой и второй парой: 13:30 освободилось переносом',
  );
});

test('свободные окна: перенесённая пара занимает слот на новой дате', async () => {
  const tomorrow = addUtcDays(startOfUtcDay(new Date()), 1);
  // Завтра только перенесённая пара — окна нет.
  const gaps = await getFreeGaps(studentSession, tomorrow);
  assert.deepEqual(gaps, []);
});

test('свободные окна: день без пар → пусто', async () => {
  const empty = await getFreeGaps(studentSession, addUtcDays(startOfUtcDay(new Date()), 6));
  assert.deepEqual(empty, []);
});

test('ближайшая пара: до первой пары, между парами, на следующий день', async () => {
  const today = startOfUtcDay(new Date());

  const beforeFirst = new Date(today.getTime() + 7 * 60 * 60 * 1000); // 07:00 UTC
  const next = await getMyNextLesson(studentSession, beforeFirst);
  assert.ok(next);
  assert.equal(next.startTime, '08:30');
  assert.equal(next.subjectName, 'Математический анализ');

  const betweenLessons = new Date(today.getTime() + 9 * 60 * 60 * 1000 + 55 * 60 * 1000); // 09:55
  const second = await getMyNextLesson(studentSession, betweenLessons);
  assert.equal(second?.startTime, '10:00');

  const afterAll = new Date(today.getTime() + 15 * 60 * 60 * 1000); // 15:00 — сегодняшние пары позади
  const tomorrow = await getMyNextLesson(studentSession, afterAll);
  assert.ok(tomorrow);
  assert.equal(dateKey(tomorrow.effectiveDate), dateKey(addUtcDays(today, 1)));
  assert.equal(tomorrow.startTime, '13:30', 'перенесённая пара идёт по новой дате');
  assert.equal(tomorrow.effectiveRoom, 'Л-305');
  assert.equal(tomorrow.status, 'MOVED');
});

test('ближайшая пара: отменённые пары пропускаются, дальше в окне пусто', async () => {
  const tomorrow = addUtcDays(startOfUtcDay(new Date()), 1);
  // После 14:00 завтра остаётся только отменённая пара 15:00 — её не отдаём.
  const afterTomorrowLessons = new Date(tomorrow.getTime() + 14 * 60 * 60 * 1000 + 30 * 60 * 1000);
  const next = await getMyNextLesson(studentSession, afterTomorrowLessons);
  assert.notEqual(next?.status, 'CANCELLED', 'отменённая пара не становится ближайшей');
  // Дальше в 14-дневном окне от «сейчас» остаётся только среда недели +2.
  // Попадает ли она в окно — зависит от дня недели прогона (окно считается
  // от переданного «сейчас»), поэтому оба случая считаются корректными.
  const farWednesday = addUtcDays(mondayOfUtcWeek(new Date(), 2), 2);
  assert.ok(next === null || dateKey(next.date) === dateKey(farWednesday));
});

test('расписание преподавателя доступно студенту', async () => {
  const today = startOfUtcDay(new Date());
  const to = addUtcDays(today, 7);

  const lessons = await getTeacherSchedule(teacherId, today, to);
  assert.equal(lessons.length, 5, 'пары преподавателя за сегодня+неделю (4 сегодня/завтра + 1 дальняя вне окна)');
  assert.ok(
    lessons.every((lesson) => lesson.teacherName.includes('Преподавательская')),
    'преподаватель тот же',
  );
  assert.ok(
    lessons.some((lesson) => lesson.groupName === 'РАС-21-1'),
    'видна группа, у которой ведёт занятия',
  );
  assert.ok(
    lessons.some((lesson) => lesson.groupName === 'РАС-99-9'),
    'видны занятия у других групп — это общедоступная информация',
  );
  assert.ok(
    lessons.some((lesson) => lesson.status === 'CANCELLED'),
    'отмена видна и в расписании преподавателя',
  );

  // Сортировка по дате и времени.
  const keys = lessons.map((lesson) => `${dateKey(lesson.date)} ${lesson.startTime}`);
  assert.deepEqual([...keys].sort(), keys);
});

test('часы приёма преподавателя: отсортированы, с метками', async () => {
  const hours = await getTeacherOfficeHours(teacherId);

  assert.equal(hours.length, 2);
  assert.deepEqual(
    hours.map((hour) => hour.weekday),
    [1, 2],
    'сортировка по дню недели',
  );
  assert.equal(hours[0]?.typeLabel, 'Консультация');
  assert.equal(hours[0]?.weekdayLabel, 'Пн');
  assert.equal(hours[1]?.typeLabel, 'Час приёма');
  assert.equal(hours[1]?.weekdayLabel, 'Вт');
  assert.equal(hours[0]?.teacherName.includes('Преподавательская'), true);
});

test('расписание недоступно не-студенту', async () => {
  await assert.rejects(
    () => getMyScheduleToday(staffSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
  await assert.rejects(
    () => getMyScheduleWeek(staffSession, 0),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
  await assert.rejects(
    () => getFreeGaps(staffSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
  await assert.rejects(
    () => getMyNextLesson(staffSession),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_A_STUDENT',
  );
});

test('пустой teacherId в расписании преподавателя → ошибка', async () => {
  await assert.rejects(() => getTeacherSchedule('', new Date(), new Date()), TypeError);
  await assert.rejects(() => getTeacherOfficeHours(''), TypeError);
});

test('MOVED без movedToDate: пара остаётся в слоте с честной отметкой', async () => {
  // Отдельная группа: битая запись не должна меняться подсчёты других
  // тестов этого файла.
  const group = await createGroup('РАС-88-8', FACULTY);
  const subject = await createSubject('РАС-888', 'Битые данные');
  const student = await createStudent('student-broken-moved', group.id);
  const day = addUtcDays(startOfUtcDay(new Date()), 3);
  const dayKeyValue = dateKey(day);
  const dayStart = new Date(`${dayKeyValue}T00:00:00.000Z`);

  // Сломанная строка: статус MOVED, но movedToDate = null.
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId,
    date: dayKeyValue,
    startTime: '10:00',
    endTime: '11:20',
    status: 'MOVED',
    movedToDate: null,
  });
  await createScheduleEntry({
    groupId: group.id,
    subjectId: subject,
    teacherId,
    date: dayKeyValue,
    startTime: '12:00',
    endTime: '13:20',
  });
  const session = await authSessionFor(student.userId);

  // Сетка дня: пара на месте в исходном слоте, отметка без выдумывания
  // новой даты («Перенесено.» — и ничего больше).
  const lessons = await getMyScheduleToday(session, dayStart);
  assert.equal(lessons.length, 2);
  const broken = lessons.find((lesson) => lesson.status === 'MOVED');
  assert.ok(broken, 'битая пара присутствует в сетке');
  assert.equal(broken.movedToDate, null);
  assert.equal(broken.changeHint, 'Перенесено.');

  // Свободные окна: битая пара не занимает слот (movedToDate = null не
  // матчится ни один день), окно между парами не появляется — 12:00
  // остаётся единственным занятием.
  const gaps = await getFreeGaps(session, dayStart);
  assert.deepEqual(gaps, [], 'битая пара не занимает слот и окна не создаёт');

  // Ближайшая пара: считается по исходному слоту — дата не придумывается.
  const before = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000); // 09:00 UTC
  const next = await getMyNextLesson(session, before);
  assert.ok(next);
  assert.equal(next.status, 'MOVED');
  assert.equal(dateKey(next.effectiveDate), dayKeyValue, 'фактическая дата — исходный слот');
  assert.equal(next.startTime, '10:00');

  // Неделя: пара остаётся в своём дне, неделя не ломается. Смещение
  // недели считаем от дня пары — от «сегодня» оно зависит от дня недели.
  const weekOffset = Math.round(
    (mondayOfUtcWeek(day).getTime() - mondayOfUtcWeek(new Date()).getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  const week = await getMyScheduleWeek(session, weekOffset);
  const inWeek = week.days
    .flatMap((weekDay) => weekDay.lessons)
    .filter((lesson) => lesson.status === 'MOVED');
  assert.equal(inWeek.length, 1);
});
