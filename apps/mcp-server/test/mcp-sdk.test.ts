/**
 * Тесты MCP-сервера деканата на официальном SDK (in-memory транспорт).
 *
 * InMemoryTransport — linked-пара клиента и сервера в одном процессе:
 * тест идёт по настоящему протоколу MCP (initialize → tools/list →
 * tools/call) без моков обработчиков, но без лишнего процесса. Живые
 * транспорты (дочерний процесс stdio, HTTP) проверяют отдельные файлы:
 * stdio.test.ts и http.test.ts.
 *
 * Проверяемые инварианты (спека PO, BRIEF v2 §7, ARCHITECTURE §4):
 *   - tools/list: 11 инструментов с именами по спеке, у каждого схема;
 *   - сессия staff1 → реальные данные кабинета (очередь заявок,
 *     расписание, болезни, преподаватели, успеваемость);
 *   - без токена → isError с текстом про токен;
 *   - токен студента → isError STAFF_ONLY на КАЖДОМ инструменте;
 *   - токен преподавателя → isError;
 *   - get_grades: свой институт → оценки, чужой → единый отказ
 *     «не найден» (анти-перебор);
 *   - move_lesson и publish_announcement создают РЕАЛЬНЫЕ изменения
 *     (проверяем в БД: статус MOVED + уведомление; объявление +
 *     уведомления), чужой факультет → отказ;
 *   - внутренние поля (storagePath, пути к файлам) наружу не отдаются.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDeaneryServer } from '../src/server.js';
import {
  closeTestDb,
  createFixtures,
  prisma,
  FACULTY,
  OTHER_FACULTY,
  OTHER_STUDENT_LOGIN,
  STUDENT_LOGIN,
  type McpFixtures,
} from './fixtures.js';

/** Имена инструментов по спеке PO (ровно этот набор, не больше и не меньше). */
const TOOL_NAMES = [
  'get_schedule',
  'get_grades',
  'list_requests',
  'publish_announcement',
  'move_lesson',
  'sick_statuses',
  'decide_request',
  'list_announcements',
  'cancel_lesson',
  'list_teachers',
  'get_teacher_card',
] as const;

/** Минимальные валидные аргументы каждого инструмента (для проверки прав). */
const MINIMAL_ARGS: Record<string, Record<string, unknown>> = {
  list_requests: {},
  decide_request: { requestId: '00000000-0000-0000-0000-000000000000', status: 'IN_PROGRESS' },
  list_announcements: {},
  publish_announcement: { title: 'Заголовок', body: 'Текст' },
  sick_statuses: {},
  get_schedule: {},
  move_lesson: { lessonId: '00000000-0000-0000-0000-000000000000', date: '2026-12-01' },
  cancel_lesson: { lessonId: '00000000-0000-0000-0000-000000000000', reason: 'причина' },
  list_teachers: {},
  get_teacher_card: { teacherId: '00000000-0000-0000-0000-000000000000' },
  get_grades: { login: STUDENT_LOGIN },
};

let fixtures: McpFixtures;

interface Connection {
  readonly client: Client;
  close(): Promise<void>;
}

/** Поднимает сервер с заданным токеном и подключает SDK-клиента. */
async function connect(token: string | null): Promise<Connection> {
  const server = createDeaneryServer({ resolveToken: () => token });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'udgu-mcp-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function call(connection: Connection, name: string, args: Record<string, unknown> = {}) {
  return connection.client.callTool({ name, arguments: args });
}

/** Результат tools/call глазами SDK-клиента (см. Client.callTool). */
type ToolCallOutcome = Awaited<ReturnType<typeof call>>;

