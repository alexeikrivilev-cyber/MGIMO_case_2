/**
 * Тесты переписки студент ↔ преподаватель (services/messaging.ts).
 *
 * Проверяемые инварианты (BRIEF v2 §4, ACCEPTANCE):
 *   - переписка доступна ТОЛЬКО верифицированному студенту (гейт на
 *     сервере, не только в UI): неверифицированный → VERIFICATION_REQUIRED;
 *   - преподаватель видит ФИО и ГРУППУ автора в каждом диалоге;
 *   - чужой диалог по conversationId → NOT_OWNER (анти-IDOR): студент не
 *     открывает, не пишет и не отмечает прочитанным чужую переписку;
 *   - диалог с тем же преподавателем не дублируется (пара уникальна);
 *   - отправка создаёт уведомление получателю, отметка о прочтении
 *     гасит только сообщения другого автора;
 *   - сотрудник деканата (STAFF без Teacher) перепиской не пользуется.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listMyConversations,
  getConversation,
  startConversationWithTeacher,
  sendMessage,
  markConversationRead,
  messagingRole,
  enqueueChannelDeliveries,
  enqueueChannelDeliveriesSafely,
  ValidationError,
  VerificationRequiredError,
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
  authSessionFor,
} from './helpers.js';
import { prisma } from '../src/db.js';

const FACULTY = 'Институт математики, информационных технологий и физики';

let verifiedStudent: AuthSession;
let unverifiedStudent: AuthSession;
let otherStudent: AuthSession;
let teacher: AuthSession;
let deaneryStaff: AuthSession;
let ownGroupId: string;
let ownStudentId: string;
let otherStudentId: string;
let ownTeacherId: string;
let otherTeacherId: string;
let ownConversationId: string;
let otherConversationId: string;

/** Статус верификации студента: заявка с фото (путь в хранилище — фикстура). */
async function setVerification(studentId: string, status: 'VERIFIED' | 'PENDING'): Promise<void> {
  await prisma().studentVerification.create({
    data: {
      studentId,
      status,
      idCardPhotoPath: `id-cards/${studentId}/fixture.jpg`,
      recognizedLastName: 'Иванов',
      recognizedFirstName: 'Александр',
      recognizedGroupName: 'Группа-фикстура',
      recognizedCardNumber: 'UDGU-TEST-0000',
      matchScore: status === 'VERIFIED' ? 1 : null,
    },
  });
}

