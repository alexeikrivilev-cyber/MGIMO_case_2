/**
 * CSS-стаб для node-тестов: экраны кабинета импортируют CSS-модули
 * (academic.module.css, workspace.module.css, access.module.css) — Node
 * не умеет загружать .css и падает с ERR_UNKNOWN_FILE_EXTENSION, роняя
 * все тесты, которые рендерят эти экраны (pages/staff-pages/teacher-routes).
 *
 * Регистрируем синхронные resolve/load-хуки: любой .css резолвится в
 * служебный CSS-модуль и отдаёт пустой объект классов. В продакшене
 * CSS грузит Next.js — стаб нужен только тестовому раннеру.
 *
 * Подключение: node --import tsx --import ./test/css-stub.mjs --test ...
 */
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const STUB_URL = 'udgu-css-stub:';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, { get: (_, key) => (typeof key === "string" ? key : undefined) });',
      };
    }
    return nextLoad(url, context);
  },
});

// Молчаливо игнорируем повторную регистрацию (node --import может
// применить файл дважды при ретрансформации).
void fileURLToPath;
