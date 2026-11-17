/**
 * Инварианты сидера: гоняем buildSeedData() (чистая генерация, без БД)
 * и проверяем уникальность, связность и требования кейса.
 * Тест падает, если сидер сломан — например, если из расписания
 * пропали переносы/отмены или у student1 нет долга.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'argon2';
import { DEMO_ACCOUNTS } from '@udgu/ui';
import {
  buildSeedData,
  TEST_PASSWORD,
  SCHEDULE_HORIZON_DAYS,
  SEED_COUNTS,
  UNIVERSITY_NAME,
  UNIVERSITY_SHORT_NAME,
  UNIVERSITY_CITY,
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
const todayKey = today.toISOString().slice(0, 10);
// Расписание покрывает две недели, НАЧИНАЯ С СЕГОДНЯ: экран «Сегодня»
// показывает реальные пары, а не пустое состояние.
const windowStart = today;
const windowEnd = addDays(today, SCHEDULE_HORIZON_DAYS);
const windowStartKey = windowStart.toISOString().slice(0, 10);
const windowEndKey = windowEnd.toISOString().slice(0, 10);

/** Код направления подготовки ФГОС: NN.NN.NN */
const PROGRAM_CODE = /^\d{2}\.\d{2}\.\d{2}$/;

test('сидер создаёт заявленный набор сущностей', () => {
  assert.equal(data.users.length, SEED_COUNTS.students + SEED_COUNTS.teachers + 2);
  assert.equal(data.students.length, 4);
  assert.equal(data.groups.length, 8);
  assert.equal(data.subjects.length, 80);
  assert.equal(data.teachers.length, 16);
  assert.equal(SEED_COUNTS.institutes, 8);
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

test('faculty сотрудника деканата: staff1 привязан к институту, админ и преподаватели — null', () => {
  const byLogin = new Map(data.users.map((user) => [user.login, user]));

  // Сотрудник деканата видит только свой факультет (ARCHITECTURE §4):
  // факультет взят из института, где учится большинство студентов сидера.
  const staffFaculty = byLogin.get('staff1')?.faculty;
  assert.equal(staffFaculty, 'Институт математики, информационных технологий и физики');

  // ADMIN: null = все факультеты.
  assert.equal(byLogin.get('admin1')?.faculty, null, 'админ видит все факультеты (faculty = null)');

  // Преподаватель (STAFF + профиль Teacher) в кабинет деканата не попадает:
  // faculty = null → STAFF_ONLY (fail-closed).
  for (const teacher of data.teachers) {
    assert.equal(byLogin.get(teacher.login)?.faculty, null, `преподаватель ${teacher.login} без факультета`);
  }

  // Студентам faculty не нужен: их институт живёт в Student.faculty.
  for (const student of data.students) {
    assert.equal(byLogin.get(student.login)?.faculty, null, `студент ${student.login} без faculty в User`);
  }

  // Факультет сотрудника совпадает с факультетом его студентов: иначе
  // кабинет staff1 был бы пустым.
  const staffStudents = data.students.filter((student) => student.faculty === staffFaculty);
  assert.ok(staffStudents.length >= 1, 'у сотрудника деканата есть студенты своего факультета');
  assert.ok(staffStudents.length < data.students.length, 'и есть студенты чужих факультетов (проверка scope)');
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

test('демо-доступы подсказки на входе существуют в сидере с заявленными ролями', () => {
  // Подсказка «Демо-доступ» на странице входа берёт аккаунты из
  // @udgu/ui: сидер обязан создавать каждого из них с той же ролью,
  // иначе кнопка подстановки приведёт к неудачному входу.
  const byLogin = new Map(data.users.map((user) => [user.login, user]));
  for (const account of DEMO_ACCOUNTS) {
    const user = byLogin.get(account.login);
    assert.ok(user, `демо-аккаунт ${account.login} должен создаваться сидером`);
    assert.equal(user.role, account.role, `роль ${account.login} совпадает с подсказкой на входе`);
  }
  assert.ok(DEMO_ACCOUNTS.length >= 4, 'в подсказке есть студенты, преподаватель, сотрудник и админ');
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

test('расписание покрывает 2 недели от сегодня с 5-6 парами в день', () => {
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

test('расписание начинается с сегодня: экран «Сегодня» не пустой', () => {
  const byGroupDay = new Map<string, number>();
  for (const entry of data.scheduleEntries) {
    const dayKey = `${entry.groupName}|${entry.date}`;
    byGroupDay.set(dayKey, (byGroupDay.get(dayKey) ?? 0) + 1);
  }
  // Сегодня — будний день? Тогда у каждой группы есть пары на сегодня.
  const weekday = (today.getUTCDay() + 6) % 7; // 0 — понедельник
  if (weekday < 5) {
    for (const group of data.groups) {
      const count = byGroupDay.get(`${group.name}|${todayKey}`) ?? 0;
      assert.ok(count >= 5, `группа ${group.name}: ${count} пар сегодня`);
    }
  }
  // Окно двух недель: минимум 10 будних дней × 8 групп.
  assert.ok(byGroupDay.size >= 8 * 10, `группо-дней: ${byGroupDay.size}, ожидалось >= 80`);
});

test('оценки: семестры 1-2 закрыты, семестр 3 — работы в процессе', () => {
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
    assert.deepEqual([...semesters].sort(), [1, 2, 3], `${login}: три семестра`);

    for (const grade of grades) {
      const key = `${grade.studentLogin}|${grade.subjectCode}|${grade.semester}|${grade.type}`;
      assert.equal(uniqueKeys.has(key), false, `дубль оценки ${key}`);
      uniqueKeys.add(key);

      if (grade.semester === 3) {
        // Текущий семестр: предстоящие работы без оценки — для «левериджа».
        assert.equal(grade.value, null, `семестр 3: работа ${grade.subjectCode} без оценки`);
        assert.equal(grade.passed, null);
        assert.ok(['EXAM', 'COURSEWORK'].includes(grade.type), 'предстоящая работа — экзамен или курсовая');
      } else if (grade.type === 'EXAM' || grade.type === 'COURSEWORK') {
        assert.ok(typeof grade.value === 'number' && grade.value >= 2 && grade.value <= 5, `значение ${grade.value} в диапазоне 2-5`);
        assert.equal(grade.passed, null);
      } else {
        assert.equal(grade.value, null);
        assert.equal(typeof grade.passed, 'boolean', 'у зачёта передан passed');
      }
    }
  }

  // Предстоящие работы есть у каждого студента — иначе «леверидж» считать нечем.
  for (const [login, grades] of byStudent) {
    const pending = grades.filter((grade) => grade.value === null && grade.type !== 'CREDIT');
    assert.equal(pending.length, 2, `${login}: ${pending.length} предстоящих работ`);
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

// ---------------------------------------------------------------------------
// Пивот на УдГУ: институты, направления, город
// ---------------------------------------------------------------------------

test('институты УдГУ: 8 штук, уникальные названия, город Ижевск', () => {
  assert.equal(data.groups.length, SEED_COUNTS.institutes);
  assert.equal(UNIVERSITY_NAME, 'Удмуртский государственный университет');
  assert.equal(UNIVERSITY_SHORT_NAME, 'УдГУ');
  assert.equal(UNIVERSITY_CITY, 'Ижевск');

  const instituteNames = new Set(data.groups.map((group) => group.faculty));
  assert.equal(instituteNames.size, 8, 'на каждый институт — своя группа');

  const expectedInstitutes = [
    'Институт математики, информационных технологий и физики',
    'Институт языка и литературы',
    'Институт истории и социологии',
    'Институт права, социального управления и безопасности',
    'Институт экономики и управления',
    'Институт физической культуры и спорта',
    'Институт искусств и дизайна',
    'Институт педагогики, психологии и социальных технологий',
  ];
  for (const name of expectedInstitutes) {
    assert.ok(instituteNames.has(name), `институт «${name}» присутствует в сидере`);
  }
});

test('направления подготовки — реальные коды бакалавриата УдГУ', () => {
  for (const group of data.groups) {
    const [code, ...rest] = group.direction.split(' ');
    assert.match(code ?? '', PROGRAM_CODE, `код направления ${code} — формат ФГОС`);
    assert.ok(rest.join(' ').length > 0, 'у направления есть название');
  }

  const codes = data.groups.map((group) => group.direction.split(' ')[0]);
  assert.equal(new Set(codes).size, codes.length, 'коды направлений не повторяются');

  const knownCodes = new Set([
    '09.03.03', '45.03.01', '46.03.01', '40.03.01',
    '38.03.05', '49.03.01', '54.03.01', '44.03.05',
  ]);
  for (const code of codes) {
    assert.ok(knownCodes.has(code ?? ''), `код ${code} — реальное направление УдГУ`);
  }
});

test('группы: корректные курсы и названия вида ПИ-24-1', () => {
  const names = data.groups.map((group) => group.name);
  assert.equal(new Set(names).size, names.length);

  for (const group of data.groups) {
    assert.ok(group.course >= 1 && group.course <= 4, `курс ${group.course} в диапазоне 1-4`);
    assert.match(group.name, /^[А-ЯЁ]{2,3}-\d{2}-\d$/, `название группы ${group.name}`);
    assert.ok(group.direction.length > 0);
  }

  for (const student of data.students) {
    const group = data.groups.find((candidate) => candidate.name === student.groupName);
    assert.ok(group, `группа ${student.groupName} существует`);
    assert.equal(group?.course, student.course, 'курс студента совпадает с курсом группы');
  }
});

// ---------------------------------------------------------------------------
// Синтетический реестр студбилетов
// ---------------------------------------------------------------------------

test('реестр студбилетов покрывает всех студентов и 2 незарегистрированные карточки', () => {
  const registry = data.identityRegistry;
  assert.equal(registry.length, SEED_COUNTS.identityRegistry);

  const cardNumbers = registry.map((entry) => entry.cardNumber);
  assert.equal(new Set(cardNumbers).size, cardNumbers.length, 'номера карточек уникальны');

  const groupNames = new Set(data.groups.map((group) => group.name));
  for (const entry of registry) {
    assert.ok(groupNames.has(entry.groupName), `группа ${entry.groupName} существует`);
    assert.ok(entry.lastName.length > 0 && entry.firstName.length > 0);
    assert.match(entry.program.split(' ')[0] ?? '', PROGRAM_CODE, `программа ${entry.program} содержит код ФГОС`);
    assert.ok(entry.course >= 1 && entry.course <= 4);
    assert.ok(entry.issuedAt < todayKey, 'карточка выдана в прошлом');
  }

  const studentCards = new Set(data.students.map((student) => student.studentCardNumber));
  for (const card of studentCards) {
    assert.ok(cardNumbers.includes(card), `карточка ${card} есть в реестре`);
  }

  const unregistered = registry.filter((entry) => !studentCards.has(entry.cardNumber));
  assert.equal(unregistered.length, 2, 'две «незарегистрированные» карточки');
  for (const entry of unregistered) {
    assert.ok(!data.students.some((student) => student.lastName === entry.lastName && student.firstName === entry.firstName),
      'незарегистрированная карточка принадлежит другому человеку');
  }
});

// ---------------------------------------------------------------------------
// Верификация студбилетов
// ---------------------------------------------------------------------------

test('верификация: статусы распределены как заявлено', () => {
  const byLogin = new Map(data.studentVerifications.map((v) => [v.studentLogin, v]));
  assert.equal(data.studentVerifications.length, 4);

  const expected: Record<string, 'VERIFIED' | 'PENDING' | 'REJECTED'> = {
    student1: 'VERIFIED',
    student2: 'PENDING',
    student3: 'REJECTED',
    student4: 'VERIFIED',
  };
  for (const [login, status] of Object.entries(expected)) {
    assert.equal(byLogin.get(login)?.status, status, `${login} → ${status}`);
  }

  const logins = new Set(data.users.map((user) => user.login));
  const groupNames = new Set(data.groups.map((group) => group.name));

  for (const verification of data.studentVerifications) {
    const student = data.students.find((candidate) => candidate.login === verification.studentLogin);
    assert.ok(student, `студент ${verification.studentLogin} существует`);
    assert.match(
      verification.photoFileName,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}\.jpg$/,
      'имя файла фото — uuid с расширением',
    );
    assert.equal(verification.recognizedCardNumber, student?.studentCardNumber, 'распознанный номер совпадает с реестром');
    assert.equal(verification.recognizedLastName, student?.lastName);
    assert.equal(verification.recognizedFirstName, student?.firstName);
    assert.ok(groupNames.has(verification.recognizedGroupName), 'распознанная группа существует');

    if (verification.status === 'VERIFIED') {
      assert.ok(verification.reviewerLogin && logins.has(verification.reviewerLogin), 'у проверенной заявки есть проверяющий');
      assert.ok(verification.reviewedAt, 'у проверенной заявки есть дата решения');
      assert.ok((verification.matchScore ?? 0) >= 0.9, 'высокий балл сверки');
      assert.ok(verification.reviewComment === null);
    }

    if (verification.status === 'PENDING') {
      assert.equal(verification.reviewerLogin, null, 'заявка в очереди без проверяющего');
      assert.equal(verification.reviewedAt, null, 'заявка в очереди без даты решения');
      assert.equal(verification.reviewComment, null);
      assert.ok(verification.submittedAt <= new Date().toISOString(), 'подана в прошлом');
    }

    if (verification.status === 'REJECTED') {
      assert.ok(verification.reviewerLogin, 'у отказа есть проверяющий');
      assert.ok(verification.reviewedAt, 'у отказа есть дата решения');
      assert.ok(verification.reviewComment && verification.reviewComment.length > 0, 'у отказа есть комментарий');
      assert.ok((verification.matchScore ?? 1) < 0.8, 'низкий балл сверки');
      assert.notEqual(verification.recognizedGroupName, student?.groupName, 'отказ — из-за несовпадения группы');
    }
  }
});

// ---------------------------------------------------------------------------
// OAuth: привязки и эмуляция согласия
// ---------------------------------------------------------------------------

test('oauth-привязки: у двух студентов по одному провайдеру', () => {
  assert.equal(data.oauthAccounts.length, 2);

  const userLogins = new Set(data.users.map((user) => user.login));
  const pairs = new Set<string>();
  const providerAccounts = new Set<string>();
  const providers = new Set<string>();

  for (const account of data.oauthAccounts) {
    assert.ok(userLogins.has(account.userLogin), `пользователь ${account.userLogin} существует`);
    assert.ok(['VK_ID', 'MAX', 'TELEGRAM'].includes(account.provider), `провайдер ${account.provider}`);
    assert.ok(account.providerAccountId.length > 0);
    assert.ok(account.createdAt.length > 0);

    pairs.add(`${account.userLogin}|${account.provider}`);
    providerAccounts.add(account.providerAccountId);
    providers.add(account.provider);
  }

  assert.equal(pairs.size, data.oauthAccounts.length, 'пары (пользователь, провайдер) уникальны');
  assert.equal(providerAccounts.size, data.oauthAccounts.length, 'идентификаторы провайдеров уникальны');
  assert.ok(providers.has('VK_ID') && providers.has('TELEGRAM'), 'есть VK ID и Telegram');

  const studentsWithAccounts = new Set(data.oauthAccounts.map((account) => account.userLogin));
  assert.equal(studentsWithAccounts.size, 2, 'два разных студента');
  for (const login of studentsWithAccounts) {
    assert.match(login, /^student\d$/, 'привязки только у студентов');
  }
});

test('oauth-интенты: уникальные state, активный интент жив', () => {
  const states = data.oauthIntents.map((intent) => intent.state);
  assert.equal(new Set(states).size, states.length, 'state уникален');

  const groupNames = new Set(data.groups.map((group) => group.name));
  const nowIso = new Date().toISOString();

  for (const intent of data.oauthIntents) {
    assert.ok(['VK_ID', 'MAX', 'TELEGRAM'].includes(intent.provider));
    assert.ok(intent.purpose.length > 0);
    assert.ok(intent.fullName !== null || intent.login !== null, 'интент несёт ФИО или логин');
    if (intent.groupName !== null) {
      assert.ok(groupNames.has(intent.groupName), 'группа интента существует');
    }
    if (intent.consumedAt !== null) {
      assert.ok(intent.consumedAt >= intent.createdAt, 'использован после создания');
      assert.ok(intent.expiresAt >= intent.consumedAt, 'использован до истечения срока');
    } else {
      assert.ok(intent.expiresAt > nowIso, 'активный интент не истёк');
    }
  }

  assert.equal(data.oauthIntents.filter((intent) => intent.consumedAt === null).length, 1, 'один активный интент');
});

// ---------------------------------------------------------------------------
// Статус «болею»
// ---------------------------------------------------------------------------

test('болезни: 2 записи, корректные периоды, у student2 активная на сегодня', () => {
  assert.equal(data.sickLeaves.length, 2);

  const studentLogins = new Set(data.students.map((student) => student.login));
  for (const leave of data.sickLeaves) {
    assert.ok(studentLogins.has(leave.studentLogin), `студент ${leave.studentLogin} существует`);
    assert.ok(leave.dateFrom <= leave.dateTo, 'дата начала не позже даты окончания');
    if (leave.reason !== null) {
      assert.ok(leave.reason.length > 0, 'причина заполнена');
    }
  }

  const active = data.sickLeaves.filter(
    (leave) => leave.dateFrom <= todayKey && leave.dateTo >= todayKey,
  );
  assert.equal(active.length, 1, 'ровно одна активная болезнь');
  assert.equal(active[0]?.studentLogin, 'student2', 'болеет student2');

  const finished = data.sickLeaves.filter((leave) => leave.dateTo < todayKey);
  assert.equal(finished.length, 1, 'одна завершившаяся болезнь');
  assert.equal(finished[0]?.studentLogin, 'student1');
});

// ---------------------------------------------------------------------------
// Расписание преподавателей: консультации и часы приёма
// ---------------------------------------------------------------------------

test('часы приёма: 2-3 на преподавателя у 6 преподавателей, будни, время корректно', () => {
  const teacherLogins = new Set(data.teachers.map((teacher) => teacher.login));
  const byTeacher = new Map<string, number>();

  for (const hour of data.officeHours) {
    assert.ok(teacherLogins.has(hour.teacherLogin), `преподаватель ${hour.teacherLogin} существует`);
    assert.ok(Number.isInteger(hour.weekday), 'день недели — целое число');
    assert.ok(hour.weekday >= 1 && hour.weekday <= 7, `weekday ${hour.weekday} в диапазоне 1-7`);
    assert.ok(hour.weekday <= 5, 'консультации только по будням');
    assert.ok(hour.startTime < hour.endTime, `время начала ${hour.startTime} раньше окончания ${hour.endTime}`);
    assert.match(hour.startTime, /^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате HH:MM');
    assert.match(hour.endTime, /^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате HH:MM');
    assert.ok(hour.room.length > 0, 'аудитория указана');
    assert.ok(['CONSULTATION', 'RECEPTION', 'EXTRA_CLASS'].includes(hour.type), `тип ${hour.type}`);

    byTeacher.set(hour.teacherLogin, (byTeacher.get(hour.teacherLogin) ?? 0) + 1);
  }

  assert.equal(byTeacher.size, SEED_COUNTS.officeHourTeachers, 'шесть преподавателей с часами приёма');
  for (const [login, count] of byTeacher) {
    assert.ok(count >= 2 && count <= 3, `${login}: ${count} записи (ожидалось 2-3)`);
  }

  // У каждого преподавателя дни недели не повторяются.
  const weekdayKeys = new Set<string>();
  for (const hour of data.officeHours) {
    const key = `${hour.teacherLogin}|${hour.weekday}`;
    assert.equal(weekdayKeys.has(key), false, `дубль часа приёма ${key}`);
    weekdayKeys.add(key);
  }
});

// ---------------------------------------------------------------------------
// Переписка студент ↔ преподаватель
// ---------------------------------------------------------------------------

test('переписка: диалоги только у верифицированных студентов, сообщения по порядку', () => {
  assert.equal(data.conversations.length, SEED_COUNTS.conversations);

  const studentLogins = new Set(data.students.map((student) => student.login));
  const teacherLogins = new Set(data.teachers.map((teacher) => teacher.login));
  // Переписка закрыта гейтом верификации (BRIEF v2 §4): диалог
  // неверифицированного студента сломал бы демо-сценарий гейта.
  const verifiedLogins = new Set(
    data.studentVerifications
      .filter((verification) => verification.status === 'VERIFIED')
      .map((verification) => verification.studentLogin),
  );

  for (const conversation of data.conversations) {
    assert.ok(studentLogins.has(conversation.studentLogin), `студент ${conversation.studentLogin} существует`);
    assert.ok(teacherLogins.has(conversation.teacherLogin), `преподаватель ${conversation.teacherLogin} существует`);
    assert.ok(
      verifiedLogins.has(conversation.studentLogin),
      `диалог ${conversation.studentLogin}↔${conversation.teacherLogin} — только после верификации`,
    );
    assert.ok(conversation.messages.length >= 1, 'в диалоге есть сообщения');

    let previousMinutesAgo = Number.POSITIVE_INFINITY;
    for (const message of conversation.messages) {
      assert.ok(message.body.length > 0, 'текст сообщения заполнен');
      assert.ok(
        message.authorLogin === conversation.studentLogin || message.authorLogin === conversation.teacherLogin,
        'автор — участник диалога',
      );
      assert.ok(message.minutesAgo < previousMinutesAgo, 'сообщения идут от старых к новым');
      previousMinutesAgo = message.minutesAgo;
    }
  }

  // Пара «студент + преподаватель» не повторяется: диалог с тем же
  // преподавателем открывает существующую историю, а не создаёт вторую.
  const pairs = data.conversations.map((conversation) => `${conversation.studentLogin}|${conversation.teacherLogin}`);
  assert.equal(new Set(pairs).size, pairs.length, 'пары диалогов уникальны');

  // Хотя бы один диалог с непрочитанным сообщением — иначе счётчик
  // непрочитанных на экране переписки всегда был бы нулевым.
  const withUnread = data.conversations.filter((conversation) =>
    conversation.messages.some((message) => !message.read),
  );
  assert.ok(withUnread.length >= 1, 'есть диалог с непрочитанными сообщениями');
});
