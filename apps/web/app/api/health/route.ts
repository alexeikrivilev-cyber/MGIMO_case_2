import { NextResponse } from 'next/server';

// healthcheck для docker-compose и мониторинга
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok' });
}
