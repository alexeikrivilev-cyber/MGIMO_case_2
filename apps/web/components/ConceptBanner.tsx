/**
 * Баннер концепта: «Учебный концепт для конкурса. Не официальный сервис УдГУ».
 *
 * Требование BRIEF/ACCEPTANCE (проверяет PO): баннер ОБЯЗАТЕЛЕН и должен
 * быть постоянно на виду — поэтому он живёт в корневых лэйаутах route
 * groups ((auth) и (cabinet)), а не на отдельных экранах. Компактный:
 * одна строка во всю ширину, предупреждающий тон (warning-токены).
 */
export function ConceptBanner(): React.JSX.Element {
  return (
    <p
      role="note"
      className="border-b border-warning/30 bg-warning-soft px-3 py-1.5 text-center text-xs font-medium text-warning"
    >
      Учебный концепт для конкурса. Не официальный сервис УдГУ.
    </p>
  );
}
