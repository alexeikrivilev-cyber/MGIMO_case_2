/**
 * Сторож однородности отклика (волна 3 «оживления», docs/design/ui-alive-wave-3.html).
 *
 * ЗАЧЕМ: волна 1 дала press-отклик (PRESS_FEEDBACK), но он лёг только на
 * <Button>, SegmentedLinks и WeekArrow. Нижняя навигация, чипы ассистентов,
 * вкладки каналов, переключатель темы и плитки-ссылки остались с голым
 * `transition-colors` — часть интерфейса «живая», часть мёртвая. Пользователь
 * не может назвать причину, но чувствует неравномерность.
 *
 * ПОЧЕМУ СТОРОЖ ПО ИСХОДНИКАМ, А НЕ ПО РЕНДЕРУ: покрыть все интерактивные
 * элементы рендером невозможно — часть из них живёт в клиентских островах и
 * за гейтами ролей. Страж по тексту ловит КЛАСС, а не отдельные сайты: любая
 * новая кнопка с transition-colors и без отклика роняет прогон сразу.
 *
 * ПРАВИЛО: в разметке кабинета не остаётся `transition-colors` — везде, где
 * есть переход по цвету, есть и отклик на нажатие (PRESS_FEEDBACK перечисляет
 * transform+background+border+color, поэтому замена полная, а не дополнение).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Все .tsx исходники приложения (без тестов, сборки и сгенерированного). */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, found);
    } else if (entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/** Строки className с transition-colors, но без отклика на нажатие. */
function deadTransitions(files: readonly string[]): readonly string[] {
  const dead: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('transition-colors')) {
        return;
      }
      // Строка сама по себе может быть продолжением className: отклик мог
      // оказаться на соседней строке того же атрибута. Смотрим вперёд до
      // закрывающей кавычки/бэктика атрибута.
      const context = lines.slice(index, index + 4).join(' ');
      if (!context.includes('PRESS_FEEDBACK')) {
        dead.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return dead;
}

test('однородность отклика: ни одной кнопки с transition-colors и без press-отклика', () => {
  const files = sources(WEB_DIR).filter((file) => !file.includes('/test/'));
  assert.ok(files.length > 30, `исходники приложения найдены (${files.length})`);

  const dead = deadTransitions(files);
  assert.deepEqual(
    dead,
    [],
    `интерактивные элементы без отклика на нажатие (волна 3):\n${dead.join('\n')}`,
  );
});

test('однородность отклика: все четыре оболочки навигации дают отклик', () => {
  const shells = ['CabinetShell', 'StaffShell', 'TeacherShell', 'MessagesShell'];
  const files = sources(WEB_DIR);
  for (const shell of shells) {
    const file = files.find((candidate) => candidate.endsWith(`${shell}.tsx`));
    assert.ok(file !== undefined, `оболочка ${shell} найдена`);
    const text = readFileSync(file as string, 'utf8');
    assert.match(text, /PRESS_FEEDBACK/, `${shell}: пункты навигации несут отклик`);
    assert.match(text, /nav-indicator/, `${shell}: активный пункт несёт индикатор раздела`);
  }
});
