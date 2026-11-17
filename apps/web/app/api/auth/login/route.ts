import { NextResponse } from 'next/server';

// Реализуется на шаге P1.3: argon2id-верификация пароля, создание Session
// (tokenHash), httpOnly-cookie, rate-limit на логин+IP, аудит входа.
// Пока маршрут честно сообщает 501 — фронт показывает это как ошибку входа.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Вход временно недоступен: маршрут авторизации в разработке (шаг P1.3).' },
    { status: 501 },
  );
}
