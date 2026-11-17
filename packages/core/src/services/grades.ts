/**
 * Успеваемость студента: оценки/зачёты по дисциплинам, сводка «как у
 * меня дела» и расчёт «левериджа» до целевого среднего балла.
 *
 * Гейт верификации (BRIEF v2): успеваемость доступна ТОЛЬКО после
 * верификации студбилета. До верификации функции бросают
 * VerificationRequiredError — проверка на сервере, не только в UI.
 *
 * Все функции принимают сессию и резолвят studentId сами; средний балл
 * считается только по экзаменам и курсовым со значением (зачёты дают
 * «зачтено/не зачтено» и в балл не входят).
 */
import { prisma } from '../db';
import { requireStudent } from '../ownership';
import { ValidationError } from '../errors';
import type { AuthSession } from '../session';
import { requireVerifiedStudent } from './verification';
import type { GradeType } from '@udgu/db';

/** Метки типов оценок (статус дублируется текстом, не только цветом). */
export const GRADE_TYPE_LABELS: Readonly<Record<GradeType, string>> = {
  EXAM: 'Экзамен',
  CREDIT: 'Зачёт',
  COURSEWORK: 'Курсовая работа',
};

/** Типы работ, которые входят в средний балл (имеют численное значение). */
const GRADED_TYPES: readonly GradeType[] = ['EXAM', 'COURSEWORK'];

/** Минимум и максимум оценок по 5-балльной шкале УдГУ. */
const MIN_GRADE = 2;
const MAX_GRADE = 5;

export interface MyGradeEntry {
  readonly id: string;
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly type: GradeType;
  readonly typeLabel: string;
  readonly value: number | null;
  readonly passed: boolean | null;
  readonly date: Date;
  readonly semester: number;
}

export interface MyGradesBySemester {
  readonly semester: number;
  readonly entries: readonly MyGradeEntry[];
}

export interface MyGradesResult {
  readonly semesters: readonly MyGradesBySemester[];
}

/** Оценки и зачёты по дисциплинам, сгруппированные по семестрам (сначала новые). */
export async function getMyGrades(session: AuthSession, semester?: number): Promise<MyGradesResult> {
  await requireVerifiedStudent(session);
  const { studentId } = requireStudent(session);

  const grades = await prisma().grade.findMany({
    where: { studentId, ...(semester === undefined ? {} : { semester }) },
    include: { subject: { select: { name: true, code: true } } },
    orderBy: [{ date: 'desc' }],
  });

  const bySemester = new Map<number, MyGradeEntry[]>();
  for (const grade of grades) {
    const entry: MyGradeEntry = {
      id: grade.id,
      subjectName: grade.subject.name,
      subjectCode: grade.subject.code,
      type: grade.type,
      typeLabel: GRADE_TYPE_LABELS[grade.type],
      value: grade.value,
      passed: grade.passed,
      date: grade.date,
      semester: grade.semester,
    };
    const list = bySemester.get(grade.semester) ?? [];
    list.push(entry);
    bySemester.set(grade.semester, list);
  }

  const semesters = [...bySemester.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([semesterNumber, entries]) => ({ semester: semesterNumber, entries }));

  return { semesters };
}

export type TrendDirection = 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';

export interface AcademicTrend {
  readonly direction: TrendDirection;
  readonly lastSemester: number | null;
  readonly previousSemester: number | null;
  readonly lastSemesterAverage: number | null;
  readonly previousSemesterAverage: number | null;
  /** Разница среднего последнего семестра с предыдущим (округление 2 знака). */
  readonly delta: number | null;
}

export interface AcademicDebt {
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly semester: number;
}

export interface ImprovementHint {
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly semester: number;
  readonly value: number | null;
  readonly reason: 'LOW_GRADE' | 'DEBT';
}

/** Сводка «как у меня дела»: средний балл, долги, тренд, что подтянуть. */
export interface AcademicSummary {
  readonly averageScore: number | null;
  readonly gradedCount: number;
  readonly debts: readonly AcademicDebt[];
  readonly trend: AcademicTrend;
  readonly toImprove: readonly ImprovementHint[];
}

