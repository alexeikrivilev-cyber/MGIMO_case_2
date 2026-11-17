/**
 * ТЕСТЫ ВЕРИФИКАЦИИ СТУДБИЛЕТА (POST/GET /api/verification):
 * multipart с фото → заявка PENDING (номер в реестре) или REJECTED
 * (номера нет); файл уходит в приватное хранилище через packages/core;
 * неверный формат/отсутствие файла → 400.
 *
 * Сессия создаётся боевым createSession и передаётся в cookie —
 * маршруты резолвят студента из неё (идентификаторы не принимаются).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '@udgu/core';
import { GET as verificationRoute, POST as submitVerificationRoute } from '../app/api/verification/route';
import {
  closeWebTestDb,
  createGroup,
  createIdentityRegistryEntry,
  createStudent,
  resetWebTestData,
} from './helpers';
import { apiRequest, callRoute } from './http';

/** Минимальный «файл» изображения: мок-распознавание не смотрит на пиксели. */
function pngFile(name = 'card.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: 'image/png',
  });
}

let studentCardNumber: string;
let sessionToken: string;

test.before(async () => {
  await resetWebTestData();
  const group = await createGroup('ПИ-36');
  const student = await createStudent('student1', group.id);
  studentCardNumber = student.studentCardNumber;
  await createIdentityRegistryEntry(studentCardNumber, group.id);
  const { token } = await createSession(student.userId, { ip: '127.0.0.1', userAgent: 'node:test' });
  sessionToken = token;
});

test.after(async () => {
  await resetWebTestData();
  await closeWebTestDb();
});

function submit(cardNumber: string, photo: File | null) {
  const form = new FormData();
  form.set('cardNumber', cardNumber);
  if (photo !== null) {
    form.set('photo', photo);
  }
  return callRoute(
    submitVerificationRoute,
    apiRequest('/api/verification', { method: 'POST', formData: form, cookies: { udgu_session: sessionToken } }),
  );
}

test('POST /api/verification: номер из реестра → PENDING с распознанными полями', async () => {
  const response = await submit(studentCardNumber, pngFile());
  assert.equal(response.status(), 200);

  const body = await response.json<{
    verification: { status: string; recognizedCardNumber: string; recognizedGroupName: string };
  }>();
  assert.equal(body.verification.status, 'PENDING');
  assert.equal(body.verification.recognizedCardNumber, studentCardNumber);
  assert.notEqual(body.verification.recognizedGroupName, '');
});

test('GET /api/verification: своя заявка и гейт', async () => {
  const response = await callRoute(
    verificationRoute,
    apiRequest('/api/verification', { cookies: { udgu_session: sessionToken } }),
  );
  assert.equal(response.status(), 200);
  const body = await response.json<{
    verification: { status: string } | null;
    verificationGate: { verified: boolean };
  }>();
  assert.equal(body.verification?.status, 'PENDING');
  assert.equal(body.verificationGate.verified, false, 'PENDING ещё не открывает оценки');
});

test('POST /api/verification: номер не из реестра → REJECTED', async () => {
  const response = await submit('XX-0000-9999', pngFile());
  assert.equal(response.status(), 200);
  const body = await response.json<{ verification: { status: string; reviewComment: string | null } }>();
  assert.equal(body.verification.status, 'REJECTED');
  assert.match(body.verification.reviewComment ?? '', /реестр/i);
});

test('POST /api/verification: неверный формат файла → 400', async () => {
  const response = await submit(studentCardNumber, new File([new Uint8Array([1, 2, 3])], 'doc.txt', { type: 'text/plain' }));
  assert.equal(response.status(), 400);
  const body = await response.json<{ error: { code: string; message: string } }>();
  assert.equal(body.error.code, 'INVALID_INPUT');
  assert.match(body.error.message, /формат/i);
});

test('POST /api/verification: без фото → 400', async () => {
  const response = await submit(studentCardNumber, null);
  assert.equal(response.status(), 400);
});
