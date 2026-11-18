/**
 * Живой stdio: сервер поднимается РЕАЛЬНЫМ дочерним процессом, и с ним
 * говорит SDK-клиент (StdioClientTransport) по-настоящему: initialize →
 * tools/list → tools/call.
 *
 * ГЛАВНОЕ — РЕГРЕССИЯ НА ДЕФЕКТ ВОЛНЫ A: дочерний процесс запускается
 * БЕЗ DATABASE_URL и ИЗ ЧУЖОГО РАБОЧЕГО КАТАЛОГА (временный каталог),
 * точно как это делает агент деканата. Корневой .env должен
 * подхватываться по расположению кода (src/env.ts), иначе Prisma
 * падал с «DATABASE_URL не задан» на первом обращении к базе.
 *
 * Проверка идёт в две части:
 *   1. детерминированно: процесс удаляет DATABASE_URL, вызывает
 *      ensureDatabaseUrlFromRootEnv() и сообщает только ФАКТ загрузки
 *      (без значения строки подключения);
 *   2. на живом сервере: initialize/tools/list работают, tools/call
 *      отвечает отказом по НЕДЕЙСТВИТЕЛЬНОЙ сессии (токен заведомо
 *      неверный) — значит клиент БД создался, .env нашёлся. Если .env
 *      не подхватился, ответ был бы «Внутренняя ошибка сервера».
 *
 * Токен сессии в выводе процесса не появляется — это тоже проверяется.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensureIsolatedDatabase } from './fixtures.js';

const mcpServerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stdioEntry = path.join(mcpServerDir, 'src', 'stdio.ts');
const envModulePath = path.join(mcpServerDir, 'src', 'env.ts');
const tsxLoader = path.resolve(mcpServerDir, '../../node_modules/tsx/dist/loader.mjs');

/** Токен заведомо недействителен: сессии с ним нет ни в одной базе. */
const BOGUS_TOKEN = 'несуществующий-токен-сессии-stdio';

/**
 * Скрипт-проба: удаляет DATABASE_URL и зовёт загрузчик .env из
 * src/env.ts. Печатает ТОЛЬКО факт загрузки — не строку подключения.
 */
const ENV_PROBE = [
  `const mod = await import(${JSON.stringify(envModulePath)});`,
  'delete process.env.DATABASE_URL;',
  'mod.ensureDatabaseUrlFromRootEnv();',
  "process.stdout.write(process.env.DATABASE_URL === undefined ? 'loaded=false' : 'loaded=true');",
].join('\n');

/** Окружение дочернего процесса: без DATABASE_URL (его даст .env). */
function childEnv(extra: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  delete env.DATABASE_URL;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

test.before(async () => {
  // Изолированная тестовая база этому тесту не нужна (дочерний процесс
  // читает .env), но хук fixtures гарантирует единое окружение процесса.
  await ensureIsolatedDatabase();
});

test('корневой .env подхватывается без DATABASE_URL в окружении', async () => {
  const child = spawn(
    process.execPath,
    ['--import', tsxLoader, '--input-type=module', '-e', ENV_PROBE],
    { cwd: tmpdir(), env: childEnv({}), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const [stdout, stderr] = await collect(child);
  assert.equal(child.exitCode, 0, `процесс завершился успехом: ${stderr}`);
  assert.equal(stdout.trim(), 'loaded=true', '.env найден по расположению кода и дал DATABASE_URL');
  // Сам факт проверки не должен печатать строку подключения.
  assert.ok(!stdout.includes('postgresql://'), 'строка подключения не печатается');
});

test('живой stdio: initialize → tools/list → tools/call, .env даёт доступ к БД', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', tsxLoader, stdioEntry],
    // Чужой рабочий каталог + без DATABASE_URL: как у агента деканата.
    cwd: tmpdir(),
    env: childEnv({ MCP_SESSION_TOKEN: BOGUS_TOKEN }),
    stderr: 'pipe',
  });

  const client = new Client({ name: 'udgu-mcp-stdio-test', version: '1.0.0' });
  let stderrText = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8');
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    assert.equal(tools.tools.length, 11, 'набор инструментов по спеке');

    const result = await client.callTool({
      name: 'get_grades',
      arguments: { login: 'student1' },
    });
    assert.equal(result.isError, true, 'заведомо неверный токен → отказ инструмента');
    const content: unknown = result.content;
    const first = Array.isArray(content) ? (content[0] as { type?: string; text?: string }) : undefined;
    const text = first?.type === 'text' ? (first.text ?? '') : '';
    assert.match(
      text,
      /Сессия недействительна/,
      'ответ про сессию, а не «Внутренняя ошибка сервера»: .env подхватился, БД ответила',
    );

    // Токен сессии равносилен паролю: в логах дочернего процесса его нет.
    assert.ok(!stderrText.includes(BOGUS_TOKEN), 'токена нет в stderr');
    assert.ok(!stderrText.includes('DATABASE_URL'), 'строки подключения нет в stderr');
  } finally {
    await client.close();
  }
});

/** Ждёт завершения процесса и собирает stdout/stderr. */
function collect(child: ReturnType<typeof spawn>): Promise<[string, string]> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', () => resolve([stdout, stderr]));
  });
}
