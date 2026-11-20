/**
 * Динамика среднего балла по семестрам — диаграмма волны 1
 * «оживления интерфейса» (docs/design/ui-alive-wave-1.html, раздел 5).
 *
 * Почему столбцы, а не линия: 2–4 точки с подписями чисел и семестров
 * читаются на 360 px лучше, а линия без точек выглядела бы «загадкой».
 * Ось без тиков — только baseline: минимум чернил. Прошлые семестры —
 * приглушённый primary, последний — полный: новость ведёт глаз.
 *
 * Диаграмма — чистый серверный SVG: никакого JS, тултипов и библиотек.
 * Рост столбцов снизу вверх (scaleY 0→1) делает CSS (класс .bar и
 * keyframes udgu-bar-rise в globals.css) и только при
 * prefers-reduced-motion: no-preference; задержка 60ms на столбец —
 * инлайновый animation-delay. Все числа дублируются в aria-label,
 * поэтому скринридеру не нужен текст под графиком.
 *
 * Меньше двух точек не рендерим: динамика сравнимая только от двух.
 */
import { formatScore } from './format';

/** Точка серии: семестр и его средний балл (из AcademicTrend ядра). */
export interface TrendPoint {
  readonly semester: number;
  readonly average: number;
}

/** Геометрия шкалы (артефакт §5): baseline y=130, вершина (5.0) y=10. */
const BASELINE_Y = 130;
const TOP_Y = 10;
/** Полосы столбцов: отступ 24, полезная ширина 288 при viewBox 320. */
const BAND_LEFT = 24;
const BAND_WIDTH = 288;
const BAR_WIDTH = 40;

export function TrendChart({ points }: { points: readonly TrendPoint[] }): React.JSX.Element | null {
  if (points.length < 2) {
    return null;
  }

  const band = BAND_WIDTH / points.length;
  const label = `Средний балл по семестрам: ${points
    .map((point) => `${point.semester} семестр — ${formatScore(point.average)}`)
    .join('; ')}`;

  return (
    <svg viewBox="0 0 320 150" width="100%" role="img" aria-label={label} className="block">
      <line x1="16" y1={BASELINE_Y} x2="312" y2={BASELINE_Y} strokeWidth="1" className="stroke-border" />
      {points.map((point, index) => {
        // Шкала 2..5: средний 2 стоит на baseline, 5 — на вершине.
        // Кламп защищает от выхода за шкалу при оценке вне 2..5.
        const rawTop = BASELINE_Y - ((point.average - 2) / 3) * (BASELINE_Y - TOP_Y);
        const top = Math.min(Math.max(rawTop, TOP_Y), BASELINE_Y);
        const centerX = BAND_LEFT + (index + 0.5) * band;
        const isLast = index === points.length - 1;

        return (
          <g key={point.semester}>
            <rect
              className={isLast ? 'bar fill-primary' : 'bar fill-primary/45'}
              x={centerX - BAR_WIDTH / 2}
              y={top}
              width={BAR_WIDTH}
              height={BASELINE_Y - top}
              rx="4"
              style={{ animationDelay: `${index * 60}ms` }}
            />
            {/* Подпись значения: при балле 5.0 столбец упирается в вершину
                шкалы (y=10) — подпись не поднимается выше y=10, иначе её
                срезает viewBox. */}
            <text x={centerX} y={Math.max(top - 6, 10)} textAnchor="middle" fontSize="12" className="fill-text tabular-nums">
              {formatScore(point.average)}
            </text>
            <text x={centerX} y="146" textAnchor="middle" fontSize="10" className="fill-text-muted">
              {point.semester} сем
            </text>
          </g>
        );
      })}
    </svg>
  );
}
