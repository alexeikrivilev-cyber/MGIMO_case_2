/**
 * POST /api/auth/oauth/[provider]/start — начало регистрации через
 * VK ID / MAX / Telegram (эмуляция согласия, BRIEF v2).
 *
 * Провайдер берётся из пути: vk_id | max | telegram. Всё остальное —
 * 404 (маршрут не существует, перебор провайдеров ничего не узнаёт).
 *
 * Создаёт OAuthIntent: одноразовый state (uuid), срок 10 минут, purpose
 * 'register', необязательные предзаполненные логин/ФИО/группа из формы.
 * Возвращает {consentUrl} — адрес страницы-эмуляции согласия провайдера
 * (/register?state=…&provider=…: провайдер в ссылке, чтобы страница
 * согласия показывала того же провайдера, через которого нажали «Войти»).
 * Реальных ключей провайдеров в прототипе нет.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '@udgu/db';
import { OAUTH_PROVIDER_BY_PATH, oauthProviderSchema, oauthStartSchema } from '@/lib/validation';
import { parseOptionalJsonBody } from '@/lib/http';
import { coreErrorResponse, issueCsrfCookie } from '@/lib/session';

/** Срок жизни ссылки согласия, минуты. */
const INTENT_TTL_MINUTES = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  try {
    const { provider } = await params;
    const parsedProvider = oauthProviderSchema.safeParse(provider);
    if (!parsedProvider.success) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Способ входа не поддерживается.' } },
        { status: 404 },
      );
    }

    const body = await parseOptionalJsonBody(request, oauthStartSchema);
    const state = randomUUID();
    const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000);

    await getPrisma().oAuthIntent.create({
      data: {
        state,
        provider: OAUTH_PROVIDER_BY_PATH[parsedProvider.data],
        login: body.login ?? null,
        fullName: body.fullName ?? null,
        groupName: body.groupName ?? null,
        purpose: 'register',
        expiresAt,
      },
      select: { state: true },
    });

    const response = NextResponse.json({
      consentUrl: `/register?state=${state}&provider=${parsedProvider.data}`,
      state,
      expiresInSeconds: INTENT_TTL_MINUTES * 60,
    });
    // CSRF-cookie выдаём сразу: после регистрации клиенту понадобится
    // токен для защищённых POST-ов кабинета.
    issueCsrfCookie(response);
    return response;
  } catch (error) {
    return coreErrorResponse(error);
  }
}
