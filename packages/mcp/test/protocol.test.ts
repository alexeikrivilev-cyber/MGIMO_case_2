/**
 * Тесты MCP-сервера деканата: протокол, авторизация, права и данные.
 *
 * Сервер поднимается РЕАЛЬНЫМ дочерним процессом (stdio), поэтому тест
 * проверяет и транспорт, и поведение целиком: initialize → tools/list →
 * tools/call.
 *
 * Проверяемые инварианты (BRIEF v2 §7, ARCHITECTURE §4):
 *   - без токена → отказ авторизации на initialize;
 *   - мёртвый токен → отказ авторизации (сессия невалидна);
 *   - токен студента → initialize проходит, но любой deanery_* вызов
 *     заканчивается отказом по правам (FORBIDDEN);
 *   - токен сотрудника → очередь заявок ТОЛЬКО его института;
 *   - deanery_student_grades: свой институт → оценки, чужой → отказ;
 *     администратор видит все институты;
 *   - deanery_announcement_publish создаёт объявление, видимое в списке;
 *   - неизвестный инструмент и некорректные аргументы → понятный отказ;
 *   - токен сессии не утекает ни в stdout, ни в stderr;
 *   - внутренние поля (storagePath, путь к фото справки) не отдаются.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient, type McpResponse } from './mcp-client.js';
import {
  closeTestDb,
  createFixtures,
  prisma,
  OTHER_STUDENT_LOGIN,
  STAFF_LOGIN,
  STUDENT_LOGIN,
  type McpFixtures,
} from './fixtures.js';

let fixtures: McpFixtures;

/** Ошибка JSON-RPC из ответа (тест падает, если ответ успешный). */
function errorOf(response: McpResponse): { code: number; message: string; data?: unknown } {
  assert.ok(response.error !== undefined, `ожидалась ошибка, получен result: ${JSON.stringify(response.result)}`);
  return response.error;
}

/** Успешный result инструмента (тест падает, если ответ — ошибка). */
function resultOf(response: McpResponse): Record<string, unknown> {
  assert.ok(response.error === undefined, `ожидался результат, получена ошибка: ${JSON.stringify(response.error)}`);
  return response.result as Record<string, unknown>;
}

/** structuredContent вызова инструмента. */
function dataOf(response: McpResponse): unknown {
  const result = resultOf(response);
  return result.structuredContent;
}

test.before(async () => {
  fixtures = await createFixtures();
});


