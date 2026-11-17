/**
 * ТЕСТЫ РЕГИСТРАЦИИ ЧЕРЕЗ OAUTH-ЭМУЛЯЦИЮ (VK ID / MAX / Telegram).
 *
 * - start: одноразовый state на 10 минут, consentUrl → /register?state=…;
 *   неизвестный провайдер → 404;
 * - callback: создаёт User(STUDENT) + Student + OAuthAccount, сессию,
 *   аудит; отсутствие группы/неверная группа → 400; повторное
 *   использование state → 400;
 * - повторный вход по тому же providerAccountId не создаёт второго
 *   пользователя;
 * - логин, занятый сотрудником, → 409 (нельзя привязать студента к
 *   служебной УЗ).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as startRoute } from '../app/api/auth/oauth/[provider]/start/route';
import { POST as callbackRoute } from '../app/api/auth/oauth/[provider]/callback/route';
import { GET as sessionRoute } from '../app/api/auth/session/route';
import { getPrisma } from '@udgu/db';
import { closeWebTestDb, createGroup, createUser, resetWebTestData } from './helpers';
import { apiRequest, callRoute, callRouteWithParams, sessionCookiesFrom } from './http';

test.before(async () => {
  await resetWebTestData();
  await createGroup('ПИ-21');
  await createGroup('ЮР-22');
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

function start(provider: string, body?: unknown) {
  return callRouteWithParams(
    startRoute,
    apiRequest(`/api/auth/oauth/${provider}/start`, { method: 'POST', body: body ?? {} }),
    { provider },
  );
}

function callback(provider: string, body: unknown) {
  return callRouteWithParams(
    callbackRoute,
    apiRequest(`/api/auth/oauth/${provider}/callback`, { method: 'POST', body }),
    { provider },
  );
}

test('start: состояние согласия создаётся, consentUrl ведёт на /register', async () => {
  const response = await start('vk_id', {
    login: 'prefilled',
    fullName: 'Новиков Иван Петрович',
    groupName: 'ПИ-21',
  });
  assert.equal(response.status(), 200);

  const body = await response.json<{ consentUrl: string; state: string; expiresInSeconds: number }>();
  assert.match(body.consentUrl, /^\/register\?state=[0-9a-f-]{36}$/);
  assert.equal(body.expiresInSeconds, 600);

  const intent = await getPrisma().oAuthIntent.findUnique({ where: { state: body.state } });
  assert.ok(intent !== null, 'интент сохранён');
  assert.equal(intent.provider, 'VK_ID');
  assert.equal(intent.purpose, 'register');
  assert.equal(intent.login, 'prefilled');
  assert.equal(intent.consumedAt, null);
  const ttlMinutes = (intent.expiresAt.getTime() - intent.createdAt.getTime()) / 60000;
  assert.ok(Math.abs(ttlMinutes - 10) < 0.1, 'срок согласия ~10 минут');

  // CSRF-cookie выдаётся сразу: после регистрации понадобится для POST.
  assert.ok(response.cookie('udgu_csrf') !== undefined);
});

test('start: неизвестный провайдер → 404', async () => {
  const response = await start('yandex');
  assert.equal(response.status(), 404);
});

test('callback: регистрация создаёт студента, сессию и привязку провайдера', async () => {
  const startResponse = await start('max');
  const { state } = await startResponse.json<{ state: string }>();

  const response = await callback('max', {
    state,
    login: 'OAuthStudent',
    fullName: 'Новиков Иван Петрович',
    groupName: 'ПИ-21',
  });
  assert.equal(response.status(), 200);
  const body = await response.json<{ ok: boolean; redirectTo: string }>();
  assert.equal(body.ok, true);
  assert.equal(body.redirectTo, '/dashboard');

  const user = await getPrisma().user.findFirst({ where: { login: 'oauthstudent' } });
  assert.ok(user !== null, 'логин приводится к нижнему регистру');
  assert.equal(user.role, 'STUDENT');

  const student = await getPrisma().student.findUnique({ where: { userId: user.id } });
  assert.ok(student !== null);
  assert.equal(student.lastName, 'Новиков');
  assert.equal(student.firstName, 'Иван');
  assert.equal(student.middleName, 'Петрович');
  const group = await getPrisma().group.findUnique({ where: { id: student.groupId } });
  assert.equal(group?.name, 'ПИ-21', 'студент попадает в заявленную группу');

  const account = await getPrisma().oAuthAccount.findFirst({
    where: { userId: user.id, provider: 'MAX' },
  });
  assert.ok(account !== null);
  assert.equal(account.provider, 'MAX');
  assert.equal(account.userId, user.id);
  assert.match(account.providerAccountId, /^max_/, 'идентификатор аккаунта провайдера сгенерирован');

  const audit = await getPrisma().auditEvent.findFirst({
    where: { action: 'OAUTH_REGISTER', entity: 'OAuthAccount' },
  });
  assert.ok(audit !== null, 'событие OAUTH_REGISTER в аудите');

  // Сессия рабочая.
  const sessionCookie = response.cookie('udgu_session');
  assert.ok(sessionCookie !== undefined);
  const sessionResponse = await callRoute(
    sessionRoute,
    apiRequest('/api/auth/session', { cookies: { udgu_session: sessionCookie } }),
  );
  assert.equal(sessionResponse.status(), 200);
  assert.equal((await sessionResponse.json<{ user: { login: string } }>()).user.login, 'oauthstudent');

  // Новый студент НЕ верифицирован: гейт закрывает оценки (BRIEF v2).
  const gate = (await sessionResponse.json<{ verificationGate: { verified: boolean } }>())
    .verificationGate;
  assert.equal(gate.verified, false);
});

test('callback: неизвестная группа → 400 с понятной ошибкой', async () => {
  const startResponse = await start('telegram');
  const { state } = await startResponse.json<{ state: string }>();

  const response = await callback('telegram', {
    state,
    login: 'telegramuser',
    fullName: 'Смирнов Никита Иванович',
    groupName: 'НЕСУЩЕСТВУЮЩАЯ-99',
  });
  assert.equal(response.status(), 400);
  const body = await response.json<{ error: { code: string; message: string } }>();
  assert.equal(body.error.code, 'INVALID_INPUT');
  assert.match(body.error.message, /группа/i);

  const user = await getPrisma().user.findFirst({ where: { login: 'telegramuser' } });
  assert.equal(user, null, 'студент не создан, если группа не найдена');
});

test('callback: повторное использование state → 400', async () => {
  const startResponse = await start('vk_id');
  const { state } = await startResponse.json<{ state: string }>();

  const first = await callback('vk_id', {
    state,
    login: 'reuseuser',
    fullName: 'Кузнецова Анна Сергеевна',
    groupName: 'ЮР-22',
  });
  assert.equal(first.status(), 200);

  const second = await callback('vk_id', {
    state,
    login: 'reuseuser2',
    fullName: 'Кузнецова Анна Сергеевна',
    groupName: 'ЮР-22',
  });
  assert.equal(second.status(), 400);
});

test('callback: вход по существующему providerAccountId не создаёт второго пользователя', async () => {
  const first = await start('vk_id');
  const firstState = (await first.json<{ state: string }>()).state;
  const registered = await callback('vk_id', {
    state: firstState,
    login: 'returning',
    fullName: 'Возвращающийся Пользователь Тестович',
    groupName: 'ПИ-21',
  });
  assert.equal(registered.status(), 200);

  // Идентификатор «аккаунта провайдера» знает только провайдер: берём
  // его из БД (в реальном потоке он пришёл бы из подписанного ответа).
  const account = await getPrisma().oAuthAccount.findFirst({
    where: { user: { login: 'returning' } },
    select: { providerAccountId: true },
  });
  assert.ok(account !== null);

  const second = await start('vk_id');
  const secondState = (await second.json<{ state: string }>()).state;
  const loginAgain = await callback('vk_id', {
    state: secondState,
    login: 'returning',
    fullName: 'Возвращающийся Пользователь Тестович',
    groupName: 'ПИ-21',
    providerAccountId: account.providerAccountId,
  });
  assert.equal(loginAgain.status(), 200);

  const users = await getPrisma().user.findMany({ where: { login: 'returning' } });
  assert.equal(users.length, 1, 'второй пользователь не создан');
  const accounts = await getPrisma().oAuthAccount.findMany({ where: { providerAccountId: account.providerAccountId } });
  assert.equal(accounts.length, 1, 'привязка одна');
});

test('callback: логин занят → 409 (без подтверждения провайдера не привязываем)', async () => {
  await createUser('staff1', 'STAFF');
  const startResponse = await start('telegram');
  const { state } = await startResponse.json<{ state: string }>();

  const response = await callback('telegram', {
    state,
    login: 'staff1',
    fullName: 'Смирнов Никита Иванович',
    groupName: 'ПИ-21',
  });
  assert.equal(response.status(), 409);
  const body = await response.json<{ error: { code: string } }>();
  assert.equal(body.error.code, 'CONFLICT');

  // Служебная УЗ осталась непривязанной: студентов к ней не подселили.
  const accounts = await getPrisma().oAuthAccount.findMany({
    where: { user: { login: 'staff1' } },
  });
  assert.equal(accounts.length, 0, 'к служебной УЗ провайдер не привязан');
});

/**
 * РЕГРЕССИЯ (найдена QA-гейтом Hermes прогоном HTTP): схема callback
 * требовала login, из-за чего регистрация через провайдера без логина
 * падала с 400 INVALID_INPUT. BRIEF v2 делает обязательными только ФИО
 * и группу — логин студент не придумывает, он вошёл через провайдера.
 */