export async function getMyAcademicSummary(session: AuthSession): Promise<AcademicSummary> {
  await requireVerifiedStudent(session);
  const { studentId } = requireStudent(session);

  const grades = await prisma().grade.findMany({
    where: { studentId },
    include: { subject: { select: { name: true, code: true } } },
  });

  const graded = grades.filter(
    (grade) => GRADED_TYPES.includes(grade.type) && grade.value !== null,
  );
  const averageScore =
    graded.length === 0
      ? null
      : round2(graded.reduce((sum, grade) => sum + (grade.value ?? 0), 0) / graded.length);

  const debts: AcademicDebt[] = grades
    .filter((grade) => grade.type === 'CREDIT' && grade.passed === false)
    .map((grade) => ({
      subjectName: grade.subject.name,
      subjectCode: grade.subject.code,
      semester: grade.semester,
    }))
    .sort(
      (left, right) =>
        left.semester - right.semester ||
        left.subjectName.localeCompare(right.subjectName, 'ru'),
    );

  const semesters = [...new Set(graded.map((grade) => grade.semester))].sort((a, b) => a - b);
  const lastSemester = semesters.at(-1) ?? null;
  const previousSemester = semesters.length >= 2 ? (semesters.at(-2) ?? null) : null;

  const lastSemesterAverage = averageOfSemester(graded, lastSemester);
  const previousSemesterAverage = averageOfSemester(graded, previousSemester);

  let direction: TrendDirection = 'UNKNOWN';
  if (lastSemesterAverage !== null && previousSemesterAverage !== null) {
    if (lastSemesterAverage > previousSemesterAverage) {
      direction = 'UP';
    } else if (lastSemesterAverage < previousSemesterAverage) {
      direction = 'DOWN';
    } else {
      direction = 'STABLE';
    }
  }

  const trend: AcademicTrend = {
    direction,
    lastSemester,
    previousSemester,
    lastSemesterAverage,
    previousSemesterAverage,
    delta:
      lastSemesterAverage !== null && previousSemesterAverage !== null
        ? round2(lastSemesterAverage - previousSemesterAverage)
        : null,
  };

  // Порядок: семестр → сначала долги (срочнее), затем низкие оценки,
  // внутри группы — по алфавиту. Детерминированно, без опоры на порядок БД.
  const debtRank = (reason: 'DEBT' | 'LOW_GRADE'): number => (reason === 'DEBT' ? 0 : 1);
  const toImprove: ImprovementHint[] = grades
    .filter((grade) => {
      if (grade.type === 'CREDIT') {
        return grade.passed === false;
      }
      return grade.value !== null && grade.value <= 3;
    })
    .map((grade) => ({
      subjectName: grade.subject.name,
      subjectCode: grade.subject.code,
      semester: grade.semester,
      value: grade.value,
      reason: grade.type === 'CREDIT' && grade.passed === false ? ('DEBT' as const) : ('LOW_GRADE' as const),
    }))
    .sort(
      (left, right) =>
        left.semester - right.semester ||
        debtRank(left.reason) - debtRank(right.reason) ||
        left.subjectName.localeCompare(right.subjectName, 'ru'),
    );

  return { averageScore, gradedCount: graded.length, debts, trend, toImprove };
}