test.before(async () => {
  await resetTestData();

  const group = await createGroup('ПЕР-31-1', FACULTY);
  ownGroupId = group.id;

  const own = await createStudent('msg-own', group.id, { lastName: 'Иванов', firstName: 'Александр' });
  const other = await createStudent('msg-other', group.id, { lastName: 'Петрова', firstName: 'Мария' });
  const unverified = await createStudent('msg-unverified', group.id, {
    lastName: 'Сидоров',
    firstName: 'Пётр',
  });
  ownStudentId = own.studentId;
  otherStudentId = other.studentId;

  // Гейт: у первого и третьего — подтверждённый билет, у второго — заявка
  // на проверке (именно он проверяет, что переписка закрыта до сверки).
  await setVerification(own.studentId, 'VERIFIED');
  await setVerification(other.studentId, 'VERIFIED');
  await setVerification(unverified.studentId, 'PENDING');

  const ownTeacher = await createTeacher('msg-teacher');
  const otherTeacher = await createTeacher('msg-teacher-2');
  ownTeacherId = ownTeacher.teacherId;
  otherTeacherId = otherTeacher.teacherId;

  const staff = await createUser('msg-staff', 'STAFF'); // faculty = null → не преподаватель

  verifiedStudent = await authSessionFor(own.userId);
  unverifiedStudent = await authSessionFor(unverified.userId);
  otherStudent = await authSessionFor(other.userId);
  teacher = await authSessionFor(ownTeacher.userId);
  deaneryStaff = await authSessionFor(staff.id);

  // Диалоги: свой (с одним непрочитанным ответом преподавателя) и чужой.
  const ownConversation = await prisma().conversation.create({
    data: { studentId: own.studentId, teacherId: ownTeacher.teacherId },
    select: { id: true },
  });
  ownConversationId = ownConversation.id;
  await prisma().message.create({
    data: {
      conversationId: ownConversationId,
      authorUserId: own.userId,
      body: 'Когда можно подойти по курсовой?',
      readAt: new Date(),
    },
  });
  await prisma().message.create({
    data: {
      conversationId: ownConversationId,
      authorUserId: ownTeacher.userId,
      body: 'Четверг, 14:00, аудитория У-418.',
      readAt: null,
    },
  });

  const otherConversation = await prisma().conversation.create({
    data: { studentId: other.studentId, teacherId: otherTeacher.teacherId },
    select: { id: true },
  });
  otherConversationId = otherConversation.id;
  await prisma().message.create({
    data: {
      conversationId: otherConversationId,
      authorUserId: other.userId,
      body: 'Чужое сообщение, которое нельзя прочитать.',
      readAt: null,
    },
  });
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Режим и гейт верификации
// ---------------------------------------------------------------------------

test('режим переписки определяется ролью сессии', () => {
  assert.equal(messagingRole(verifiedStudent.user), 'student');
  assert.equal(messagingRole(teacher.user), 'teacher');
  // Сотрудник деканата: STAFF без профиля Teacher — переписка не его раздел.
  assert.equal(messagingRole(deaneryStaff.user), 'none');
});

test('неверифицированный студент не попадает в переписку (гейт на сервере)', async () => {
  await assert.rejects(() => listMyConversations(unverifiedStudent), VerificationRequiredError);
  await assert.rejects(() => getConversation(unverifiedStudent, ownConversationId), VerificationRequiredError);
  await assert.rejects(
    () => sendMessage(unverifiedStudent, ownConversationId, { body: 'Пустите' }),
    VerificationRequiredError,
  );
});

test('сотрудник деканата не участвует в переписке', async () => {
  await assert.rejects(() => listMyConversations(deaneryStaff), OwnershipError);
});

// ---------------------------------------------------------------------------
// Список диалогов и содержимое
// ---------------------------------------------------------------------------

test('студент видит свои диалоги: преподаватель, последнее сообщение, непрочитанные', async () => {
  const conversations = await listMyConversations(verifiedStudent);
  assert.equal(conversations.length, 1);
  const conversation = conversations[0];
  assert.ok(conversation);
  assert.equal(conversation.id, ownConversationId);
  assert.equal(conversation.peer.fullName, 'Преподавательская Ольга Игоревна');
  assert.equal(conversation.peer.department, 'Кафедра информационных технологий');
  assert.equal(conversation.peer.groupName, null, 'у преподавателя нет группы — это данные студента');
  assert.equal(conversation.lastMessage?.mine, false, 'последнее сообщение — ответ преподавателя');
  assert.equal(conversation.unreadCount, 1);
});

test('преподаватель видит диалоги со студентами: ФИО и группа автора', async () => {
  const conversations = await listMyConversations(teacher);
  assert.equal(conversations.length, 1);
  const conversation = conversations[0];
  assert.ok(conversation);
  assert.equal(conversation.peer.id, ownStudentId);
  assert.equal(conversation.peer.fullName, 'Иванов Александр Дмитриевич');
  // Требование BRIEF v2: преподаватель понимает, кто пишет.
  assert.equal(conversation.peer.groupName, 'ПЕР-31-1');
  assert.equal(conversation.unreadCount, 0, 'сообщение студента прочитано');
});

test('диалог с сообщениями: автор, прочтение, порядок по времени', async () => {
  const detail = await getConversation(verifiedStudent, ownConversationId);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0]?.mine, true);
  assert.equal(detail.messages[1]?.mine, false);
  assert.equal(detail.messages[1]?.readAt, null, 'ответ преподавателя ещё не прочитан');
  assert.equal(detail.unreadCount, 1);
});

// ---------------------------------------------------------------------------
// Анти-IDOR: чужая переписка
// ---------------------------------------------------------------------------