test('callback: логин НЕ обязателен — выводится из аккаунта провайдера', async () => {
  const startResponse = await start('max');
  const { state } = await startResponse.json<{ state: string }>();

  const response = await callback('max', {
    state,
    fullName: 'Орлова Мария Андреевна',
    groupName: 'ЮР-22',
  });
  assert.equal(response.status(), 200, 'регистрация без логина должна проходить');

  // Cookie сессии читаем так же, как в соседнем тесте регистрации.
  const sessionCookie = (
    response as unknown as { cookie(name: string): string | undefined }
  ).cookie('udgu_session');
  assert.ok(sessionCookie !== undefined, 'выдана cookie сессии');
  const sessionResponse = await callRoute(
    sessionRoute,
    apiRequest('/api/auth/session', { cookies: { udgu_session: sessionCookie } }),
  );
  assert.equal(sessionResponse.status(), 200, 'сессия создана');
  const sessionBody = await sessionResponse.json<{
    user: { login: string; role: string; studentId: string | null };
    verificationGate: { verified: boolean };
  }>();
  assert.equal(sessionBody.user.role, 'STUDENT');
  assert.match(sessionBody.user.login, /^max_/, 'логин выведен из провайдера');
  assert.ok(sessionBody.user.studentId !== null, 'студенческая запись создана');

  // Студент realmente существует в БД с заявленным ФИО.
  const created = await getPrisma().student.findUnique({
    where: { userId: (await getPrisma().user.findFirst({ where: { login: sessionBody.user.login } }))!.id },
  });
  assert.equal(created?.lastName, 'Орлова');
  assert.equal(sessionBody.verificationGate.verified, false, 'новый студент не верифицирован');

  // Уникальность: вторая такая регистрация не конфликтует по логину.
  const start2 = await start('max');
  const { state: state2 } = await start2.json<{ state: string }>();
  const response2 = await callback('max', {
    state: state2,
    fullName: 'Крылов Пётр Сергеевич',
    groupName: 'ЮР-22',
  });
  assert.equal(response2.status(), 200, 'второй студент без логина регистрируется независимо');
});
