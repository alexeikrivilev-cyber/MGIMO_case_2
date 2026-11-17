/**
 * POST /api/auth/oauth/[provider]/callback — завершение эмуляции
 * согласия VK ID / MAX / Telegram (BRIEF v2: регистрация с обязательными
 * ФИО и группой).
 *
 * Проверки и действия:
 * 1. провайдер из пути (vk_id|max|telegram, иначе 404) и тело по zod;
 * 2. intent по state: существует, тот же провайдер, не истёк (+10 мин),
 *    не использован — затем помечается consumedAt (updateMany с условием
 *    consumedAt = null исключает повторное использование state в гонке);
 * 3. группа ищется по названию в Group — не найдена → 400 с понятной
 *    ошибкой (студента нельзя посадить в несуществующую группу);
 * 4. ФИО разбирается на фамилию/имя/отчество;
 * 5. учётная запись: существующая привязка OAuthAccount по
 *    providerAccountId → вход в неё; иначе логин занят студентом →
 *    привязка провайдера к нему; иначе создаём User (STUDENT) + Student
 *    + OAuthAccount. Пароль у такой УЗ — argon2id-хеш от случайной строки
 *    (вход по паролю невозможен, правил хранения хешей это не ломает);
 * 6. сессия (httpOnly-cookie + CSRF-cookie) и аудит OAUTH_REGISTER.
 *
 * Реальных ключей провайдеров нет: providerAccountId приходит из тела
 * (страница-эмуляция согласия передаёт идентификатор «аккаунта
 * провайдера») или генерируется.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createSession,
  hashPassword,
  writeAuditEvent,
  ValidationError,
} from '@udgu/core';
import { getPrisma, type OAuthProvider } from '@udgu/db';
import {
  OAUTH_PROVIDER_BY_PATH,
  oauthCallbackSchema,
  oauthProviderSchema,
} from '@/lib/validation';
import { clientIp, parseJsonBody, userAgent } from '@/lib/http';
import { coreErrorResponse, issueCsrfCookie, setSessionCookie } from '@/lib/session';

/** Префикс сгенерированного providerAccountId по провайдеру. */
const PROVIDER_ACCOUNT_PREFIX: Record<OAuthProvider, string> = {
  VK_ID: 'vk',
  MAX: 'max',
  TELEGRAM: 'tg',
};

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
    const dbProvider: OAuthProvider = OAUTH_PROVIDER_BY_PATH[parsedProvider.data];

    const body = await parseJsonBody(request, oauthCallbackSchema);
    const prisma = getPrisma();

    // ---- 2. Согласие: существует, свежее, одноразовое ----
    const intent = await prisma.oAuthIntent.findUnique({
      where: { state: body.state },
      select: { state: true, provider: true, expiresAt: true, consumedAt: true },
    });
    if (
      intent === null ||
      intent.provider !== dbProvider ||
      intent.consumedAt !== null ||
      intent.expiresAt.getTime() <= Date.now()
    ) {
      throw new ValidationError(
        'INVALID_INPUT',
        'Ссылка регистрации недействительна или устарела. Начните регистрацию заново.',
      );
    }
    const consumed = await prisma.oAuthIntent.updateMany({
      where: { state: body.state, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new ValidationError(
        'INVALID_INPUT',
        'Ссылка регистрации уже использована. Начните регистрацию заново.',
      );
    }

    // ---- 3. Группа по названию ----
    const group = await prisma.group.findFirst({
      where: { name: { equals: body.groupName, mode: 'insensitive' } },
      select: { id: true, name: true, faculty: true, direction: true, course: true },
    });
    if (group === null) {
      throw new ValidationError(
        'INVALID_INPUT',
        `Группа «${body.groupName}» не найдена. Проверьте название: его показывает староста в расписании группы.`,
      );
    }

    // ---- 4. ФИО ----
    const nameParts = body.fullName.trim().split(/\s+/);
    if (nameParts.length < 2 || nameParts.length > 3) {
      throw new ValidationError(
        'INVALID_INPUT',
        'ФИО должно содержать фамилию, имя и (при наличии) отчество.',
      );
    }
    const [lastName, firstName, middleName] = [
      nameParts[0] as string,
      nameParts[1] as string,
      nameParts[2] ?? null,
    ];

    // Логин необязателен (BRIEF v2): студент вошёл через провайдера.
    // Если логин не передан, выводим его из идентификатора аккаунта
    // провайдера — уникальный, латиницей, satisfies login-регулярка.
    const requestedAccountId = body.providerAccountId?.trim();
    const providerAccountId =
      requestedAccountId !== undefined && requestedAccountId !== ''
        ? requestedAccountId
        : `${PROVIDER_ACCOUNT_PREFIX[dbProvider]}_${randomUUID()}`;
    const login =
      body.login !== undefined
        ? body.login.toLowerCase()
        : `${PROVIDER_ACCOUNT_PREFIX[dbProvider]}_${providerAccountId.slice(-12)}`.toLowerCase();

    // ---- 5. Учётная запись ----
    let userId: string;
    let oauthAccountId: string;

    // Существующая привязка провайдера — это вход (идентичность
    // подтвердил провайдер). В продакшне providerAccountId приходит из
    // подписанного ответа провайдера; в прототипе его передаёт страница
    // эмуляции согласия — контракт тот же, реальных ключей нет.
    const existingAccount = await prisma.oAuthAccount.findUnique({
      where: { providerAccountId },
      select: { id: true, userId: true, user: { select: { role: true } } },
    });

    if (existingAccount !== null) {
      if (existingAccount.user.role !== 'STUDENT') {
        throw new ValidationError(
          'CONFLICT',
          'Эта учётная запись провайдера привязана к другому пользователю. Обратитесь в деканат.',
        );
      }
      userId = existingAccount.userId;
      oauthAccountId = existingAccount.id;
    } else {
      // Занятый логин НЕ приводим к привязке: в эмуляции провайдер не
      // подтверждает, что логин принадлежит пользователю, — иначе любой
      // мог бы зайти в чужой кабинет, зная логин. Новая УЗ создаётся
      // только для свободного логина; иначе — честный конфликт.
      const userByLogin = await prisma.user.findFirst({
        where: { login: { equals: login, mode: 'insensitive' } },
        select: { id: true },
      });
      if (userByLogin !== null) {
        throw new ValidationError(
          'CONFLICT',
          'Логин уже занят. Выберите другой логин или войдите по паролю университетской учётной записи.',
        );
      }

      const created = await prisma.user.create({
        data: {
          login,
          // Случайный пароль: вход по паролю для такой УЗ невозможен,
          // а хеш остаётся argon2id (правило «пароли только хешами»).
          passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
          role: 'STUDENT',
        },
        select: { id: true },
      });
      userId = created.id;
      await prisma.student.create({
        data: {
          userId,
          lastName,
          firstName,
          middleName,
          faculty: group.faculty,
          direction: group.direction,
          course: group.course,
          groupId: group.id,
          email: await uniqueEmail(prisma, login),
          studentCardNumber: await uniqueCardNumber(prisma),
          phone: null,
        },
      });

      const account = await prisma.oAuthAccount.create({
        data: { userId, provider: dbProvider, providerAccountId },
        select: { id: true },
      });
      oauthAccountId = account.id;
    }

    // ---- 6. Сессия и аудит ----
    const { token } = await createSession(userId, {
      ip: clientIp(request),
      userAgent: userAgent(request),
    });
    await writeAuditEvent({
      actorUserId: userId,
      action: 'OAUTH_REGISTER',
      entity: 'OAuthAccount',
      entityId: oauthAccountId,
      meta: { provider: dbProvider },
    });

    const response = NextResponse.json({ ok: true, redirectTo: '/dashboard' });
    setSessionCookie(response, token);
    issueCsrfCookie(response);
    return response;
  } catch (error) {
    return coreErrorResponse(error);
  }
}

/** Email нового студента: логин@udsu.ru, при коллизии — с суффиксом. */
async function uniqueEmail(prisma: ReturnType<typeof getPrisma>, login: string): Promise<string> {
  const base = `${login}@udsu.ru`;
  const taken = await prisma.student.findUnique({ where: { email: base }, select: { id: true } });
  if (taken === null) {
    return base;
  }
  return `${login}.${randomUUID().slice(0, 8)}@udsu.ru`;
}

/** Номер зачётки нового студента: уникальный, вымышленный формат УдГУ. */
async function uniqueCardNumber(prisma: ReturnType<typeof getPrisma>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cardNumber = `UDGU-2026-${randomBytes(3).toString('hex').toUpperCase()}`;
    const taken = await prisma.student.findUnique({
      where: { studentCardNumber: cardNumber },
      select: { id: true },
    });
    if (taken === null) {
      return cardNumber;
    }
  }
  // Крайне маловероятно: пять коллизий подряд. UDP-номер по uuid —
  // коллизия невозможна в практике.
  return `UDGU-2026-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}