/** Дата из ответа: в памяти SDK-транспорт не сериализует JSON, поэтому Date. */
function isoOf(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Текст результата (первый content-блок). */
function textOf(result: ToolCallOutcome): string {
  const content: unknown = result.content;
  assert.ok(Array.isArray(content) && content.length > 0, 'в результате есть content');
  const first = content[0] as { type?: string; text?: string };
  assert.equal(first.type, 'text', 'content-блок — текст');
  return first.text ?? '';
}

/** structuredContent успешного вызова (тест падает, если вызов — отказ). */
function dataOf(result: ToolCallOutcome): Record<string, unknown> {
  assert.notEqual(result.isError, true, `ожидался результат, получен отказ: ${textOf(result)}`);
  const structured: unknown = result.structuredContent;
  assert.ok(
    typeof structured === 'object' && structured !== null && !Array.isArray(structured),
    'structuredContent — объект (требование спецификации MCP)',
  );
  return structured as Record<string, unknown>;
}

/** Текст отказа (тест падает, если вызов успешный). */
function errorTextOf(result: ToolCallOutcome): string {
  assert.equal(result.isError, true, `ожидался отказ, получен результат: ${textOf(result)}`);
  return textOf(result);
}

test.before(async () => {
  fixtures = await createFixtures();
});

test.after(async () => {
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Рукопожатие и набор инструментов
// ---------------------------------------------------------------------------

test('initialize + tools/list: протокол SDK, 11 инструментов по спеке, схемены', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const tools = await connection.client.listTools();
    assert.deepEqual(
      tools.tools.map((item) => item.name).sort(),
      [...TOOL_NAMES].sort(),
      'полный набор инструментов кабинета сотрудника',
    );
    for (const tool of tools.tools) {
      assert.ok((tool.description ?? '').length > 20, `${tool.name}: описание для агента`);
      assert.ok((tool.title ?? '').length > 0, `${tool.name}: человекочитаемое название`);
      const schema = tool.inputSchema as { type?: string };
      assert.equal(schema.type, 'object', `${tool.name}: схема аргументов — объект`);
    }

    // Инструкция сервера честно помечает данные синтетическими.
    const instructions = await connection.client.getInstructions();
    assert.match(instructions ?? '', /синтетические/, 'инструкция агента помечает прототип');
  } finally {
    await connection.close();
  }
});

// ---------------------------------------------------------------------------
// Права
// ---------------------------------------------------------------------------

test('без токена: любой инструмент → isError с текстом про токен', async () => {
  const connection = await connect(null);
  try {
    const requests = errorTextOf(await call(connection, 'list_requests'));
    assert.match(requests, /токен/i, 'текст для человека про токен');

    const grades = errorTextOf(await call(connection, 'get_grades', { login: STUDENT_LOGIN }));
    assert.match(grades, /токен/i);
  } finally {
    await connection.close();
  }
});

test('мёртвый токен: инструмент → isError про недействительную сессию', async () => {
  const connection = await connect('несуществующий-токен-сессии');
  try {
    const text = errorTextOf(await call(connection, 'list_requests'));
    assert.match(text, /сессия/i, 'человеческий текст про мёртвую сессию');
  } finally {
    await connection.close();
  }
});

test('токен студента: КАЖДЫЙ инструмент → isError STAFF_ONLY', async () => {
  const connection = await connect(fixtures.studentToken);
  try {
    for (const name of TOOL_NAMES) {
      const result = await call(connection, name, MINIMAL_ARGS[name] ?? {});
      assert.equal(result.isError, true, `${name}: отказ`);
      assert.match(errorTextOf(result), /сотрудникам деканата/i, `${name}: текст ядра про права`);
    }
  } finally {
    await connection.close();
  }
});

test('токен преподавателя: КАЖДЫЙ инструмент → isError (в кабинет деканата не пускаем)', async () => {
  const connection = await connect(fixtures.teacherToken);
  try {
    for (const name of TOOL_NAMES) {
      const result = await call(connection, name, MINIMAL_ARGS[name] ?? {});
      assert.equal(result.isError, true, `${name}: отказ`);
      assert.match(errorTextOf(result), /сотрудникам деканата/i, `${name}: fail-closed для преподавателя`);
    }
  } finally {
    await connection.close();
  }
});

// ---------------------------------------------------------------------------
// Чтение: реальные данные кабинета сотрудника
// ---------------------------------------------------------------------------

test('чтение: очередь заявок, расписание, болезни, преподаватели — данные своего института', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const queue = dataOf(await call(connection, 'list_requests')).items as {
      id: string;
      student: { fullName: string; groupName: string; faculty: string };
    }[];
    assert.equal(queue.length, 1, 'в очереди только заявка своего института');
    assert.equal(queue[0]?.id, fixtures.ownRequestId);
    assert.equal(queue[0]?.student.groupName, 'МСР-31-1');
    assert.equal(queue[0]?.student.faculty, FACULTY);
    assert.ok(!JSON.stringify(queue).includes('МСР-ЯЗ'), 'заявка чужого института не отдана');

    const lessons = dataOf(await call(connection, 'get_schedule')).items as {
      groupName: string;
      status: string;
      room: string;
    }[];
    assert.equal(lessons.length, 1, 'пара своей группы в горизонте двух недель');
    assert.equal(lessons[0]?.groupName, 'МСР-31-1');
    assert.equal(lessons[0]?.room, 'У-101');

    // Фильтр по группе: своя группа — пары, чужой институт — отказ.
    const filtered = dataOf(await call(connection, 'get_schedule', { groupName: 'мср-31-1' })).items as unknown[];
    assert.equal(filtered.length, 1, 'фильтр по имени группы не зависит от регистра');
    const missing = errorTextOf(await call(connection, 'get_schedule', { groupName: 'МСР-ЯЗ-21-1' }));
    assert.match(missing, /не найдена в вашем институте/i, 'группа чужого института → NOT_FOUND');

    const sick = dataOf(await call(connection, 'sick_statuses', { activeOnly: true })).items as {
      fullName: string;
      hasAttachment: boolean;
    }[];
    assert.equal(sick.length, 1, 'свой студент болеет сегодня');
    assert.equal(sick[0]?.fullName, 'Иванов Александр Дмитриевич');
    assert.equal(sick[0]?.hasAttachment, false, 'факт наличия справки, без файлов');

    const teachers = dataOf(await call(connection, 'list_teachers')).items as { fullName: string }[];
    assert.ok(teachers.length >= 1, 'справочник преподавателей');
    assert.match(teachers[0]?.fullName ?? '', /Преподавательская/);

    const card = dataOf(await call(connection, 'get_teacher_card', { teacherId: fixtures.teacherId })) as {
      fullName: string;
      lessons: unknown[];
      officeHours: unknown[];
    };
    assert.match(card.fullName, /Преподавательская/);
    assert.ok(card.lessons.length >= 1, 'расписание преподавателя');

    const missingTeacher = errorTextOf(
      await call(connection, 'get_teacher_card', { teacherId: '00000000-0000-0000-0000-000000000000' }),
    );
    assert.match(missingTeacher, /не найден/i, 'неизвестный преподаватель → NOT_FOUND');
  } finally {
    await connection.close();
  }
});

