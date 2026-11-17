'use client';

/**
 * Регистрация service worker (PWA-оффлайн-оболочка).
 *
 * Компонент живёт в корневом лэйауте и не рисует ничего. Правила:
 * - регистрируем ТОЛЬКО в production: в dev-режиме свой сервер отдаёт
 *   каждый чанк заново, и service worker лишь мешает (кривой HMR-поток,
 *   закешированная старая разметка вместо новой);
 * - регистрируем после события load, чтобы не конкурировать за сеть
 *   с первой отрисовкой страницы (LCP на 360 px — метрика кейса);
 * - любые ошибки регистрации молча игнорируются: PWA — улучшение,
 *   кабинет обязан работать и без него.
 */
import { useEffect } from 'react';

export function ServiceWorkerRegister(): React.JSX.Element | null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    function register(): void {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Оффлайн-оболочка недоступна — интерфейс работает как обычно.
      });
    }

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
