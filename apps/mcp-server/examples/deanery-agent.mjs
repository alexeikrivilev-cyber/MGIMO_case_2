#!/usr/bin/env node
/**
 * Пример клиента MCP-сервера деканата (BRIEF v2 §7).
 *
 * Показывает агенту путь от нуля до данных кабинета сотрудника:
 *   1. поднять сервер дочерним процессом (stdio) ИЛИ подключиться по
 *      HTTP, если задан MCP_HTTP_URL;
 *   2. initialize (рукопожатие);
 *   3. tools/list — что умеет сервер;
 *   4. tools/call: расписание группы, успеваемость студента, статусы
 *      «болею»;
 *   5. напечатать результаты и корректно закрыть сервер.
 *
 * Клиент — официальный MCP SDK (@modelcontextprotocol/sdk), те же
 * транспорты, что у Claude/Cursor: StdioClientTransport и
 * StreamableHTTPClientTransport.
 *
 * Токен сессии — из env MCP_SESSION_TOKEN (как у сервера). Токен
 * равносилен паролю: пример его НЕ хранит и НЕ печатает.
 *
 * Запуск:
 *   MCP_SESSION_TOKEN=<токен> node apps/mcp-server/examples/deanery-agent.mjs
 *   MCP_SESSION_TOKEN=<токен> MCP_HTTP_URL=http://127.0.0.1:8787/mcp \
 *     node apps/mcp-server/examples/deanery-agent.mjs
 *   STUDENT_LOGIN=student2 GROUP_NAME=ПИ-26-1 node ...  # другие данные
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpServerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const monorepoRoot = path.resolve(mcpServerDir, '../..');
const serverEntry = path.join(mcpServerDir, 'src', 'index.ts');
const tsxLoader = path.resolve(monorepoRoot, 'node_modules/tsx/dist/loader.mjs');

const TOKEN = process.env.MCP_SESSION_TOKEN ?? '';
const HTTP_URL = process.env.MCP_HTTP_URL ?? '';
const STUDENT_LOGIN = process.env.STUDENT_LOGIN ?? 'student1';
const GROUP_NAME = process.env.GROUP_NAME ?? 'ПИ-24-1';

const print = (text) => process.stdout.write(`${text}\n`);

if (TOKEN === '') {
  process.stderr.write(
    'Не задан MCP_SESSION_TOKEN. Получите токен сессии сотрудника:\n' +
      '  curl -s -X POST http://localhost:3000/api/auth/login ' +
      "-H 'content-type: application/json' -d '{\"login\":\"staff1\",\"password\":\"<пароль>\"}' -i " +
      '| grep udgu_session\n',
  );
  process.exitCode = 1;
} else {
  await runDemo(TOKEN);
}

/** Поднимает клиента (дочерний процесс или HTTP) и проходит сценарий агента. */
async function runDemo(token) {
  // StdioClientTransport сам поднимает сервер дочерним процессом и сам
  // его гасит при close(); для HTTP транспорт подключается к уже
  // запущенному серверу (npm run mcp:serve:http).
  const transport =
    HTTP_URL === ''
      ? new StdioClientTransport({
          command: process.execPath,
          args: ['--import', tsxLoader, serverEntry, '--transport', 'stdio'],
          env: { ...process.env, MCP_SESSION_TOKEN: token },
          stderr: 'inherit',
        })
      : new StreamableHTTPClientTransport(new URL(HTTP_URL), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        });

  const client = new Client({ name: 'deanery-agent-example', version: '1.0.0' });

  try {
    // 1. Рукопожатие: сервер рассказывает о себе и о данных.
    await client.connect(transport);
    print(`initialize → сервер деканата подключён (${HTTP_URL === '' ? 'stdio' : HTTP_URL})`);

    const instructions = client.getInstructions();
    if (instructions) {
      print(`инструкция сервера: ${instructions}`);
    }

    // 2. Что умеет сервер.
    const tools = await client.listTools();
    print(`\ntools/list → ${tools.tools.length} инструментов:`);
    for (const item of tools.tools) {
      print(`  - ${item.name}: ${item.title}`);
    }

    // 3. Расписание группы: если группы нет в институте сотрудника,
    //    печатаем отказ инструмента и смотрим институт целиком.
    print(`\nget_schedule(${GROUP_NAME}):`);
    await showTool(
      () => client.callTool({ name: 'get_schedule', arguments: { groupName: GROUP_NAME } }),
      (data) => {
        const lessons = data.items ?? [];
        print(`  пар в горизонте: ${lessons.length}`);
        for (const lesson of lessons.slice(0, 5)) {
          print(`  ${lesson.date.slice(0, 10)} ${lesson.startTime}–${lesson.endTime} · ${lesson.subjectName} · ${lesson.room ?? 'аудитория уточняется'}`);
        }
      },
      async (errorText) => {
        print(`  отказ инструмента: ${errorText}`);
        print('  смотрим институт без фильтра по группе:');
        await showTool(
          () => client.callTool({ name: 'get_schedule', arguments: {} }),
          (data) => {
            const lessons = data.items ?? [];
            print(`  пар в институте: ${lessons.length}`);
          },
          (fallbackText) => print(`  отказ инструмента: ${fallbackText}`),
        );
      },
    );

    // 4. Успеваемость студента по логину.
    print(`\nget_grades(${STUDENT_LOGIN}):`);
    await showTool(
      () => client.callTool({ name: 'get_grades', arguments: { login: STUDENT_LOGIN } }),
      (data) => {
        const student = data.student ?? {};
        const summary = data.summary ?? {};
        print(`  ${student.fullName ?? '?'}, ${student.groupName ?? '?'} (${student.faculty ?? '?'})`);
        print(`  средний балл: ${summary.averageScore ?? 'нет оценок'}, долгов: ${(summary.debts ?? []).length}`);
        for (const semester of data.semesters ?? []) {
          const marks = (semester.entries ?? [])
            .map((entry) => `${entry.subjectName}: ${entry.value ?? (entry.passed ? 'зачтено' : 'не зачтено')}`)
            .join('; ');
          print(`  семестр ${semester.semester}: ${marks}`);
        }
      },
      (errorText) => print(`  отказ инструмента: ${errorText}`),
    );

    // 5. Кто из студентов института болеет.
    print('\nsick_statuses({ activeOnly: true }):');
    await showTool(
      () => client.callTool({ name: 'sick_statuses', arguments: { activeOnly: true } }),
      (data) => {
        const sick = data.items ?? [];
        print(`  болеют сейчас: ${sick.length}`);
        for (const item of sick.slice(0, 10)) {
          print(`  ${item.fullName} (${item.groupName}), до ${String(item.dateTo).slice(0, 10)}`);
        }
      },
      (errorText) => print(`  отказ инструмента: ${errorText}`),
    );
  } catch (error) {
    process.stderr.write(`Пример клиента: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  } finally {
    // Для stdio транспорт гасит дочерний процесс сервера; для HTTP —
    // просто закрывает соединение.
    await client.close();
  }
}

/**
 * Вызывает инструмент и показывает результат.
 *
 * Отказ инструмента (result.isError) — не исключение: печатаем текст
 * ошибки и отдаём управление обработчику onError, сценарий продолжается.
 */
async function showTool(callTool, onData, onError) {
  const result = await callTool();
  if (result.isError === true) {
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : 'отказ без текста';
    await onError(text);
    return;
  }
  const data = result.structuredContent ?? {};
  await onData(data);
}
