/**
 * Клиент MCP-сервера для тестов: поднимает сервер РЕАЛЬНЫМ дочерним
 * процессом и общается с ним по stdio (newline-delimited JSON-RPC 2.0).
 *
 * Почему именно процесс, а не вызов DeaneryMcpServer.handle напрямую:
 * тест должен проверять транспорт (кодировка строк, каналы stdin/stdout,
 * отсутствие токена в выводе) и то, что сервер поднимается командой
 * `npm run mcp:serve`. Моки транспорта скрыли бы ровно те ошибки,
 * из-за которых MCP-интеграция ломается на практике.
 *
 * Токен сессии наружу (в stdout/stderr) не попадает — это тоже проверяется
 * тестом: клиент помнит всё, что сервер написал в оба канала.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureIsolatedDatabase, ensureStorageDir } from './fixtures';

const mcpDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverEntry = path.join(mcpDir, 'src', 'serve.ts');

/** Таймаут одного запроса: первый включает старт tsx и подключение к БД. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface McpClientOptions {
  /** Токен сессии сотрудника (как из cookie после входа). */
  readonly token?: string;
  /** Переменные окружения процесса-сервера (поверх базовых). */
  readonly env?: Record<string, string | undefined>;
}

export interface McpResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  readonly #child;
  readonly #pending = new Map<number, (response: McpResponse) => void>();
  #nextId = 1;
  #stdout = '';
  #stderr = '';
  /** Неполная последняя строка stdout (транспорт — newline-delimited). */
  #pendingBuffer = '';

  private constructor(child: ReturnType<typeof spawn>) {
    this.#child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.#stdout += chunk;
      this.#pendingBuffer += chunk;
      const lines = this.#pendingBuffer.split('\n');
      // Последний фрагмент может быть неполной строкой — оставляем его.
      this.#pendingBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          continue;
        }
        const message = JSON.parse(trimmed) as McpResponse;
        const settle = this.#pending.get(Number(message.id));
        if (settle !== undefined) {
          this.#pending.delete(Number(message.id));
          settle(message);
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
  }

  /** Поднимает сервер и ждёт готовности процесса (без запроса). */
  static async start(options: McpClientOptions = {}): Promise<McpClient> {
    const databaseUrl = await ensureIsolatedDatabase();
    const storageDir = await ensureStorageDir();

    const env: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      STORAGE_DIR: storageDir,
      ...options.env,
    };
    if (options.token === undefined) {
      delete env.MCP_SESSION_TOKEN;
    } else {
      env.MCP_SESSION_TOKEN = options.token;
    }

    const child = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
      cwd: mcpDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const client = new McpClient(child);
    // Ждём первой строки в stderr: сервер пишет туда строку запуска ДО
    // чтения stdin — это признак «процесс поднялся».
    await client.#waitForStartup();
    return client;
  }

  /** Всё, что сервер написал в stdout (канал протокола). */
  get stdoutText(): string {
    return this.#stdout;
  }

  /** Всё, что сервер написал в stderr (логи). */
  get stderrText(): string {
    return this.#stderr;
  }

  /** Запрос JSON-RPC; резолвится ответом с тем же id. */
  request(method: string, params?: unknown): Promise<McpResponse> {
    const id = this.#nextId++;
    return new Promise<McpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Таймаут ответа на ${method} (id ${id})`));
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      const message = params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
      this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
    });
  }

  /** Вызов инструмента (tools/call). */
  callTool(name: string, args: Record<string, unknown> = {}): Promise<McpResponse> {
    return this.request('tools/call', { name, arguments: args });
  }

  /** Уведомление (без id): ответ по протоколу не отсылается. */
  notify(method: string, params?: unknown): void {
    const message =
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
    this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  /** Сколько строк сервер написал в stdout (канал протокола). */
  get stdoutLineCount(): number {
    return this.#stdout.split('\n').filter((line) => line.trim() !== '').length;
  }

  /** Закрывает сервер: конец stdin → процесс должен выйти сам. */
  async close(): Promise<void> {
    this.#child.stdin?.end();
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.#child.once('exit', () => resolve(true));
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 5000);
      }),
    ]);
    if (!exited) {
      this.#child.kill('SIGKILL');
    }
  }

  async #waitForStartup(): Promise<void> {
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    while (this.#stderr === '' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (this.#stderr === '') {
      throw new Error('Сервер не написал строку запуска в stderr');
    }
  }
}
