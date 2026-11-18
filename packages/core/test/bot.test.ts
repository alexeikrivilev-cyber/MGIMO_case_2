/**
 * Тесты ядра ботов каналов доступа (BRIEF v3): Telegram / VK / MAX.
 *
 * Проверяется главное architectural-требование брифа: бот — тонкий
 * адаптер, он вызывает ТЕ ЖЕ сервисы кабинета, что и сайт, и получает
 * те же проверки владения. Поэтому тесты идут через handleBotCommand
 * (как их вызывал бы адаптер канала), а факт изменения данных
 * проверяется сервисами кабинета и напрямую в БД.
 *
 * Что покрыто:
 * - привязка канала: код одноразовый, просроченный код отклоняется,
 *   занятый providerAccountId отклоняется, повторная привязка
 *   идемпотентна, код на другой канал не работает;
 * - resolveChannelUser: свой канал находит, чужой/неизвестный — нет;
 * - команды: /schedule, /grades (гейт верификации и данные после),
 *   /request (заявка видна в listMyRequests), /sick, /notifications,
 *   /assistant, /start, /link, неизвестная команда, непривязанный канал;
 * - outbox: постановка в очередь по всем каналам пользователя, демо-
 *   режим, живая доставка, сбой доставки, чужая доставка недоступна.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUtcDays,
  botChannelProvider,
  botSessionFor,
  consumeBotLinkCode,
  createBotLinkCode,
  createMySickLeave,
  dateKey,
  dispatchPendingDeliveries,
  enqueueChannelDeliveries,
  getMyRequests,
  getMySickLeaves,
  handleBotCommand,
  listChannelInbox,
  mondayOfUtcWeek,
  OwnershipError,
  resolveChannelUser,
  startOfUtcDay,
  ValidationError,
  type AuthSession,
} from '../src/index.js';
import {
  authSessionFor,
  closeTestDb,
  createGrade,
  createGroup,
  createNotification,
  createScheduleEntry,
  createStudent,
  createSubject,
  createTeacher,
  createVerification,
  resetTestData,
} from './helpers.js';
import { prisma } from '../src/db.js';

const FACULTY = 'Институт математики, информационных технологий и физики';
const SUBJECT_NAME = 'Математический анализ';

let mySession: AuthSession;
let otherSession: AuthSession;
let myUserId: string;
let myStudentId: string;
let otherUserId: string;
let groupId: string;

test.before(async () => {
  await resetTestData();

  const group = await createGroup('БОТ-41-1', FACULTY);
  const teacher = await createTeacher('teacher-bot');
  const me = await createStudent('student-bot', group.id, { lastName: 'Ботов' });
  const other = await createStudent('student-bot-other', group.id, { lastName: 'Соседний' });
  const subjectId = await createSubject('БОТ-101', SUBJECT_NAME);

  myUserId = me.userId;
  myStudentId = me.studentId;
  otherUserId = other.userId;
  groupId = group.id;
  mySession = await authSessionFor(myUserId);
  otherSession = await authSessionFor(otherUserId);

  const today = startOfUtcDay(new Date());
  await createScheduleEntry({
    groupId,
    subjectId,
    teacherId: teacher.teacherId,
    date: dateKey(today),
    startTime: '09:00',
    endTime: '10:30',
    room: 'У-101',
  });
  await createScheduleEntry({
    groupId,
    subjectId,
    teacherId: teacher.teacherId,
    date: dateKey(addUtcDays(today, 1)),
    startTime: '10:45',
    endTime: '12:15',
    room: 'У-205',
  });
  // Пара в середине текущей недели — для /schedule week (любой день недели).
  await createScheduleEntry({
    groupId,
    subjectId,
    teacherId: teacher.teacherId,
    date: dateKey(addUtcDays(mondayOfUtcWeek(new Date()), 2)),
    startTime: '13:00',
    endTime: '14:30',
    room: 'У-311',
  });

  await createNotification(myUserId, { title: 'Перенос пары', body: 'Пара по математике перенесена.' });
  await createNotification(myUserId, {
    title: 'Заявка готова',
    body: 'Справка готова, заберите в деканате.',
    read: true,
  });
  await createNotification(otherUserId, { title: 'Чужое уведомление' });
});

test.after(async () => {
  await resetTestData();
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Привязка канала и resolveChannelUser
// ---------------------------------------------------------------------------

test('botSessionFor: сессия для сервисов кабинета без записи в Session', async () => {
  const session = await botSessionFor(myUserId, 'telegram');

  assert.equal(session.user.id, myUserId);
  assert.equal(session.user.studentId, myStudentId);
  // Сервисы кабинета работают с этой сессией как с обычной.
  const requests = await getMyRequests(session);
  assert.equal(requests.length, 0);
  // Бот НЕ создаёт строки Session: иначе таблицу сессий душили бы апдейты.
  assert.equal(await prisma().session.count({ where: { userId: myUserId } }), 1);

  await assert.rejects(
    () => botSessionFor('нет-такого-пользователя'),
    (error: unknown) => error instanceof OwnershipError && error.code === 'UNAUTHENTICATED',
  );
});

test('resolveChannelUser: свой канал находит, неизвестный и чужой — нет', async () => {
  // Привязку делаем ДРУГОМУ пользователю: у основного канал telegram
  // привязывается ниже, и одна учётная запись держит один аккаунт на канал.
  await prisma().oAuthAccount.create({
    data: { userId: otherUserId, provider: 'TELEGRAM', providerAccountId: 'tg-resolve-1' },
  });

  assert.equal(await resolveChannelUser('telegram', 'tg-resolve-1'), otherUserId);
  assert.equal(await resolveChannelUser('telegram', 'tg-неизвестный'), null);
  // Тот же идентификатор в другом канале привязкой не является.
  assert.equal(await resolveChannelUser('vk', 'tg-resolve-1'), null);
  assert.equal(await resolveChannelUser('max', ''), null);
});

test('привязка канала: код одноразовый, связь создаётся в OAuthAccount', async () => {
  const { code, expiresAt } = await createBotLinkCode(mySession);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.ok(expiresAt.getTime() > Date.now());

  const result = await consumeBotLinkCode(code, 'telegram', 'tg-bot-1');
  assert.equal(result.userId, myUserId);
  assert.equal(result.created, true);

  const account = await prisma().oAuthAccount.findUnique({ where: { providerAccountId: 'tg-bot-1' } });
  assert.equal(account?.userId, myUserId);
  assert.equal(account?.provider, 'TELEGRAM');
  assert.equal(await resolveChannelUser('telegram', 'tg-bot-1'), myUserId);

  // Код одноразовый: повторное использование отклоняется.
  await assert.rejects(
    () => consumeBotLinkCode(code, 'telegram', 'tg-bot-1'),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  // Аудит фиксирует привязку канала.
  const audit = await prisma().auditEvent.findFirst({
    where: { action: 'channel.link', entity: 'OAuthAccount' },
  });
  assert.equal(audit?.actorUserId, myUserId);
});

test('привязка канала: новый код гасит предыдущий', async () => {
  const first = await createBotLinkCode(mySession);
  const second = await createBotLinkCode(mySession);
  assert.notEqual(first.code, second.code);

  const records = await prisma().botLinkCode.findMany({ where: { userId: myUserId } });
  const active = records.filter((record) => record.consumedAt === null);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.code, second.code);
});

test('привязка канала: просроченный код не принимается', async () => {
  const { code } = await createBotLinkCode(mySession);
  await prisma().botLinkCode.update({
    where: { code },
    data: { expiresAt: new Date(Date.now() - 60 * 1000) },
  });

  await assert.rejects(
    () => consumeBotLinkCode(code, 'telegram', 'tg-expired'),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );
  assert.equal(await resolveChannelUser('telegram', 'tg-expired'), null);
});

test('привязка канала: занятый providerAccountId чужого пользователя → отказ', async () => {
  await prisma().oAuthAccount.create({
    data: { userId: otherUserId, provider: 'VK_ID', providerAccountId: 'vk-busy' },
  });
  const { code } = await createBotLinkCode(mySession);

  await assert.rejects(
    () => consumeBotLinkCode(code, 'vk', 'vk-busy'),
    (error: unknown) => error instanceof ValidationError && error.code === 'CONFLICT',
  );
  // Код не сгорел: студент может привязать свой аккаунт.
  const record = await prisma().botLinkCode.findUnique({ where: { code } });
  assert.equal(record?.consumedAt, null);
});

test('привязка канала: код, выданный на другой канал, не работает', async () => {
  const { code } = await createBotLinkCode(mySession, 'VK_ID');
  await assert.rejects(
    () => consumeBotLinkCode(code, 'telegram', 'tg-other-channel'),
    (error: unknown) => error instanceof ValidationError && error.code === 'INVALID_INPUT',
  );

  // Но в своём канале принимается.
  const result = await consumeBotLinkCode(code, 'vk', 'vk-bot-1');
  assert.equal(result.userId, myUserId);
  assert.equal(result.created, true);
});

test('привязка канала: повторная привязка того же пользователя идемпотентна', async () => {
  const { code } = await createBotLinkCode(mySession);
  const again = await consumeBotLinkCode(code, 'telegram', 'tg-bot-1');

  assert.equal(again.userId, myUserId);
  assert.equal(again.created, false);
  const accounts = await prisma().oAuthAccount.findMany({
    where: { userId: myUserId, provider: 'TELEGRAM' },
  });
  assert.equal(accounts.length, 1);
});

// ---------------------------------------------------------------------------
// Команды кабинета
// ---------------------------------------------------------------------------

test('/schedule отдаёт расписание студента тем же сервисом, что и сайт', async () => {
  const replies = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/schedule' });

  assert.equal(replies.length, 1);
  assert.match(replies[0]?.text ?? '', /Сегодня/);
  assert.match(replies[0]?.text ?? '', new RegExp(SUBJECT_NAME));
  assert.match(replies[0]?.text ?? '', /09:00–10:30/);
  assert.match(replies[0]?.text ?? '', /У-101/);
});

test('/schedule week отдаёт расписание на неделю', async () => {
  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/schedule week',
  });

  assert.ok(replies.length >= 1);
  const text = replies.map((item) => item.text).join('\n');
  assert.match(text, new RegExp(SUBJECT_NAME));
  assert.match(text, /13:00–14:30/);
  // Пустые дни не показываются: сообщение начинается с дня недели.
  assert.match(replies[0]?.text ?? '', /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс) \d{2}\.\d{2}/);
});

test('/grades: гейт верификации до верификации и оценки после', async () => {
  const gated = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/grades',
  });
  assert.match(gated[0]?.text ?? '', /верификац/i);

  await createVerification(myStudentId, 'VERIFIED');
  const subjectId = await prisma().subject.findFirstOrThrow({ where: { code: 'БОТ-101' } });
  await createGrade({
    studentId: myStudentId,
    subjectId: subjectId.id,
    value: 5,
    type: 'EXAM',
    date: dateKey(new Date()),
    semester: 2,
  });

  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/grades',
  });
  assert.match(replies[0]?.text ?? '', /средний балл 5/);
  assert.match(replies[0]?.text ?? '', new RegExp(SUBJECT_NAME));
});

test('/request создаёт заявку, видимую в listMyRequests того же пользователя', async () => {
  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/request справка об обучении',
  });
  assert.match(replies[0]?.text ?? '', /Справка создана · новая/);

  const requests = await getMyRequests(mySession);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.type, 'REFERENCE');
  assert.equal(requests[0]?.status, 'NEW');
  assert.equal(requests[0]?.formData.purpose, 'об обучении');

  // Заявка другого студента не видна: владение проверяет сервис.
  const otherRequests = await getMyRequests(otherSession);
  assert.equal(otherRequests.length, 0);
});

test('/request без текста подсказывает формат', async () => {
  const replies = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/request' });
  assert.match(replies[0]?.text ?? '', /Укажите текст/);
});

test('/sick создаёт отметку «болею» тем же сервисом, что и кабинет', async () => {
  const from = dateKey(addUtcDays(startOfUtcDay(new Date()), 10));
  const to = dateKey(addUtcDays(startOfUtcDay(new Date()), 12));
  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: `/sick ${from} ${to} ОРВИ`,
  });
  assert.match(replies[0]?.text ?? '', /Отметка «болею» создана/);

  const leaves = await getMySickLeaves(mySession);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0]?.reason, 'ОРВИ');
  assert.equal(dateKey(leaves[0]?.dateFrom ?? new Date(0)), from);

  // Период накладывается на активную запись → отказ сервиса текстом для человека.
  const conflict = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: `/sick ${dateKey(addUtcDays(startOfUtcDay(new Date()), 11))} ${to} ангина`,
  });
  assert.match(conflict[0]?.text ?? '', /пересекается|уже отмечен/i);

  // Некорректный формат даты → подсказка формата.
  const wrong = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/sick завтра послезавтра' });
  assert.match(wrong[0]?.text ?? '', /Формат: \/sick/);
});

test('/notifications отдаёт ленту уведомлений пользователя', async () => {
  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/notifications',
  });
  assert.match(replies[0]?.text ?? '', /Уведомления · новых \d/);
  assert.match(replies[0]?.text ?? '', /Перенос пары/);
  assert.match(replies[0]?.text ?? '', /Заявка готова/);
  // Чужое уведомление в ленту не попадает.
  assert.doesNotMatch(replies[0]?.text ?? '', /Чужое уведомление/);
});

test('/assistant отвечает по данным владельца сессии', async () => {
  const replies = await handleBotCommand({
    channel: 'telegram',
    channelUserId: 'tg-bot-1',
    text: '/assistant расписание на сегодня',
  });
  assert.match(replies[0]?.text ?? '', new RegExp(SUBJECT_NAME));
});

test('/start показывает статус привязки, /link открывает команды канала', async () => {
  const before = await handleBotCommand({ channel: 'max', channelUserId: 'max-new', text: '/start' });
  assert.match(before[0]?.text ?? '', /Кабинет студента УдГУ/);
  assert.match(before[0]?.text ?? '', /Аккаунт не привязан/);

  // Непривязанный канал на любой команде — приглашение привязать.
  const refused = await handleBotCommand({ channel: 'max', channelUserId: 'max-new', text: '/grades' });
  assert.equal(refused[0]?.text, 'Привяжите аккаунт: /link <код> из кабинета.');

  const { code } = await createBotLinkCode(mySession, 'MAX');
  const linked = await handleBotCommand({ channel: 'max', channelUserId: 'max-new', text: `/link ${code}` });
  assert.match(linked[0]?.text ?? '', /Аккаунт привязан/);

  const after = await handleBotCommand({ channel: 'max', channelUserId: 'max-new', text: '/start' });
  assert.match(after[0]?.text ?? '', /Аккаунт привязан\./);

  const schedule = await handleBotCommand({ channel: 'max', channelUserId: 'max-new', text: '/schedule' });
  assert.match(schedule[0]?.text ?? '', new RegExp(SUBJECT_NAME));
});

test('/link без кода и неизвестная команда → короткая помощь', async () => {
  const noCode = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/link' });
  assert.match(noCode[0]?.text ?? '', /Укажите код/);

  const unknown = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/чёточки' });
  assert.match(unknown[0]?.text ?? '', /Команды кабинета/);
  assert.match(unknown[0]?.text ?? '', /\/schedule/);

  const help = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-bot-1', text: '/help' });
  assert.equal(help[0]?.text, unknown[0]?.text);
});

test('боту недоступны действия не-студента', async () => {
  const staff = await prisma().user.create({
    data: { login: 'staff-bot', passwordHash: 'x', role: 'STAFF' },
    select: { id: true },
  });
  await prisma().oAuthAccount.create({
    data: { userId: staff.id, provider: 'TELEGRAM', providerAccountId: 'tg-staff' },
  });

  const replies = await handleBotCommand({ channel: 'telegram', channelUserId: 'tg-staff', text: '/schedule' });
  assert.match(replies[0]?.text ?? '', /только студенту/i);
});

// ---------------------------------------------------------------------------
// Outbox доставки в каналы
// ---------------------------------------------------------------------------

test('outbox: уведомление ставится в очередь всех каналов пользователя', async () => {
  // Ровно по одному аккаунту на каждый канал: набор детерминированный,
  // независимо от того, какие коды гасили предыдущие тесты.
  await prisma().oAuthAccount.deleteMany({ where: { userId: myUserId } });
  await prisma().oAuthAccount.createMany({
    data: [
      { userId: myUserId, provider: 'TELEGRAM', providerAccountId: 'tg-outbox' },
      { userId: myUserId, provider: 'VK_ID', providerAccountId: 'vk-outbox' },
      { userId: myUserId, provider: 'MAX', providerAccountId: 'max-outbox' },
    ],
  });
  const channels = await prisma().oAuthAccount.count({ where: { userId: myUserId } });
  assert.equal(channels, 3);

  const items = await enqueueChannelDeliveries(myUserId, {
    title: 'Перенос пары',
    body: 'Пара по математике перенесена.',
    link: '/schedule',
  });
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.status === 'PENDING'));
  assert.deepEqual(
    items.map((item) => item.channel).sort(),
    ['max', 'telegram', 'vk'],
  );
  // Ссылка кабинета уходит в канал частью текста сообщения.
  assert.ok(items.every((item) => item.body.endsWith('/schedule')));
});

test('outbox: демо-режим без адаптера закрывает очередь статусом DEMO', async () => {
  const result = await dispatchPendingDeliveries(null);
  assert.equal(result.sent, 0);
  assert.equal(result.demo, 3);
  assert.equal(result.failed, 0);

  const rows = await prisma().channelDelivery.findMany({ where: { userId: myUserId } });
  assert.ok(rows.every((row) => row.status === 'DEMO' && row.sentAt !== null));

  // Повторный проход нечего брать: демо-записи не остаются в PENDING.
  assert.equal((await dispatchPendingDeliveries(null)).processed, 0);
});

test('outbox: живой адаптер доставляет и закрывает записи как SENT', async () => {
  await enqueueChannelDeliveries(myUserId, { title: 'Оценка выставлена', body: 'Экзамен сдан.' });

  const delivered: Array<{ provider: string; title: string; body: string }> = [];
  const result = await dispatchPendingDeliveries(async (provider, title, body) => {
    delivered.push({ provider, title, body });
  });

  assert.equal(result.sent, 3);
  assert.equal(result.failed, 0);
  assert.equal(delivered.length, 3);
  assert.deepEqual(
    delivered.map((item) => item.provider).sort(),
    ['MAX', 'TELEGRAM', 'VK_ID'],
  );
  assert.equal(delivered[0]?.title, 'Оценка выставлена');
  const rows = await prisma().channelDelivery.findMany({ where: { title: 'Оценка выставлена' } });
  assert.ok(rows.every((row) => row.status === 'SENT' && row.sentAt !== null));
});

test('outbox: доставщик получает получателя — аккаунт канала из OAuthAccount', async () => {
  await enqueueChannelDeliveries(myUserId, { title: 'Код на экзамен', body: 'Допуск выдан.' });

  const recipients: Array<{ provider: string; channelUserId: string; userId: string }> = [];
  const result = await dispatchPendingDeliveries(async (provider, _title, _body, recipient) => {
    assert.ok(recipient !== null, 'получатель известен: запись создана по привязке канала');
    recipients.push({
      provider,
      channelUserId: recipient?.channelUserId ?? '',
      userId: recipient?.userId ?? '',
    });
  });

  assert.equal(result.sent, 3);
  assert.deepEqual(
    recipients.map((item) => item.channelUserId).sort(),
    ['max-outbox', 'tg-outbox', 'vk-outbox'],
  );
  // Получатель — владелец записи: адаптер канала пишет именно ему.
  assert.ok(recipients.every((item) => item.userId === myUserId));
});

test('outbox: отвязанный канал → получатель null, доставщик решает сам', async () => {
  await enqueueChannelDeliveries(myUserId, { title: 'Канал отвязан', body: 'Проверка получателя.' });
  // Привязка исчезает между постановкой в очередь и доставкой (студент
  // отвязал канал): запись остаётся в PENDING, а получателя уже нет —
  // адаптер не должен писать в неизвестный чат.
  await prisma().oAuthAccount.deleteMany({ where: { userId: myUserId, provider: 'TELEGRAM' } });

  const seen: Array<string | null> = [];
  const result = await dispatchPendingDeliveries(async (provider, _title, _body, recipient) => {
    seen.push(provider === 'TELEGRAM' ? (recipient === null ? 'нет' : 'есть') : 'есть');
  });

  assert.equal(result.sent, 3, 'очередь разобрана: что делать с отвязанным каналом, решает доставщик');
  assert.equal(seen.filter((item) => item === 'нет').length, 1, 'отвязанный канал без получателя');

  // Возвращаем привязку: фикстура outbox-тестов общая, следующие тесты
  // считают три канала пользователя (tg-outbox / vk-outbox / max-outbox).
  await prisma().oAuthAccount.create({
    data: { userId: myUserId, provider: 'TELEGRAM', providerAccountId: 'tg-outbox' },
  });
});

test('outbox: сбой доставки → FAILED с текстом ошибки, очередь продолжается', async () => {
  await enqueueChannelDeliveries(myUserId, { title: 'Сбой канала', body: 'Проверка ошибки.' });

  const result = await dispatchPendingDeliveries(async () => {
    throw new Error('канал недоступен');
  });

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 3);
  const row = await prisma().channelDelivery.findFirstOrThrow({ where: { title: 'Сбой канала' } });
  assert.equal(row.status, 'FAILED');
  assert.equal(row.error, 'канал недоступен');
  assert.equal(row.sentAt, null);
});

test('outbox: кабинет показывает только свои доставки', async () => {
  await enqueueChannelDeliveries(otherUserId, { title: 'Чужое сообщение', body: 'Не моё' });

  const inbox = await listChannelInbox(mySession);
  assert.ok(inbox.length > 0);
  assert.ok(inbox.every((item) => item.title !== 'Чужое сообщение'));
  assert.ok(inbox.some((item) => item.channel === 'telegram'));

  // У соседнего студента в inbox только его собственная доставка
  // (у него привязаны telegram и vk — по записи на канал).
  const otherInbox = await listChannelInbox(otherSession);
  assert.ok(otherInbox.length >= 1);
  assert.ok(otherInbox.every((item) => item.title === 'Чужое сообщение'));
});

test('маппинг канал → провайдер OAuth совпадает с моделью идентичности', () => {
  assert.equal(botChannelProvider('telegram'), 'TELEGRAM');
  assert.equal(botChannelProvider('vk'), 'VK_ID');
  assert.equal(botChannelProvider('max'), 'MAX');
});
