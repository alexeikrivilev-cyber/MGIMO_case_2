/**
 * Тесты уведомлений, объявлений и аудита.
 *
 * Уведомления адресуются пользователю: фильтрация по userId сессии,
 * чужое уведомление недоступно даже по идентификатору. Объявления —
 * по аудитории (все / институт / группа). Аудит пишется для действий
 * с данными.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyNotifications,
  getMyUnreadCount,
  markNotificationRead,
  markAllRead,
  getAnnouncementsFor,
  writeAuditEvent,
  getAuditTrail,
  OwnershipError,
  type AuthSession,
} from '../src/index.js';
import {
  resetTestData,
  closeTestDb,
  createGroup,
  createStudent,
  createUser,
  createNotification,
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';

const MY_FACULTY = 'Институт математики, информационных технологий и физики';
const OTHER_FACULTY = 'Институт права, социального управления и безопасности';

let mySession: AuthSession;
let otherSession: AuthSession;
let myUserId: string;
let otherUserId: string;
let myGroupId: string;
let otherGroupId: string;
let myNotificationId: string;
let otherNotificationId: string;

test.before(async () => {
  await resetTestData();

  const myGroup = await createGroup('УВЕ-31-1', MY_FACULTY);
  const otherGroup = await createGroup('УВЕ-99-9', OTHER_FACULTY);
  const me = await createStudent('student-notifications', myGroup.id, { faculty: MY_FACULTY });
  const other = await createStudent('student-other-notifications', otherGroup.id, {
    faculty: OTHER_FACULTY,
  });
  const staff = await createUser('staff-notifications', 'STAFF');

  myUserId = me.userId;
  otherUserId = other.userId;
  myGroupId = myGroup.id;
  otherGroupId = otherGroup.id;

  myNotificationId = await createNotification(myUserId, { title: 'Моё уведомление', read: false });
  await createNotification(myUserId, { title: 'Моё непрочитанное', read: false });
  await createNotification(myUserId, { title: 'Моё прочитанное', read: true, type: 'ANNOUNCEMENT' });
  otherNotificationId = await createNotification(otherUserId, { title: 'Чужое уведомление' });

  // Объявления: для всех, для моего института, для чужого института,
  // для моей группы, для чужой группы, закреплённое.
  const authorId = staff.id;
  await prisma().announcement.createMany({
    data: [
      { title: 'Для всех', body: 'общее', audience: 'ALL', authorId },
      { title: 'Мой институт', body: 'факультетское', audience: 'FACULTY', faculty: MY_FACULTY, authorId },
      { title: 'Чужой институт', body: 'не моё', audience: 'FACULTY', faculty: OTHER_FACULTY, authorId },
      { title: 'Моя группа', body: 'групповое', audience: 'GROUP', groupId: myGroupId, authorId },
      { title: 'Чужая группа', body: 'не моё', audience: 'GROUP', groupId: otherGroupId, authorId },
      {
        title: 'Закреплённое',
        body: 'важно',
        audience: 'ALL',
        authorId,
        pinned: true,
        publishedAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ],
  });

  await writeAuditEvent({
    actorUserId: myUserId,
    action: 'test.action',
    entity: 'Notification',
    entityId: myNotificationId,
    meta: { source: 'test' },
  });

  mySession = await authSessionFor(myUserId);
  otherSession = await authSessionFor(otherUserId);
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

test('лента уведомлений: только свои, сначала новые', async () => {
  const notifications = await getMyNotifications(mySession);

  assert.equal(notifications.length, 3, 'чужие уведомления не видны');
  assert.ok(notifications.every((notification) => notification.title.startsWith('Моё')));
  const dates = notifications.map((notification) => notification.createdAt.getTime());
  assert.deepEqual([...dates].sort((a, b) => b - a), dates, 'сортировка от новых');
});

test('счётчик непрочитанных', async () => {
  assert.equal(await getMyUnreadCount(mySession), 2);
  assert.equal(await getMyUnreadCount(otherSession), 1);
});

test('отметка о прочтении: своё проходит, чужое → OwnershipError', async () => {
  await markNotificationRead(mySession, myNotificationId);
  assert.equal(await getMyUnreadCount(mySession), 1);

  // Повторная отметка идемпотентна.
  await markNotificationRead(mySession, myNotificationId);
  assert.equal(await getMyUnreadCount(mySession), 1);

  await assert.rejects(
    () => markNotificationRead(mySession, otherNotificationId),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
  await assert.rejects(
    () => markNotificationRead(mySession, '00000000-0000-4000-8000-000000000000'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'NOT_OWNER',
  );
});

test('отметить все прочитанными', async () => {
  const { updated } = await markAllRead(mySession);
  assert.equal(updated, 1);
  assert.equal(await getMyUnreadCount(mySession), 0);

  // У другого пользователя счётчик не тронут.
  assert.equal(await getMyUnreadCount(otherSession), 1);
});

test('объявления: все + свой институт + своя группа, закреплённые сверху', async () => {
  const announcements = await getAnnouncementsFor(mySession);

  const titles = announcements.map((announcement) => announcement.title);
  assert.equal(announcements.length, 4, 'только релевантные аудитории');
  assert.ok(titles.includes('Для всех'));
  assert.ok(titles.includes('Мой институт'));
  assert.ok(titles.includes('Моя группа'));
  assert.ok(!titles.includes('Чужой институт'), 'объявление чужого института не видно');
  assert.ok(!titles.includes('Чужая группа'), 'объявление чужой группы не видно');

  assert.equal(announcements[0]?.title, 'Закреплённое', 'закреплённое первым, хотя старое');
  assert.equal(announcements[0]?.pinned, true);
  assert.equal(announcements[1]?.audienceLabel, 'Для всех');
});

test('объявления другого студента: свои аудитории', async () => {
  const announcements = await getAnnouncementsFor(otherSession);
  const titles = announcements.map((announcement) => announcement.title);

  assert.ok(titles.includes('Чужой институт'));
  assert.ok(titles.includes('Чужая группа'));
  assert.ok(!titles.includes('Мой институт'));
  assert.ok(!titles.includes('Моя группа'));
});

test('аудит: запись и чтение trail', async () => {
  const trail = await getAuditTrail('Notification', myNotificationId);
  assert.equal(trail.length, 1);
  assert.equal(trail[0]?.action, 'test.action');
  assert.equal(trail[0]?.actorUserId, myUserId);

  const id = await writeAuditEvent({
    actorUserId: myUserId,
    action: 'test.action',
    entity: 'Notification',
    entityId: myNotificationId,
    meta: { step: 2, ok: true, note: null },
  });
  assert.ok(id.length > 0);

  const row = await prisma().auditEvent.findUniqueOrThrow({ where: { id } });
  assert.deepEqual(row.meta, { step: 2, ok: true, note: null });

  await assert.rejects(
    () => writeAuditEvent({ actorUserId: '', action: 'x', entity: 'y' }),
    TypeError,
  );
});
