/**
 * Экран «Успеваемость» (за гейтом верификации).
 *
 * Состав (требование ядра + решения Council):
 * - переключатель семестров (серверные ссылки);
 * - оценки и зачёты по дисциплинам: оценка числом, зачёт — «зачтено /
 *   не зачтено» (иконка + слово + цвет, не только цвет);
 * - сводка «Как у меня дела»: средний балл, долги, тренд («на 0,08 выше
 *   прошлого семестра»), «что подтянуть»;
 * - блок «Леверидж»: ползунок целевого балла → расчёт на сервере.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, SegmentedLinks, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult, SectionTitle } from '../../../components/PageStates';
import { formatDate, formatDelta, formatScore } from '../../../components/format';
import { IconArrowDown, IconArrowUp, IconMinus } from '../../../components/icons';
import { loadGradesPageData, type LoadResult, type GradesPageData } from '../../../lib/page-data';
import type { MyGradeEntry } from '@udgu/core';
import { LeveragePanel } from './LeveragePanel';
import { TEXT_LINK_CLASS } from '../../../lib/ui';

/** Оценка/зачёт: форма + текст + цвет (никогда только цвет). */
function GradeValue({ entry }: { entry: MyGradeEntry }): React.JSX.Element {
  if (entry.type === 'CREDIT') {
    return entry.passed === true ? (
      <StatusBadge tone="success">
        <span aria-hidden="true" className="mr-1">✓</span>
        Зачтено
      </StatusBadge>
    ) : (
      <StatusBadge tone="danger">
        <span aria-hidden="true" className="mr-1">✗</span>
        Не зачтено
      </StatusBadge>
    );
  }
  if (entry.value === null) {
    return <StatusBadge tone="neutral">Оценки ещё нет</StatusBadge>;
  }
  return <span className="text-sm font-semibold tabular-nums text-text">{entry.value}</span>;
}

/** Строка дисциплины в семестре. */
function GradeRow({ entry }: { entry: MyGradeEntry }): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">{entry.subjectName}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          {entry.typeLabel} · {formatDate(entry.date)}
        </p>
      </div>
      <GradeValue entry={entry} />
    </li>
  );
}

function SummaryCard({ data }: { data: GradesPageData }): React.JSX.Element {
  const { summary } = data;
  const { trend } = summary;

  const trendText =
    trend.direction === 'UP'
      ? `на ${formatDelta(trend.delta)} выше прошлого семестра`
      : trend.direction === 'DOWN'
        ? `на ${formatDelta(trend.delta)} ниже прошлого семестра`
        : trend.direction === 'STABLE'
          ? 'на уровне прошлого семестра'
          : 'недостаточно данных: нужны оценки минимум за два семестра';

  const TrendIcon =
    trend.direction === 'UP' ? IconArrowUp : trend.direction === 'DOWN' ? IconArrowDown : IconMinus;
  const trendTone =
    trend.direction === 'UP' ? 'success' : trend.direction === 'DOWN' ? 'danger' : 'neutral';

  return (
    <Card className="mb-4" data-testid="grades-summary">
      <h2 className="text-base font-semibold text-text">Как у меня дела</h2>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-2 p-3">
          <p className="text-xs text-text-muted">Средний балл</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text" data-testid="average-score">
            {formatScore(summary.averageScore)}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">по {summary.gradedCount} оцененным работам</p>
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <p className="text-xs text-text-muted">Тренд</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-text">
            <span className={trendTone === 'success' ? 'text-success' : trendTone === 'danger' ? 'text-danger' : 'text-text-muted'}>
              <TrendIcon />
            </span>
            <span className="min-w-0">{trendText}</span>
          </p>
          {trend.lastSemesterAverage !== null && trend.lastSemester !== null ? (
            <p className="mt-0.5 text-xs text-text-muted">
              {trend.lastSemester} семестр: {formatScore(trend.lastSemesterAverage)}
              {trend.previousSemesterAverage !== null && trend.previousSemester !== null
                ? ` · ${trend.previousSemester} семестр: ${formatScore(trend.previousSemesterAverage)}`
                : ''}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-medium text-text">Долги</h3>
        {summary.debts.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">Долгов нет — все зачёты закрыты.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {summary.debts.map((debt) => (
              <li key={`${debt.subjectCode}-${debt.semester}`} className="text-sm text-text">
                {debt.subjectName} <span className="text-text-muted">· {debt.semester} семестр</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-medium text-text">Что подтянуть</h3>
        {summary.toImprove.length === 0 ? (
          <p className="mt-1 text-sm text-text-muted">Слабых мест не видно — так держать.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {summary.toImprove.map((hint) => (
              <li key={`${hint.subjectCode}-${hint.semester}-${hint.reason}`} className="text-sm text-text">
                {hint.subjectName}{' '}
                <span className="text-text-muted">
                  · {hint.reason === 'DEBT' ? 'незачёт' : `оценка ${hint.value ?? '—'}`} · {hint.semester} семестр
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function GradesView({ result }: { result: LoadResult<GradesPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const semesterItems = [
          { href: '/grades', label: 'Все', active: data.semester === null },
          ...data.availableSemesters.map((semester) => ({
            href: `/grades?semester=${semester}`,
            label: String(semester),
            active: data.semester === semester,
          })),
        ];

        return (
          <>
            <PageHeader title="Успеваемость" subtitle={`${data.profile.groupName} · ${data.profile.course} курс`} />

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SegmentedLinks label="Семестр" items={semesterItems} />
            </div>

            <SummaryCard data={data} />

            <LeveragePanel
              currentAverage={data.summary.averageScore}
              gradedCount={data.summary.gradedCount}
              pendingCount={data.pendingWorksCount}
            />

            <section className="mt-6" aria-labelledby="grades-list">
              <SectionTitle>
                <span id="grades-list">
                  {data.semester === null ? 'Оценки и зачёты по семестрам' : `${data.semester} семестр`}
                </span>
              </SectionTitle>

              {data.grades.semesters.length === 0 ? (
                <EmptyState
                  title="Оценок пока нет"
                  description="За этот семестр оценок и зачётов нет. Они появятся здесь после первых экзаменов и зачётов."
                />
              ) : (
                <div className="space-y-4">
                  {data.grades.semesters.map((semesterGroup) => (
                    <Card key={semesterGroup.semester}>
                      <h3 className="mb-1 text-sm font-semibold text-text">
                        {semesterGroup.semester} семестр
                      </h3>
                      <ul>
                        {semesterGroup.entries.map((entry) => (
                          <GradeRow key={entry.id} entry={entry} />
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <Card className="mt-4">
              <p className="text-sm text-text-muted">
                Нужна справка об успеваемости?{' '}
                <Link href="/requests" className={TEXT_LINK_CLASS}>
                  Оформить заявку
                </Link>
              </p>
            </Card>
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: query → данные → вид. */
export async function GradesScreen({ semester }: { semester: string | undefined }): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadGradesPageData(cookieStore.toString(), semester);
  return <GradesView result={result} />;
}