test('успеваемость: свой институт → оценки, чужой и неизвестный → единый отказ, ADMIN видит все', async () => {
  const staff = await connect(fixtures.staffToken);
  try {
    const own = dataOf(await call(staff, 'get_grades', { login: STUDENT_LOGIN })) as {
      student: { fullName: string; groupName: string };
      semesters: unknown[];
      summary: { averageScore: number | null; debts: unknown[] };
    };
    assert.equal(own.student.fullName, 'Иванов Александр Дмитриевич');
    assert.equal(own.student.groupName, 'МСР-31-1');
    assert.equal(own.semesters.length, 2, 'два семестра');
    assert.equal(own.summary.averageScore, 4.5, 'средний балл по экзаменам');
    assert.equal(own.summary.debts.length, 1, 'незачёт — долг');

    // Чужой институт и неизвестный логин — ОДИН и тот же обобщённый отказ.
    const foreign = errorTextOf(await call(staff, 'get_grades', { login: OTHER_STUDENT_LOGIN }));
    assert.match(foreign, /не найден или недоступен/i, 'единый ответ для чужого института');
    const unknown = errorTextOf(await call(staff, 'get_grades', { login: 'нет-такого-логина' }));
    assert.equal(unknown, foreign, 'неизвестный логин — тот же ответ (анти-перебор)');
  } finally {
    await staff.close();
  }

  const admin = await connect(fixtures.adminToken);
  try {
    const foreign = dataOf(await call(admin, 'get_grades', { login: OTHER_STUDENT_LOGIN })) as {
      student: { faculty: string };
      summary: { averageScore: number | null };
    };
    assert.equal(foreign.student.faculty, OTHER_FACULTY, 'администратор видит все институты');
    assert.equal(foreign.summary.averageScore, 3);
  } finally {
    await admin.close();
  }
});

