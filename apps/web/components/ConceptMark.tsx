/**
 * Знак концепта — собственный идентификатор прототипа «Цифровой деканат».
 *
 * Требование кейса: логотип вуза НЕ используется. Знак нарисован с нуля
 * и перекликается с идеей кабинета: «страница-расписание с галочкой
 * контроля» — сетка строк (пары) и отметка «всё учтено». Одна форма,
 * currentColor, без внешних ассетов и без растровой графики.
 */
export function ConceptMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Знак концепта «Цифровой деканат»"
      className={className}
      fill="none"
    >
      <rect x="2.5" y="2.5" width="27" height="27" rx="8" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
      <path d="M9 11.5h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M9 17h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18.5 19.5l3.5 3.5 6.5-7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
