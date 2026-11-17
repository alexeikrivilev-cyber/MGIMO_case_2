'use client';

/**
 * «Леверидж» до целевого среднего балла (решение Council, PRD §8).
 *
 * Студент двигает ползунок цели (3.0–5.0) — сколько баллов нужно
 * набрать на оставшихся работах. Расчёт делает сервер
 * (POST /api/grades/leverage → calculateLeverage в packages/core):
 * формула не дублируется на клиенте, клиент только показывает числа и
 * сам вид формулы.
 */
import { useEffect, useState } from 'react';
import { ApiClientError, api, type LeverageResultPayload } from '../../../lib/api-client';
import { Card, ErrorState, Skeleton } from '../../../components/ui';
import { formatScore } from '../../../components/format';

/** Целевой балл по умолчанию: чуть выше текущего среднего. */
function defaultTarget(currentAverage: number | null): number {
  if (currentAverage === null) {
    return 4;
  }
  return Math.min(5, Math.round((currentAverage + 0.15) * 10) / 10);
}

/** Русская запятая в числах интерфейса. */
function num(value: number | null): string {
  return formatScore(value);
}

export function LeveragePanel({
  currentAverage,
  gradedCount,
  pendingCount,
}: {
  currentAverage: number | null;
  gradedCount: number;
  pendingCount: number;
}): React.JSX.Element {
  const [target, setTarget] = useState<number>(() => defaultTarget(currentAverage));
  const [result, setResult] = useState<LeverageResultPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Небольшая задержка: ползунок двигается непрерывно, а считать нужно
    // только итоговое значение.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const payload = await api.getLeverage(target);
          if (!alive) return;
          setResult(payload.result);
          setError(null);
        } catch (requestError) {
          if (!alive) return;
          setError(
            requestError instanceof ApiClientError
              ? requestError.message
              : 'Не удалось посчитать. Попробуйте ещё раз.',
          );
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target]);

  const total = result === null ? gradedCount + pendingCount : result.gradedCount + result.pendingCount;
  // Текущая сумма выводится из ответа сервера: neededSum = цель × всего − сумма.
  const currentSum =
    result !== null && result.neededSumOnPending !== null
      ? Math.round((result.targetGpa * total - result.neededSumOnPending) * 100) / 100
      : null;

  return (
    <Card>
      <h3 className="text-base font-semibold text-text">Леверидж: сколько нужно до цели</h3>
      <p className="mt-1 text-sm text-text-muted">
        Ползунок — целевой средний балл. Расчёт по вашим оценкам.
      </p>

      <div className="mt-4">
        <label htmlFor="leverage-target" className="block text-sm font-medium text-text">
          Целевой средний балл: <span className="tabular-nums">{num(target)}</span>
        </label>
        <input
          id="leverage-target"
          type="range"
          min={3}
          max={5}
          step={0.1}
          value={target}
          onChange={(event) => setTarget(Number(event.target.value))}
          aria-valuetext={`${num(target)} из 5`}
          className="mt-2 h-11 w-full accent-[var(--udgu-color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <div className="flex justify-between text-xs text-text-muted">
          <span>3,0</span>
          <span>5,0</span>
        </div>
      </div>

      <div aria-live="polite" role="status" className="mt-4">
        {loading === true ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" label="Считаем требующие баллы…" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error !== null ? (
          <ErrorState message={error} />
        ) : result === null ? null : (
          <div className="space-y-2 text-sm">
            <p className="text-text-muted">
              Оценённых работ: <span className="font-medium text-text">{result.gradedCount}</span> · предстоящих:{' '}
              <span className="font-medium text-text">{result.pendingCount}</span> · текущий средний:{' '}
              <span className="font-medium text-text">{num(result.currentAverage)}</span>
            </p>

            {result.currentAverage === null ? (
              <p className="text-text-muted">Оценок пока нет.</p>
            ) : result.pendingCount === 0 ? (
              <p className="text-text-muted">
                Все работы оценены.{' '}
                {result.alreadyAchieved
                  ? `Цель ${num(result.targetGpa)} уже достигнута.`
                  : `Цель ${num(result.targetGpa)} текущими оценками не достигается.`}
              </p>
            ) : result.alreadyAchieved === true ? (
              <p className="font-medium text-success">
                Цель {num(result.targetGpa)} уже достигнута текущими оценками — держите темп.
              </p>
            ) : result.achievable === false ? (
              <>
                <p className="font-medium text-danger">
                  Цель недостижима: даже если все предстоящие работы сдать на 5, средний балл будет{' '}
                  {num(result.maxPossibleAverage)}.
                </p>
                <p className="text-text-muted">Понизьте цель или закройте долги пересдачами.</p>
              </>
            ) : (
              <p className="font-medium text-text">
                Нужно набрать <span className="tabular-nums">{num(result.neededSumOnPending)}</span> баллов на
                предстоящих работах — в среднем{' '}
                <span className="tabular-nums">{num(result.neededAverageOnPending)}</span> за работу.
              </p>
            )}

            {result.neededSumOnPending === null ? null : (
              <details className="mt-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <summary className="min-h-11 cursor-pointer py-2 text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  Как посчитано
                </summary>
                <p className="pb-1 text-xs text-text-muted">
                  Формула: цель × (оценённых + предстоящих) − текущая сумма = {num(result.targetGpa)} × (
                  {result.gradedCount} + {result.pendingCount}) − {num(currentSum)} ={' '}
                  <span className="tabular-nums">{num(result.neededSumOnPending)}</span>. Максимально
                  возможный средний балл: {num(result.maxPossibleAverage)}.
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