// ---------------------------------------------------------------------------
// Мутации: реальные изменения в БД
// ---------------------------------------------------------------------------

test('move_lesson: статус MOVED + уведомление студенту, чужая пара → отказ', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const moved = dataOf(
      await call(connection, 'move_lesson', {
        lessonId: fixtures.ownLessonId,
        date: '2026-12-01',
        room: 'У-205',
        note: 'перенос по заявке деканата',
      }),
    ) as { status: string; movedToRoom: string | null; movedToDate: string };
    assert.equal(moved.status, 'MOVED');
    assert.equal(moved.movedToRoom, 'У-205');
    assert.match(isoOf(moved.movedToDate), /2026-12-01/, 'дата переноса в ответе');

    // Изменение реальное: проверяем в БД (сервис ядра, а не MCP).
    const lesson = await prisma().scheduleEntry.findUniqueOrThrow({
      where: { id: fixtures.ownLessonId },
      select: { status: true, movedToRoom: true, movedToDate: true },
    });
    assert.equal(lesson.status, 'MOVED');
    assert.equal(lesson.movedToRoom, 'У-205');
    assert.ok(lesson.movedToDate !== null, 'дата переноса записана');

    const notification = await prisma().notification.findFirst({
      where: { userId: fixtures.ownStudentUserId, type: 'SCHEDULE_CHANGE' },
      select: { title: true, body: true },
    });
    assert.match(notification?.title ?? '', /перенесена/i, 'студент уведомлён о переносе');
    assert.match(notification?.body ?? '', /У-205/, 'в уведомлении новая аудитория');

    // Пара чужого института → отказ по правам (единый ответ с «не найдена»).
    const foreign = errorTextOf(
      await call(connection, 'move_lesson', { lessonId: fixtures.otherLessonId, date: '2026-12-05' }),
    );
    assert.match(foreign, /не найдено или недоступно/i, 'чужой факультет → NOT_OWNER');

    const foreignInDb = await prisma().scheduleEntry.findUniqueOrThrow({
      where: { id: fixtures.otherLessonId },
      select: { status: true },
    });
    assert.equal(foreignInDb.status, 'SCHEDULED', 'чужая пара не изменилась');
  } finally {
    await connection.close();
  }
});

test('publish_announcement: объявление + уведомления студентам, ALL только для админа', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const before = dataOf(await call(connection, 'list_announcements')).items as unknown[];
    assert.equal(before.length, 0, 'до публикации объявлений нет');

    const created = dataOf(
      await call(connection, 'publish_announcement', {
        title: 'Сдача сессии',
        body: 'Расписание сессии опубликовано.',
      }),
    ) as { id: string; title: string; audience: string; faculty: string | null };
    assert.equal(created.title, 'Сдача сессии');
    assert.equal(created.audience, 'FACULTY', 'аудитория по умолчанию — институт сотрудника');
    assert.equal(created.faculty, FACULTY);

    const after = dataOf(await call(connection, 'list_announcements')).items as { id: string; title: string }[];
    assert.equal(after.length, 1, 'объявление видно в списке');
    assert.equal(after[0]?.id, created.id);

    // Объявление реально в БД + уведомления студентам аудитории.
    const announcement = await prisma().announcement.findUniqueOrThrow({
      where: { id: created.id },
      select: { faculty: true, authorId: true },
    });
    assert.equal(announcement.faculty, FACULTY);
    const notifications = await prisma().notification.findMany({
      where: { type: 'ANNOUNCEMENT' },
      select: { title: true },
    });
    assert.equal(notifications.length, 1, 'уведомление студенту института');
    assert.match(notifications[0]?.title ?? '', /Сдача сессии/);

    // ALL публикует только администратор: сотрудник получает понятный отказ.
    const forbidden = errorTextOf(
      await call(connection, 'publish_announcement', { title: 'Всем', body: 'Текст', audience: 'ALL' }),
    );
    assert.match(forbidden, /администратор/i, 'отказ ядра с человеческим текстом');
  } finally {
    await connection.close();
  }
});