test.after(async () => {
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// Авторизация
// ---------------------------------------------------------------------------

test('без токена: initialize → отказ авторизации (SESSION_REQUIRED)', async () => {
  const client = await McpClient.start();
  try {
    const response = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    const error = errorOf(response);
    assert.equal(error.code, -32001, 'код SESSION_REQUIRED');
    assert.match(error.message, /токен/i, 'текст для человека про токен');
  } finally {
    await client.close();
  }
});

test('мёртвый токен: initialize → отказ авторизации (SESSION_INVALID)', async () => {
  const client = await McpClient.start({ token: 'несуществующий-токен-сессии' });
  try {
    const response = await client.request('initialize', {});
    const error = errorOf(response);
    assert.equal(error.code, -32002, 'код SESSION_INVALID');
    assert.match(error.message, /сессия/i);
  } finally {
    await client.close();
  }
});

// ---------------------------------------------------------------------------
// Рукопожатие и набор инструментов
// ---------------------------------------------------------------------------

test('initialize + ping + tools/list: протокол, 11 инструментов deanery_*, токен не утекает', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    const init = resultOf(
      await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
        sessionToken: fixtures.staffToken,
      }),
    );
    assert.equal(init.protocolVersion, '2024-11-05');
    assert.equal((init.serverInfo as { name: string }).name, 'udgu-deanery-mcp');
    assert.ok(
      typeof init.instructions === 'string' && (init.instructions as string).includes('синтетические'),
      'инструкция честно помечает данные синтетическими',
    );

    // Уведомление без id (notifications/initialized) — ответа не требует:
    // иначе клиент завис бы на несуществующем id. Проверяем по числу
    // строк в канале протокола: после ping их ровно +1.
    const linesBefore = client.stdoutLineCount;
    client.notify('notifications/initialized');
    const ping = resultOf(await client.request('ping'));
    assert.deepEqual(ping, {});
    assert.equal(client.stdoutLineCount, linesBefore + 1, 'на уведомление ответ не отсылается');

    const tools = resultOf(await client.request('tools/list')).tools as {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];
    assert.deepEqual(
      tools.map((item) => item.name).sort(),
      [
        'deanery_announcement_publish',
        'deanery_announcements_list',
        'deanery_lesson_cancel',
        'deanery_lesson_move',
        'deanery_request_decide',
        'deanery_requests_list',
        'deanery_schedule',
        'deanery_sick_leaves',
        'deanery_student_grades',
        'deanery_teacher_card',
        'deanery_teachers_list',
      ],
      'полный набор инструментов кабинета сотрудника',
    );
    for (const item of tools) {
      assert.ok(item.description.length > 20, `${item.name}: описание для агента`);
      assert.equal(item.inputSchema.type, 'object', `${item.name}: схема аргументов — объект`);
    }

    // Токен сессии равносилен паролю: он не должен попасть ни в канал
    // протокола, ни в логи.
    assert.ok(!client.stdoutText.includes(fixtures.staffToken), 'токена нет в stdout');
    assert.ok(!client.stderrText.includes(fixtures.staffToken), 'токена нет в stderr');
  } finally {
    await client.close();
  }
});

// ---------------------------------------------------------------------------
// Права
// ---------------------------------------------------------------------------

test('токен студента: initialize проходит, deanery_* → отказ по правам', async () => {
  const client = await McpClient.start({ token: fixtures.studentToken });
  try {
    const init = resultOf(await client.request('initialize', { sessionToken: fixtures.studentToken }));
    assert.equal(init.protocolVersion, '2024-11-05', 'студент проходит рукопожатие');

    const tools = resultOf(await client.request('tools/list')).tools as unknown[];
    assert.equal(tools.length, 11, 'набор инструментов виден и студенту');

    for (const name of ['deanery_requests_list', 'deanery_student_grades', 'deanery_announcements_list']) {
      const response =
        name === 'deanery_student_grades'
          ? await client.callTool(name, { login: STUDENT_LOGIN })
          : await client.callTool(name);
      const error = errorOf(response);
      assert.equal(error.code, -32003, `${name}: код FORBIDDEN`);
      assert.equal((error.data as { code?: string } | undefined)?.code, 'STAFF_ONLY', `${name}: код ядра`);
      assert.match(error.message, /сотрудникам деканата/i, `${name}: человеческий текст`);
    }
  } finally {
    await client.close();
  }
});

test('очередь заявок: сотрудник видит только свой институт', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });
    const queue = dataOf(await client.callTool('deanery_requests_list')) as {
      id: string;
      student: { fullName: string; groupName: string; faculty: string };
    }[];

    assert.equal(queue.length, 1, 'в очереди только заявка своего института');
    assert.equal(queue[0]?.id, fixtures.ownRequestId);
    assert.equal(queue[0]?.student.groupName, 'МСР-31-1');
    assert.equal(queue[0]?.student.faculty, 'Институт математики, информационных технологий и физики');
    assert.ok(!JSON.stringify(queue).includes('МСР-ЯЗ'), 'заявка чужого института не отдана');

    // Фильтр по статусу работает тем же сервисом кабинета.
    const ready = dataOf(await client.callTool('deanery_requests_list', { status: 'READY' })) as unknown[];
    assert.equal(ready.length, 0);
  } finally {
    await client.close();
  }
});

