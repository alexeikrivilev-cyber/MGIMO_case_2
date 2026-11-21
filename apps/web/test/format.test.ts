/**
 * Тесты чистых функций форматирования (components/format.ts).
 *
 * Здесь — lessonMoment (волна 5, docs/design/ui-alive-wave-5.html): метка
 * «когда» у ближайшей пары на дашборде. Функция чистая, поэтому все четыре
 * kind'а и границы проверяются без БД и без рендера.
 *
 * TZ-НЕЗАВИСИМОСТЬ: мгновения пары строятся через Date.UTC из компонентов
 * 'YYYY-MM-DD' + 'HH:MM' (UTC), now сравнивается как абсолютный момент
 * (getTime). Поэтому результат не зависит от часового пояса хоста — тесты
 * ниже проверяют именно UTC-поля: один и тот же момент, записанный разными
 * смещениями, даёт один и тот же ответ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, lessonMoment } from '../components/format';

/** Среда 25 ноября 2026, пара 10:00–11:20 (UTC). */
const DATE = '2026-11-25';
const START = '10:00';
const END = '11:20';

/** Мгновение в UTC: TZ хоста в построении не участвует. */
function utc(iso: string): Date {
  return new Date(iso);
}

test('lessonMoment: пара идёт сейчас — kind NOW, метка «Сейчас»', () => {
  // Ровно начало: начало включено в интервал.
  assert.deepEqual(lessonMoment(utc('2026-11-25T10:00:00.000Z'), DATE, START, END), {
    kind: 'NOW',
    label: 'Сейчас',
  });
  // Середина пары.
  assert.deepEqual(lessonMoment(utc('2026-11-25T10:40:00.000Z'), DATE, START, END), {
    kind: 'NOW',
    label: 'Сейчас',
  });
  // Минута до конца — ещё идёт.
  assert.equal(lessonMoment(utc('2026-11-25T11:19:00.000Z'), DATE, START, END).kind, 'NOW');
});

test('lessonMoment: до начала меньше суток — kind BEFORE, метка «Через …»', () => {
  // Минута до начала: до начала меньше 24 ч.
  assert.deepEqual(lessonMoment(utc('2026-11-25T09:59:00.000Z'), DATE, START, END), {
    kind: 'BEFORE',
    label: 'Через 1 мин',
  });
  // 45 мин и 2 ч 15 мин — подписи сверяются с formatDuration из того же файла.
  assert.equal(
    lessonMoment(utc('2026-11-25T09:15:00.000Z'), DATE, START, END).label,
    `Через ${formatDuration(45)}`,
  );
  assert.equal(
    lessonMoment(utc('2026-11-25T07:45:00.000Z'), DATE, START, END).label,
    `Через ${formatDuration(135)}`,
  );
  assert.equal(lessonMoment(utc('2026-11-25T07:45:00.000Z'), DATE, START, END).label, 'Через 2 ч 15 мин');
});

test('lessonMoment: до начала сутки и больше — kind FAR, метки нет', () => {
  // Ровно сутки до начала: граница «меньше 24 часов» исключительна.
  assert.deepEqual(lessonMoment(utc('2026-11-24T10:00:00.000Z'), DATE, START, END), {
    kind: 'FAR',
    label: '',
  });
  // Через 30 часов до начала — метку не показываем: дата уже в карточке.
  assert.deepEqual(lessonMoment(utc('2026-11-24T04:00:00.000Z'), DATE, START, END), {
    kind: 'FAR',
    label: '',
  });
});

test('lessonMoment: пара закончилась — kind AFTER, метка «Завершилась»', () => {
  // Ровно конец: конец исключён из интервала «сейчас».
  assert.deepEqual(lessonMoment(utc('2026-11-25T11:20:00.000Z'), DATE, START, END), {
    kind: 'AFTER',
    label: 'Завершилась',
  });
  // Через минуту после конца и гораздо позже — тот же kind.
  assert.equal(lessonMoment(utc('2026-11-25T11:21:00.000Z'), DATE, START, END).kind, 'AFTER');
  assert.equal(lessonMoment(utc('2026-11-27T00:00:00.000Z'), DATE, START, END).kind, 'AFTER');
});

test('lessonMoment: метка «когда» не зависит от часового пояса хоста', () => {
  // Дата и время пары — UTC-поля: один и тот же момент, записанный разными
  // смещениями, даёт один и тот же ответ. Если бы функция читала время
  // локальными геттерами, эти два прогона разошлись бы.
  const asUtc = utc('2026-11-25T09:00:00.000Z');
  const asPlusThree = new Date('2026-11-25T12:00:00.000+03:00');
  const asMinusFive = new Date('2026-11-25T04:00:00.000-05:00');
  assert.equal(asUtc.getTime(), asPlusThree.getTime());
  assert.equal(asUtc.getTime(), asMinusFive.getTime());

  for (const now of [asUtc, asPlusThree, asMinusFive]) {
    assert.deepEqual(lessonMoment(now, DATE, START, END), { kind: 'BEFORE', label: 'Через 1 ч' });
  }

  // «Сейчас» — только когда абсолютный момент внутри [начало, конец):
  // полночь UTC той же даты пары не «сейчас» ни в одном поясе.
  assert.equal(lessonMoment(utc('2026-11-25T00:00:00.000Z'), DATE, START, END).kind, 'BEFORE');
  assert.equal(lessonMoment(utc('2026-11-25T23:00:00.000Z'), DATE, START, END).kind, 'AFTER');
});
