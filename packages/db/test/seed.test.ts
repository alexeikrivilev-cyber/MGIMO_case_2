/**
 * Инварианты сидера: гоняем buildSeedData() (чистая генерация, без БД)
 * и проверяем уникальность, связность и требования кейса.
 * Тест падает, если сидер сломан — например, если из расписания
 * пропали переносы/отмены или у student1 нет долга.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'argon2';
import {
  buildSeedData,
  TEST_PASSWORD,
  SCHEDULE_HORIZON_DAYS,
  SEED_COUNTS,
  type GradeSeed,
  type NotificationSeed,
  type SeedData,
} from '../src/seed-data.js';

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

const data: SeedData = await buildSeedData();
const today = startOfDay(new Date());
const windowStart = addDays(today, 1);
const windowEnd = addDays(today, SCHEDULE_HORIZON_DAYS);
const windowStartKey = windowStart.toISOString().slice(0, 10);
const windowEndKey = windowEnd.toISOString().slice(0, 10);

test('сидер создаёт заявленный набор сущностей', () => {
  assert.equal(data.users.length, SEED_COUNTS.students + SEED_COUNTS.teachers + 2);
  assert.equal(data.students.length, 4);
  assert.equal(data.groups.length, 8);
  assert.equal(data.subjects.length, 40);
  assert.equal(data.teachers.length, 12);
});

test('логины пользователей уникальны и роли распределены верно', () => {
  const logins = data.users.map((user) => user.login);
  assert.equal(new Set(logins).size, logins.length);

  const byLogin = new Map(data.users.map((user) => [user.login, user]));
  for (const login of ['student1', 'student2', 'student3', 'student4']) {
    assert.equal(byLogin.get(login)?.role, 'STUDENT', `${login} должен быть студентом`);
  }
  assert.equal(byLogin.get('staff1')?.role, 'STAFF');
  assert.equal(byLogin.get('admin1')?.role, 'ADMIN');
  for (const teacher of data.teachers) {
    assert.equal(byLogin.get(teacher.login)?.role, 'STAFF');
  }
});

test('пароли тестовых аккаунтов — argon2id-хеш от фикстуры сидера', async () => {
  for (const user of data.users) {
    assert.match(user.passwordHash, /^\$argon2id\$/, `хеш ${user.login} должен быть argon2id`);
    assert.equal(await verify(user.passwordHash, TEST_PASSWORD), true, `${user.login} должен верифицироваться`);
  }
  const first = data.users[0];
  assert.ok(first);
  assert.equal(await verify(first.passwordHash, 'wrong-password'), false);
});

test('студенты уникальны и ссылаются на существующие группы', () => {
  const groupNames = new Set(data.groups.map((group) => group.name));
  const logins = data.students.map((student) => student.login);
  const emails = data.students.map((student) => student.email);
  const cards = data.students.map((student) => student.studentCardNumber);

  assert.equal(new Set(logins).size, logins.length);
  assert.equal(new Set(emails).size, emails.length);
  assert.equal(new Set(cards).size, cards.length);

  for (const student of data.students) {
    assert.ok(groupNames.has(student.groupName), `группа ${student.groupName} должна существовать`);
    assert.ok(student.lastName.length > 0);
    assert.ok(student.firstName.length > 0);
    assert.ok(student.email.includes('@'));
  }
});

test('группы и предметы уникальны', () => {
  const groupNames = data.groups.map((group) => group.name);
  assert.equal(new Set(groupNames).size, groupNames.length);

  const codes = data.subjects.map((subject) => subject.code);
  assert.equal(new Set(codes).size, codes.length);

  const subjectByCode = new Map(data.subjects.map((subject) => [subject.code, subject]));
  for (const entry of data.scheduleEntries) {
    assert.ok(subjectByCode.has(entry.subjectCode));
  }
  for (const grade of data.grades) {
    assert.ok(subjectByCode.has(grade.subjectCode));
  }
});

test('расписание покрывает 2 недели вперёд с 5-6 парами в день', () => {
  const teacherLogins = new Set(data.teachers.map((teacher) => teacher.login));
  const groupNames = new Set(data.groups.map((group) => group.name));

  const byGroupDay = new Map<string, number>();
  const slotKeys = new Set<string>();

  for (const entry of data.scheduleEntries) {
    assert.ok(groupNames.has(entry.groupName), `группа ${entry.groupName} существует`);
    assert.ok(teacherLogins.has(entry.teacherLogin), `преподаватель ${entry.teacherLogin} существует`);
    assert.ok(entry.date >= windowStartKey && entry.date <= windowEndKey, `дата ${entry.date} в окне 2 недель`);
    assert.ok(entry.room.length > 0);
    assert.ok(entry.startTime < entry.endTime, 'время начала раньше окончания');

    const slotKey = `${entry.groupName}|${entry.date}|${entry.startTime}`;
    assert.equal(slotKeys.has(slotKey), false, `дубль пары ${slotKey}`);
    slotKeys.add(slotKey);

    const dayKey = `${entry.groupName}|${entry.date}`;
    byGroupDay.set(dayKey, (byGroupDay.get(dayKey) ?? 0) + 1);
  }

  for (const [dayKey, count] of byGroupDay) {
    assert.ok(count >= 5 && count <= 6, `${dayKey}: ${count} пар (ожидалось 5-6)`);
  }
  assert.ok(byGroupDay.size >= 8 * 10, 'должно быть >= 80 группо-дней (8 групп × 10 будней)');
});

test('расписание содержит переносы (MOVED) и отмены (CANCELLED)', () => {
  const moved = data.scheduleEntries.filter((entry) => entry.status === 'MOVED');
  const cancelled = data.scheduleEntries.filter((entry) => entry.status === 'CANCELLED');

  assert.ok(moved.length >= 2, `переносов: ${moved.length}, нужно >= 2`);
  assert.ok(cancelled.length >= 2, `отмен: ${cancelled.length}, нужно >= 2`);

  for (const entry of moved) {
    assert.ok(entry.movedToDate, 'у переноса указана новая дата');
    assert.ok(entry.movedToRoom, 'у переноса указана новая аудитория');
    assert.notEqual(entry.movedToDate, entry.date, 'новая дата отличается от исходной');
    assert.ok(entry.movedToDate >= windowStartKey && entry.movedToDate <= windowEndKey, 'новая дата в окне 2 недель');
    assert.ok(entry.note, 'у переноса есть примечание');
  }

  for (const entry of cancelled) {
    assert.ok(entry.note && entry.note.length > 0, 'у отмены есть причина в note');
    assert.equal(entry.movedToDate, null);
    assert.equal(entry.movedToRoom, null);
  }
});

test('оценки: 2 семестра по 6-9 дисциплин, корректные типы и значения', () => {
  const byStudent = new Map<string, GradeSeed[]>();
  for (const grade of data.grades) {
    const list = byStudent.get(grade.studentLogin) ?? [];
    list.push(grade);
    byStudent.set(grade.studentLogin, list);
  }

  const uniqueKeys = new Set<string>();
  for (const [login, grades] of byStudent) {
    assert.ok(grades.length >= 12, `${login}: ${grades.length} оценок (ожидалось >= 12)`);
    const semesters = new Set(grades.map((grade) => grade.semester));
    assert.deepEqual([...semesters].sort(), [1, 2], `${login}: оба семестра`);

    for (const grade of grades) {
      const key = `${grade.studentLogin}|${grade.subjectCode}|${grade.semester}|${grade.type}`;
      assert.equal(uniqueKeys.has(key), false, `дубль оценки ${key}`);
      uniqueKeys.add(key);

      if (grade.type === 'EXAM' || grade.type === 'COURSEWORK') {
        assert.ok(typeof grade.value === 'number' && grade.value >= 2 && grade.value <= 5, `значение ${grade.value} в диапазоне 2-5`);
        assert.equal(grade.passed, null);
      } else {
        assert.equal(grade.value, null);
        assert.equal(typeof grade.passed, 'boolean', 'у зачёта передан passed');
      }
    }
  }
});

test('у student1 ровно один долг (незачёт), и он единственный в системе', () => {
  const failed = data.grades.filter((grade) => grade.passed === false);
  assert.equal(failed.length, 1, 'в системе ровно один незачёт');
  assert.equal(failed[0]?.studentLogin, 'student1');
  assert.equal(failed[0]?.type, 'CREDIT');
  assert.equal(failed[0]?.semester, 2);
});

test('заявки: 1-3 на студента, оба типа, разные статусы', () => {
  const byStudent = new Map<string, number>();
  for (const request of data.requests) {
    assert.ok(request.formData && Object.keys(request.formData).length > 0, 'formData заполнен');
    assert.ok(request.studentLogin);
    byStudent.set(request.studentLogin, (byStudent.get(request.studentLogin) ?? 0) + 1);
  }

  assert.equal(byStudent.size, 4, 'заявки у всех студентов');
  for (const [login, count] of byStudent) {
    assert.ok(count >= 1 && count <= 3, `${login}: ${count} заявок`);
  }

  const types = new Set(data.requests.map((request) => request.type));
  assert.ok(types.has('REFERENCE') && types.has('APPLICATION'), 'оба типа заявок присутствуют');
  assert.ok(new Set(data.requests.map((request) => request.status)).size >= 3, 'статусы разнообразные');
});

test('объявления: 4-6 штук, аудитории ALL/FACULTY/GROUP, 2 закреплённых', () => {
  assert.ok(data.announcements.length >= 4 && data.announcements.length <= 6);
  assert.equal(data.announcements.filter((a) => a.pinned).length, 2, 'ровно 2 закреплённых');

  const audiences = new Set(data.announcements.map((a) => a.audience));
  assert.ok(audiences.has('ALL') && audiences.has('FACULTY') && audiences.has('GROUP'));

  const groupNames = new Set(data.groups.map((group) => group.name));
  const staff = data.users.find((user) => user.login === 'staff1');
  assert.ok(staff, 'staff1 существует');

  for (const announcement of data.announcements) {
    assert.equal(announcement.authorLogin, 'staff1');
    assert.ok(announcement.title.length > 0 && announcement.body.length > 0);
    if (announcement.audience === 'FACULTY') assert.ok(announcement.faculty, 'у FACULTY указан факультет');
    if (announcement.audience === 'GROUP') {
      assert.ok(announcement.groupName && groupNames.has(announcement.groupName), 'у GROUP указана группа');
    }
    if (announcement.audience === 'ALL') {
      assert.equal(announcement.faculty, null);
      assert.equal(announcement.groupName, null);
    }
  }
});

test('уведомления: 5-8 на студента, есть непрочитанные', () => {
  const byStudent = new Map<string, NotificationSeed[]>();
  for (const notification of data.notifications) {
    assert.ok(notification.title.length > 0 && notification.body.length > 0);
    if (notification.link !== null) {
      assert.ok(notification.link.startsWith('/'), 'ссылка относительная');
    }
    const list = byStudent.get(notification.userLogin) ?? [];
    list.push(notification);
    byStudent.set(notification.userLogin, list);
  }

  assert.equal(byStudent.size, 4);
  for (const [login, notifications] of byStudent) {
    assert.ok(notifications.length >= 5 && notifications.length <= 8, `${login}: ${notifications.length} уведомлений`);
    const unread = notifications.filter((notification) => !notification.read);
    assert.ok(unread.length >= 2, `${login}: ${unread.length} непрочитанных`);
  }
});

test('аудит: события ссылаются на существующих пользователей', () => {
  const logins = new Set(data.users.map((user) => user.login));
  assert.ok(data.auditEvents.length >= 5);
  for (const event of data.auditEvents) {
    assert.ok(logins.has(event.actorLogin), `актор ${event.actorLogin} существует`);
    assert.ok(event.action.length > 0 && event.entity.length > 0);
  }
});