test('успеваемость студента: свой институт → оценки, чужой → отказ, ADMIN видит все', async () => {
  const staffClient = await McpClient.start({ token: fixtures.staffToken });
  try {
    await staffClient.request('initialize', { sessionToken: fixtures.staffToken });

    const own = dataOf(await staffClient.callTool('deanery_student_grades', { login: STUDENT_LOGIN })) as {
      student: { fullName: string; groupName: string };
      semesters: { semester: number; entries: { subjectName: string; value: number | null }[] }[];
      summary: { averageScore: number | null; debts: unknown[] };
    };
    assert.equal(own.student.fullName, 'Иванов Александр Дмитриевич');
    assert.equal(own.student.groupName, 'МСР-31-1');
    assert.equal(own.semesters.length, 2, 'два семестра');
    assert.equal(own.summary.averageScore, 4.5, 'средний балл по экзаменам');
    assert.equal(own.summary.debts.length, 1, 'незачёт — долг');

    // Студент чужого института: тот же обобщённый отказ, что и «не найден».
    const foreign = errorOf(
      await staffClient.callTool('deanery_student_grades', { login: OTHER_STUDENT_LOGIN }),
    );
    assert.equal(foreign.code, -32003, 'код FORBIDDEN');
    assert.equal((foreign.data as { code?: string }).code, 'NOT_OWNER', 'код ядра NOT_OWNER');
    const unknown = errorOf(await staffClient.callTool('deanery_student_grades', { login: 'нет-такого' }));
    assert.equal((unknown.data as { code?: string }).code, 'NOT_OWNER', 'неизвестный логин — тот же ответ');

    // Пустой логин → отказ по аргументам (INVALID_PARAMS).
    const empty = errorOf(await staffClient.callTool('deanery_student_grades', { login: '' }));
    assert.equal(empty.code, -32602);
  } finally {
    await staffClient.close();
  }

  // Администратор видит все институты.
  const adminClient = await McpClient.start({ token: fixtures.adminToken });
  try {
    await adminClient.request('initialize', { sessionToken: fixtures.adminToken });
    const foreign = dataOf(
      await adminClient.callTool('deanery_student_grades', { login: OTHER_STUDENT_LOGIN }),
    ) as { student: { faculty: string }; summary: { averageScore: number | null } };
    assert.equal(foreign.student.faculty, 'Институт языка и литературы');
    assert.equal(foreign.summary.averageScore, 3);
  } finally {
    await adminClient.close();
  }
});

// ---------------------------------------------------------------------------
// Инструменты чтения
// ---------------------------------------------------------------------------

test('расписание, болезни, преподаватели: данные института сотрудника', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });

    const lessons = dataOf(await client.callTool('deanery_schedule')) as { groupName: string; status: string }[];
    assert.equal(lessons.length, 1, 'пара своей группы в горизонте двух недель');
    assert.equal(lessons[0]?.groupName, 'МСР-31-1');

    // Фильтр по группе: своя группа — пары, несуществующая — отказ.
    const filtered = dataOf(
      await client.callTool('deanery_schedule', { groupName: 'мср-31-1' }),
    ) as unknown[];
    assert.equal(filtered.length, 1, 'фильтр по имени группы не зависит от регистра');
    const missing = errorOf(await client.callTool('deanery_schedule', { groupName: 'МСР-ЯЗ-21-1' }));
    assert.equal(missing.code, -32005, 'группа чужого института → NOT_FOUND');

    const sick = dataOf(await client.callTool('deanery_sick_leaves', { activeOnly: true })) as unknown[];
    assert.equal(sick.length, 0, 'в фикстурах никто не болеет');

    const teachers = dataOf(await client.callTool('deanery_teachers_list')) as { fullName: string }[];
    assert.ok(teachers.length >= 1, 'справочник преподавателей');
    assert.match(teachers[0]?.fullName ?? '', /Преподавательская/);

    const card = dataOf(await client.callTool('deanery_teacher_card', { teacherId: fixtures.teacherId })) as {
      fullName: string;
      lessons: unknown[];
      officeHours: unknown[];
    };
    assert.match(card.fullName, /Преподавательская/);
    assert.ok(card.lessons.length >= 1, 'расписание преподавателя');

    const missingTeacher = errorOf(
      await client.callTool('deanery_teacher_card', { teacherId: '00000000-0000-0000-0000-000000000000' }),
    );
    assert.equal(missingTeacher.code, -32005, 'неизвестный преподаватель → NOT_FOUND');
  } finally {
    await client.close();
  }
});

