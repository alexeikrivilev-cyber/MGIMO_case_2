'use client';

/**
 * Переключатель темы: светлая/тёмная. Тёмная — по умолчанию (решение
 * Council, docs/PRD.md §8): класс .dark стоит на <html> из корневого
 * лэйаута, а этот переключатель меняет класс и запоминает выбор в cookie
 * udgu_theme — чтобы при следующей отрисовке на сервере тема уже была
 * нужной (без вспышки светлой темы). Cookie — предпочтение интерфейса,
 * не секрет авторизации; в браузере токенов сессии нет и не нужно.
 */
import { useEffect, useState } from 'react';
import { THEME_COOKIE_NAME, type Theme } from '../lib/theme';
import { IconTheme } from './icons';

function currentTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'dark';
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax${secure}`;
}

export function ThemeToggle(): React.JSX.Element {
  // Начальное значение берём из DOM: сервер уже поставил класс по cookie,
  // локальное состояние только отражает, что сейчас на экране.
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        const value: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(value);
        setTheme(value);
      }}
      aria-label={mounted ? `Включить ${nextTheme === 'dark' ? 'тёмную' : 'светлую'} тему` : 'Переключить тему'}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <IconTheme />
    </button>
  );
}