test('decide_request: решение проходит, повторный переход — конфликт, чужая заявка — отказ', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const decided = dataOf(
      await call(connection, 'decide_request', {
        requestId: fixtures.ownRequestId,
        status: 'IN_PROGRESS',
        staffComment: 'принято в работу',
      }),
    ) as { status: string; statusLabel: string };
    assert.equal(decided.status, 'IN_PROGRESS');
    assert.equal(decided.statusLabel, 'В работе');

    const request = await prisma().request.findUniqueOrThrow({
      where: { id: fixtures.ownRequestId },
      select: { status: true },
    });
    assert.equal(request.status, 'IN_PROGRESS', 'решение записано в БД');

    // Повторный переход в тот же статус — конфликт бизнес-правила.
    const conflict = errorTextOf(
      await call(connection, 'decide_request', { requestId: fixtures.ownRequestId, status: 'IN_PROGRESS' }),
    );
    assert.match(conflict, /уже (в статусе|закрыта)/i, 'конфликт бизнес-правила');

    // Отказ без комментария — отказ по аргументам (правило ядра).
    const noComment = errorTextOf(
      await call(connection, 'decide_request', { requestId: fixtures.ownRequestId, status: 'REJECTED' }),
    );
    assert.match(noComment, /комментарий/i, 'для отказа нужна причина');

    // Заявка чужого института → отказ по правам (единый ответ с «не найдена»).
    const foreign = errorTextOf(
      await call(connection, 'decide_request', { requestId: fixtures.otherRequestId, status: 'READY' }),
    );
    assert.match(foreign, /не найдена или недоступна/i, 'чужой факультет → NOT_OWNER');

    const foreignInDb = await prisma().request.findUniqueOrThrow({
      where: { id: fixtures.otherRequestId },
      select: { status: true },
    });
    assert.equal(foreignInDb.status, 'NEW', 'чужая заявка не изменилась');
  } finally {
    await connection.close();
  }
});

test('cancel_lesson: отмена с причиной, повторная отмена — конфликт', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const cancelled = dataOf(
      await call(connection, 'cancel_lesson', {
        lessonId: fixtures.ownLessonId,
        reason: 'отмена по болезни преподавателя',
      }),
    ) as { status: string; note: string | null };
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.note, 'отмена по болезни преподавателя');

    // CANCELLED — терминальный статус: ни перенести, ни отменить снова.
    const moveAgain = errorTextOf(
      await call(connection, 'move_lesson', { lessonId: fixtures.ownLessonId, date: '2026-12-02' }),
    );
    assert.match(moveAgain, /отменена|изменение невозможно/i, 'перенести отменённую пару нельзя');
    const cancelAgain = errorTextOf(
      await call(connection, 'cancel_lesson', { lessonId: fixtures.ownLessonId, reason: 'ещё раз' }),
    );
    assert.match(cancelAgain, /отменена|изменение невозможно/i, 'отменить отменённую пару нельзя');
  } finally {
    await connection.close();
  }
});

// ---------------------------------------------------------------------------
// Гигиена данных
// ---------------------------------------------------------------------------

test('внутренние поля наружу не отдаются (storagePath, пути к файлам, хеши)', async () => {
  const connection = await connect(fixtures.staffToken);
  try {
    const responses = await Promise.all([
      call(connection, 'list_requests'),
      call(connection, 'get_schedule'),
      call(connection, 'get_grades', { login: STUDENT_LOGIN }),
      call(connection, 'list_teachers'),
      call(connection, 'sick_statuses'),
      call(connection, 'list_announcements'),
    ]);

    for (const response of responses) {
      const text = JSON.stringify(response);
      assert.ok(!text.includes('storagePath'), 'путь из хранилища не отдан');
      assert.ok(!text.includes('attachmentPath'), 'путь к справке не отдан');
      assert.ok(!text.includes('passwordHash'), 'хеш пароля не отдан');
      assert.ok(!text.includes('tokenHash'), 'хеш токена не отдан');
    }
  } finally {
    await connection.close();
  }
});