// ---------------------------------------------------------------------------
// Мутации
// ---------------------------------------------------------------------------

test('объявление: публикация видна в списке сотрудника', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });

    const before = dataOf(await client.callTool('deanery_announcements_list')) as unknown[];
    assert.equal(before.length, 0, 'до публикации объявлений нет');

    const created = dataOf(
      await client.callTool('deanery_announcement_publish', {
        title: 'Сдача сессии',
        body: 'Расписание сессии опубликовано.',
      }),
    ) as { id: string; title: string; audience: string; faculty: string };
    assert.equal(created.title, 'Сдача сессии');
    assert.equal(created.audience, 'FACULTY', 'аудитория по умолчанию — институт сотрудника');
    assert.equal(created.faculty, 'Институт математики, информационных технологий и физики');

    const after = dataOf(await client.callTool('deanery_announcements_list')) as { id: string; title: string }[];
    assert.equal(after.length, 1, 'объявление видно в списке');
    assert.equal(after[0]?.id, created.id);

    // ALL публикует только администратор: сотрудник получает понятный отказ.
    const forbidden = errorOf(
      await client.callTool('deanery_announcement_publish', { title: 'Всем', body: 'Текст', audience: 'ALL' }),
    );
    assert.equal(forbidden.code, -32602, 'код INVALID_PARAMS');
    assert.match(forbidden.message, /администратор/i);
  } finally {
    await client.close();
  }
});