test('student2 не открывает чужой диалог по conversationId', async () => {
  await assert.rejects(() => getConversation(otherStudent, ownConversationId), OwnershipError);
  await assert.rejects(() => sendMessage(otherStudent, ownConversationId, { body: 'Хочу посмотреть' }), OwnershipError);
  await assert.rejects(() => markConversationRead(otherStudent, ownConversationId), OwnershipError);
  // Свой диалог student2 при этом открывается — доступ не сломан целиком.
  const own = await getConversation(otherStudent, otherConversationId);
  assert.equal(own.messages.length, 1);
});

test('несуществующий диалог не отличается от чужого (NOT_OWNER)', async () => {
  await assert.rejects(
    () => getConversation(verifiedStudent, '00000000-0000-4000-8000-000000000000'),
    OwnershipError,
  );
});

// ---------------------------------------------------------------------------
// Начало диалога
// ---------------------------------------------------------------------------

test('студент начинает диалог с преподавателем; повтор не дублирует диалог', async () => {
  const first = await startConversationWithTeacher(verifiedStudent, { teacherId: otherTeacherId });
  assert.equal(first.peer.fullName, 'Преподавательская Ольга Игоревна');
  assert.equal(first.messages.length, 0);

  const second = await startConversationWithTeacher(verifiedStudent, { teacherId: otherTeacherId });
  assert.equal(second.id, first.id, 'пара «студент + преподаватель» уникальна');

  const conversations = await listMyConversations(verifiedStudent);
  assert.equal(conversations.length, 2, 'второго диалога с тем же преподавателем не появилось');
});

test('преподаватель не может начать диалог сам', async () => {
  await assert.rejects(
    () => startConversationWithTeacher(teacher, { teacherId: otherTeacherId }),
    OwnershipError,
  );
});

test('неизвестный преподаватель → NOT_FOUND', async () => {
  await assert.rejects(
    () => startConversationWithTeacher(verifiedStudent, { teacherId: '00000000-0000-4000-8000-000000000000' }),
    ValidationError,
  );
});

// ---------------------------------------------------------------------------
// Отправка, уведомление, прочтение
// ---------------------------------------------------------------------------

test('отправка сообщения: создаётся запись, получатель уведомлён, аудит', async () => {
  const before = await prisma().notification.count({
    where: { userId: (await prisma().teacher.findUniqueOrThrow({ where: { id: ownTeacherId } })).userId },
  });

  const message = await sendMessage(verifiedStudent, ownConversationId, {
    body: '  Хорошо, приду в четверг.  ',
  });
  assert.equal(message.body, 'Хорошо, приду в четверг.', 'пробелы по краям обрезаются');
  assert.equal(message.mine, true);

  const after = await prisma().notification.count({
    where: { userId: (await prisma().teacher.findUniqueOrThrow({ where: { id: ownTeacherId } })).userId },
  });
  assert.equal(after, before + 1, 'получателю пришло уведомление');

  const notification = await prisma().notification.findFirst({
    where: { type: 'MESSAGE' },
    orderBy: { createdAt: 'desc' },
  });
  assert.match(notification?.link ?? '', /^\/messages$/, 'уведомление ведёт в переписку');

  const audit = await prisma().auditEvent.findFirst({
    where: { action: 'message.send', entityId: ownConversationId },
  });
  assert.ok(audit, 'отправка записана в аудит');
});

test('пустое сообщение не отправляется', async () => {
  await assert.rejects(() => sendMessage(verifiedStudent, ownConversationId, { body: '   ' }), ValidationError);
});

