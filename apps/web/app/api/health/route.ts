/**
 * GET /api/health — статус сервиса и РЕАЛЬНАЯ проверка подключения к БД.
 *
 * healthcheck для docker-compose и мониторинга: если PostgreSQL
 * недоступен, отдаём 503 (статус degraded), а не «ок» — иначе оркестратор
 * считает сервис здоровым и направляет на него трафик.
 *
 * Секретов в ответе нет: только статус, наличие БД и время процесса.
 */
import { NextResponse } from 'next/server';
import { getPrisma } from '@udgu/db';

export async function GET(): Promise<NextResponse> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (error) {
    console.error('[health] проверка БД не прошла:', error);
    return NextResponse.json(
      { status: 'degraded', db: 'unavailable', uptimeSeconds: Math.round(process.uptime()) },
      { status: 503 },
    );
  }
}
