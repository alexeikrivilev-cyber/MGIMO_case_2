#!/usr/bin/env node
/**
 * Пример клиента MCP-сервера деканата (BRIEF v2 §7).
 *
 * Показывает агенту путь от нуля до данных:
 *   1. поднять сервер дочерним процессом (`npm run mcp:serve` в packages/mcp);
 *   2. initialize (рукопожатие + токен сессии сотрудника);
 *   3. tools/list (что умеет сервер);
 *   4. tools/call — очередь заявок и успеваемость студента;
 *   5. напечатать результаты и корректно закрыть сервер.
 *
 * Токен сессии — из env MCP_SESSION_TOKEN (как у сервера). Внешний
 * процесс получает его от клиента: в примере это делает вызывающий
 * команду, сам пример токен не хранит и не печатает.
 *
 * Запуск:
 *   MCP_SESSION_TOKEN=<токен> node packages/mcp/examples/agent-client.mjs
 *   MCP_SESSION_TOKEN=<токен> STUDENT_LOGIN=student1 node packages/mcp/examples/agent-client.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverEntry = path.join(packageDir, 'src', 'serve.ts');

const TOKEN = process.env.MCP_SESSION_TOKEN ?? '';
const STUDENT_LOGIN = process.env.STUDENT_LOGIN ?? 'student1';

if (TOKEN === '') {
  process.stderr.write(
    'Не задан MCP_SESSION_TOKEN. Получите токен сессии сотрудника:\n' +
      '  curl -s -X POST http://localhost:3000/api/auth/login ' +
      "-H 'content-type: application/json' -d '{\"login\":\"staff1\",\"password\":\"<пароль>\"}' -i | grep udgu_session\n",
  );
  process.exitCode = 1;
} else {
  await runDemo(TOKEN);
}

/** Поднимает сервер и ведёт с ним диалог новыми строками JSON. */
async function runDemo(token) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', serverEntry],
    { cwd: packageDir, stdio: ['pipe', 'pipe', 'inherit'] },
  );

  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    // Транспорт — newline-delimited JSON: последний фрагмент строки
    // остаётся в буфере до прихода остатка.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const message = JSON.parse(trimmed);
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });

  /** Отправляет запрос и ждёт ответ с тем же id. */
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Таймаут ответа на ${method}`)), 20000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  const print = (text) => process.stdout.write(`${text}\n`);

  try {
    // 1. Рукопожатие: токен сотрудника передаётся параметром initialize.
    const init = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-client-example', version: '1.0.0' },
      sessionToken: token,
    });
    print(`initialize → ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);

    // 2. Что умеет сервер.
    const tools = await request('tools/list');
    print(`tools/list → ${tools.result.tools.length} инструментов:`);
    for (const item of tools.result.tools) {
      print(`  - ${item.name}: ${item.title}`);
    }

    // 3. Очередь заявок института сотрудника.
    const requests = await request('tools/call', {
      name: 'deanery_requests_list',
      arguments: {},
    });
    const queue = requests.result.structuredContent;
    print(`\ndeanery_requests_list → заявок в очереди: ${queue.length}`);
    for (const item of queue.slice(0, 3)) {
      print(`  ${item.statusLabel} · ${item.typeLabel} · ${item.student.fullName} (${item.student.groupName})`);
    }

    // 4. Успеваемость студента по логину.
    const grades = await request('tools/call', {
      name: 'deanery_student_grades',
      arguments: { login: STUDENT_LOGIN },
    });
    const report = grades.result.structuredContent;
    print(`\ndeanery_student_grades(${STUDENT_LOGIN}) → ${report.student.fullName}, ${report.student.groupName}`);
    print(`  средний балл: ${report.summary.averageScore ?? 'нет оценок'}, долгов: ${report.summary.debts.length}`);
    for (const semester of report.semesters) {
      const marks = semester.entries.map((entry) => `${entry.subjectName}: ${entry.value ?? (entry.passed ? 'зачтено' : 'не зачтено')}`);
      print(`  семестр ${semester.semester}: ${marks.join('; ')}`);
    }
  } catch (error) {
    process.stderr.write(`Пример клиента: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    child.stdin.end();
    child.kill();
  }
}