function averageOfSemester(
  graded: readonly { value: number | null; semester: number }[],
  semester: number | null,
): number | null {
  if (semester === null) {
    return null;
  }
  const values = graded
    .filter((grade) => grade.semester === semester && grade.value !== null)
    .map((grade) => grade.value ?? 0);
  if (values.length === 0) {
    return null;
  }
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// «Леверидж» до целевого среднего балла (решение Council; честная арифметика)
// ---------------------------------------------------------------------------

/**
 * Работа студента: оценённая (value заполнен — входит в средний балл)
 * или предстоящая (value === null — ещё не сдана). Оценка «зачтено»
 * (passed) в средний балл не входит и сюда не передаётся.
 */
export interface LeverageWork {
  readonly value: number | null;
}

export interface LeverageResult {
  readonly targetGpa: number;
  /** Оценённых работ (участвуют в текущем среднем). */
  readonly gradedCount: number;
  /** Предстоящих работ (по ним считаем требование). */
  readonly pendingCount: number;
  readonly currentAverage: number | null;
  /** Сумма баллов, которую нужно набрать на предстоящих работах. */
  readonly neededSumOnPending: number | null;
  /** Средний балл предстоящих работ, необходимый для цели. */
  readonly neededAverageOnPending: number | null;
  /** Максимально достижимый средний балл (если всё сдавать на 5). */
  readonly maxPossibleAverage: number | null;
  /** Достижима ли цель при максимальном исходе. */
  readonly achievable: boolean;
  /** Цель уже достигнута текущими оценками. */
  readonly alreadyAchieved: boolean;
}

/**
 * Считает, сколько баллов нужно на оставшихся работах до целевого
 * среднего балла. Чистая арифметика без LLM и без обращений к БД:
 * список работ формирует вызывающий код (в тестах — вручную).
 *
 * Формула: neededSum = target * (graded + pending) - currentSum.
 * Цель достижима, если neededAverage <= 5.
 */
export function calculateLeverage(
  works: readonly LeverageWork[],
  targetGpa: number,
): LeverageResult {
  if (!Number.isFinite(targetGpa) || targetGpa < MIN_GRADE || targetGpa > MAX_GRADE) {
    throw new ValidationError(
      'INVALID_INPUT',
      `Целевой средний балл должен быть в диапазоне ${MIN_GRADE}-${MAX_GRADE}.`,
    );
  }
  if (!Array.isArray(works)) {
    throw new ValidationError('INVALID_INPUT', 'Список работ должен быть массивом.');
  }

  const gradedValues: number[] = [];
  let pendingCount = 0;
  for (const work of works) {
    if (work === null || typeof work !== 'object') {
      throw new ValidationError('INVALID_INPUT', 'Некорректная запись работы.');
    }
    if (work.value === null) {
      pendingCount += 1;
      continue;
    }
    if (!Number.isInteger(work.value) || work.value < MIN_GRADE || work.value > MAX_GRADE) {
      throw new ValidationError(
        'INVALID_INPUT',
        `Оценка должна быть целым числом ${MIN_GRADE}-${MAX_GRADE}.`,
      );
    }
    gradedValues.push(work.value);
  }

  const gradedCount = gradedValues.length;
  const totalCount = gradedCount + pendingCount;
  const currentSum = gradedValues.reduce((sum, value) => sum + value, 0);
  const currentAverage = gradedCount === 0 ? null : round2(currentSum / gradedCount);
  const maxPossibleAverage =
    totalCount === 0 ? null : round2((currentSum + MAX_GRADE * pendingCount) / totalCount);

  if (totalCount === 0) {
    return {
      targetGpa,
      gradedCount: 0,
      pendingCount: 0,
      currentAverage: null,
      neededSumOnPending: null,
      neededAverageOnPending: null,
      maxPossibleAverage: null,
      achievable: false,
      alreadyAchieved: false,
    };
  }

  const alreadyAchieved = currentAverage !== null && currentAverage >= targetGpa;

  if (pendingCount === 0) {
    return {
      targetGpa,
      gradedCount,
      pendingCount: 0,
      currentAverage,
      neededSumOnPending: null,
      neededAverageOnPending: null,
      maxPossibleAverage: currentAverage,
      achievable: alreadyAchieved,
      alreadyAchieved,
    };
  }

  const neededSumOnPending = round2(targetGpa * totalCount - currentSum);
  const neededAverageOnPending = round2(neededSumOnPending / pendingCount);
  // Достижимость считаем по неокругленной сумме, чтобы граничный случай
  // (neededSum ровно 5*pending) не превращался в «недостижимо».
  const achievable = targetGpa * totalCount - currentSum <= MAX_GRADE * pendingCount;

  return {
    targetGpa,
    gradedCount,
    pendingCount,
    currentAverage,
    neededSumOnPending,
    neededAverageOnPending,
    maxPossibleAverage,
    achievable,
    alreadyAchieved,
  };
}