test('решение по заявке и перенос пары: мутации проходят, аудит и уведомление есть', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });

    const decided = dataOf(
      await client.callTool('deanery_request_decide', {
        requestId: fixtures.ownRequestId,
        status: 'IN_PROGRESS',
        staffComment: 'принято в работу',
      }),
    ) as { status: string; statusLabel: string };
    assert.equal(decided.status, 'IN_PROGRESS');
    assert.equal(decided.statusLabel, 'В работе');

    // Повторный переход в тот же статус — конфликт бизнес-правила.
    const conflict = errorOf(
      await client.callTool('deanery_request_decide', {
        requestId: fixtures.ownRequestId,
        status: 'IN_PROGRESS',
      }),
    );
    assert.equal(conflict.code, -32004, 'код CONFLICT');

    // Отказ без комментария — отказ по аргументам (правило ядра).
    const noComment = errorOf(
      await client.callTool('deanery_request_decide', {
        requestId: fixtures.ownRequestId,
        status: 'REJECTED',
      }),
    );
    assert.equal(noComment.code, -32602);

    // Заявка чужого института → отказ по правам (единый ответ с «не найдена»).
    const foreign = errorOf(
      await client.callTool('deanery_request_decide', {
        requestId: fixtures.otherRequestId,
        status: 'READY',
      }),
    );
    assert.equal((foreign.data as { code?: string }).code, 'NOT_OWNER');

    const moved = dataOf(
      await client.callTool('deanery_lesson_move', {
        lessonId: fixtures.ownLessonId,
        date: '2026-12-01',
        room: 'У-205',
        note: 'перенос по заявке деканата',
      }),
    ) as { status: string; movedToRoom: string | null };
    assert.equal(moved.status, 'MOVED');
    assert.equal(moved.movedToRoom, 'У-205');

    // Отмена с причиной: причина обязательна, студенты увидят её.
    const cancelled = dataOf(
      await client.callTool('deanery_lesson_cancel', {
        lessonId: fixtures.ownLessonId,
        reason: 'отмена по болезни преподавателя',
      }),
    ) as { status: string; note: string | null };
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.note, 'отмена по болезни преподавателя');

    // CANCELLED — терминальный статус: ни перенести, ни отменить снова.
    const moveAgain = errorOf(
      await client.callTool('deanery_lesson_move', { lessonId: fixtures.ownLessonId, date: '2026-12-02' }),
    );
    assert.equal(moveAgain.code, -32004, 'перенести отменённую пару нельзя');
    const cancelAgain = errorOf(
      await client.callTool('deanery_lesson_cancel', { lessonId: fixtures.ownLessonId, reason: 'ещё раз' }),
    );
    assert.equal(cancelAgain.code, -32004, 'отменить отменённую пару нельзя');

    // Отмена без причины → отказ по аргументам (правило ядра).
    const noReason = errorOf(
      await client.callTool('deanery_lesson_cancel', { lessonId: fixtures.ownLessonId, reason: '' }),
    );
    assert.equal(noReason.code, -32602);

    // Последствия мутаций: уведомление студенту и запись аудита — их
    // создают сервисы ядра, MCP только вызывает их.
    const student = await prisma().student.findFirstOrThrow({ where: { lastName: 'Иванов' }, select: { userId: true } });
    const notification = await prisma().notification.findFirst({
      where: { userId: student.userId, type: 'SCHEDULE_CHANGE' },
    });
    assert.match(notification?.title ?? '', /перенесена/i);

    const audit = await prisma().auditEvent.findFirst({
      where: { entity: 'Request', entityId: fixtures.ownRequestId, action: 'request.decide' },
    });
    assert.ok(audit !== null, 'решение по заявке записано в аудит');
    assert.equal(
      audit?.actorUserId,
      (await prisma().user.findUniqueOrThrow({ where: { login: STAFF_LOGIN }, select: { id: true } })).id,
      'actor аудита — сотрудник сессии',
    );
  } finally {
    await client.close();
  }
});

test('неизвестный метод и неизвестный инструмент → понятный отказ', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });

    const method = errorOf(await client.request('resources/list'));
    assert.equal(method.code, -32601, 'METHOD_NOT_FOUND');

    const tool = errorOf(await client.callTool('deanery_нет-такого'));
    assert.equal(tool.code, -32006, 'TOOL_UNKNOWN');
    assert.match(tool.message, /не найден/i);

    // Некорректная дата в аргументах → отказ по аргументам с уточнением.
    const badDate = errorOf(await client.callTool('deanery_schedule', { from: 'завтра' }));
    assert.equal(badDate.code, -32602, 'INVALID_PARAMS');
    assert.ok(Array.isArray((badDate.data as { details?: string[] }).details), 'уточнения по полям');
  } finally {
    await client.close();
  }
});

test('внутренние поля наружу не отдаются (storagePath, пути к файлам)', async () => {
  const client = await McpClient.start({ token: fixtures.staffToken });
  try {
    await client.request('initialize', { sessionToken: fixtures.staffToken });

    const responses = [
      await client.callTool('deanery_requests_list'),
      await client.callTool('deanery_schedule'),
      await client.callTool('deanery_student_grades', { login: STUDENT_LOGIN }),
      await client.callTool('deanery_teachers_list'),
      await client.callTool('deanery_sick_leaves'),
    ];

    for (const response of responses) {
      const text = JSON.stringify(resultOf(response));
      assert.ok(!text.includes('storagePath'), 'путь из хранилища не отдан');
      assert.ok(!text.includes('attachmentPath'), 'путь к справке не отдан');
      assert.ok(!text.includes('passwordHash'), 'хеш пароля не отдан');
      assert.ok(!text.includes('tokenHash'), 'хеш токена не отдан');
    }
  } finally {
    await client.close();
  }
});