test('уведомление копируется в каналы получателя (outbox BRIEF v3)', async () => {
  // Отдельный диалог: тест не трогает непрочитанные в общей фикстуре.
  const conversation = await startConversationWithTeacher(verifiedStudent, { teacherId: otherTeacherId });
  const recipientUserId = (
    await prisma().teacher.findUniqueOrThrow({ where: { id: otherTeacherId } })
  ).userId;
  // Преподаватель привязал Telegram: ответ должен уйти и на сайт, и в канал.
  await prisma().oAuthAccount.create({
    data: { userId: recipientUserId, provider: 'TELEGRAM', providerAccountId: 'tg-msg-teacher' },
  });

  const message = await sendMessage(verifiedStudent, conversation.id, { body: 'Перенесём на пятницу.' });
  assert.equal(message.mine, true);

  const deliveries = await prisma().channelDelivery.findMany({ where: { userId: recipientUserId } });
  assert.equal(deliveries.length, 1, 'одна запись на привязанный канал');
  assert.equal(deliveries[0]?.provider, 'TELEGRAM');
  assert.equal(deliveries[0]?.status, 'PENDING');

  // Текст канала = текст уведомления на сайте (источник истины); ссылка
  // кабинета дописывается к телу (модель outbox не хранит её отдельно).
  const notification = await prisma().notification.findFirst({
    where: { userId: recipientUserId, type: 'MESSAGE' },
    orderBy: { createdAt: 'desc' },
  });
  assert.equal(deliveries[0]?.title, notification?.title);
  assert.ok(
    (deliveries[0]?.body ?? '').startsWith(notification?.body ?? ''),
    'тело доставки начинается с текста уведомления сайта',
  );
  assert.match(deliveries[0]?.body ?? '', /\/messages$/, 'ссылка кабинета уходит частью текста');
});

test('сбой outbox не отменяет уведомление на сайте (безопасная постановка)', async () => {
  const ownUserId = (
    await prisma().student.findUniqueOrThrow({ where: { id: ownStudentId }, select: { userId: true } })
  ).userId;
  // Пустой заголовок — отказ enqueue. Через безопасную обёртку сбой не
  // бросается: уведомление на сайте остаётся источником истины, канал лишь
  // копия. Прямой enqueue так не умеет — он бросает TypeError.
  await assert.rejects(
    () => enqueueChannelDeliveries(ownUserId, { title: '   ', body: 'текст' }),
    TypeError,
  );
  await enqueueChannelDeliveriesSafely(ownUserId, { title: '   ', body: 'текст' }, 'test.outbox');
  assert.equal(
    await prisma().channelDelivery.count({ where: { userId: ownUserId } }),
    0,
    'некорректная запись в очередь не попадает',
  );

  // После сбоя очередь жива: корректная постановка проходит.
  await prisma().oAuthAccount.create({
    data: { userId: ownUserId, provider: 'VK_ID', providerAccountId: 'vk-msg-own' },
  });
  await enqueueChannelDeliveriesSafely(ownUserId, { title: 'Оценка', body: 'Экзамен сдан.' }, 'test.outbox');
  const deliveries = await prisma().channelDelivery.findMany({ where: { userId: ownUserId } });
  assert.equal(deliveries.length, 1, 'после сбоя очередь продолжает работать');
});

test('отметка о прочтении гасит только сообщения другого автора', async () => {
  // Преподаватель открыл диалог: сообщения студента становятся прочитанными.
  const marked = await markConversationRead(teacher, ownConversationId);
  assert.equal(marked, 1, 'непрочитанным было только последнее сообщение студента');

  const detail = await getConversation(teacher, ownConversationId);
  for (const message of detail.messages) {
    if (message.mine) {
      continue; // свои сообщения отметке о прочтении не подлежат
    }
    assert.notEqual(message.readAt, null, 'сообщение студента прочитано');
  }
  assert.equal(detail.unreadCount, 0, 'у преподавателя непрочитанных не осталось');

  // Счётчик студента не изменился: ответ преподавателя ещё не прочитан им.
  const studentDetail = await getConversation(verifiedStudent, ownConversationId);
  assert.equal(studentDetail.unreadCount, 1, 'студент всё ещё видит непрочитанный ответ');

  // Студент открыл диалог — его счётчик непрочитанных обнулился.
  await markConversationRead(verifiedStudent, ownConversationId);
  const afterStudent = await getConversation(verifiedStudent, ownConversationId);
  assert.equal(afterStudent.unreadCount, 0);
});
