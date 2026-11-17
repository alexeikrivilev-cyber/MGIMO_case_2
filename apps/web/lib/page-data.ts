/**
 * Серверные загрузчики данных страниц кабинета (apps/web).
 *
 * Зачем этот модуль: страницы кабинета рендерятся на сервере (SSR), и
 * данные берутся из ТЕХ ЖЕ сервисов packages/core, что и маршруты
 * /api/* — единая реализация, второго варианта логики нет. Браузерный
 * код (формы, мутации, «леверидж») работает только через /api/* и
 * lib/api-client.ts; здесь же — серверный путь «cookie → сессия →
 * сервис → данные страницы».
 *
 * Безопасность та же, что в API: загрузчик принимает ТОЛЬКО заголовок
 * cookie, сессия резолвится боевым validateSession, владение данными
 * проверяют сервисы core (studentId снаружи не принимается). Ошибки
 * возвращаются как LoadResult, а не бросаются: страница рисует понятное
 * состояние вместо падения.
 *
 * Функции принимают cookieHeader (а не читают next/headers сами) —
 * поэтому их можно вызывать из тестов с настоящей cookie сессии.
 */
import {
  addUtcDays,
  getAnnouncementsFor,
  getFreeGaps,
  getMyAcademicSummary,
  getMyGrades,
  getMyNextLesson,
  getMyNotifications,
  getMyProfile,
  getMyRequests,
  getMyScheduleToday,
  getMyScheduleWeek,
  getMySickLeaves,
  getMyUnreadCount,
  getTeacherCard,
  getVerificationGate,
  getMyVerification,
  getStaffDashboard,
  isSickNow,
  listMyConversations,
  listStaffAnnouncements,
  listStaffGroups,
  listStaffRequests,
  listStaffSchedule,
  listStaffSickLeaves,
  listStaffVerifications,
  listTeachers,
  getConversation,
  requireStaffScope,
  OwnershipError,
  ValidationError,
  VerificationRequiredError,
  dateKey,
  startOfUtcDay,
  type AcademicSummary,
  type AnnouncementItem,
  type AuthSession,
  type ConversationDetail,
  type ConversationListItem,
  type FreeGap,
  type LessonOccurrence,
  type MyGradesResult,
  type MyNotification,
  type MyProfile,
  type MyRequest,
  type MySickLeave,
  type MyVerification,
  type ScheduleLesson,
  type ScheduleWeek,
  type StaffAnnouncementItem,
  type StaffDashboard,
  type StaffLessonItem,
  type StaffRequestItem,
  type StaffSickLeaveItem,
  type StaffVerificationItem,
  type TeacherCard,
  type TeacherListItem,
  type VerificationGate,
} from '@udgu/core';
import { getSessionFromCookieHeader } from './session';

// ---------------------------------------------------------------------------
// Результат загрузки и ошибки страниц
// ---------------------------------------------------------------------------

export type PageErrorKind =
  | 'unauthenticated'
  | 'verification-required'
  | 'forbidden'
  | 'not-found'
  | 'error';

export interface PageError {
  readonly kind: PageErrorKind;
  readonly message: string;
}

export type LoadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PageError };

function ok<T>(value: T): LoadResult<T> {
  return { ok: true, value };
}

/** Единая таблица «исключение ядра → состояние страницы». */
function toPageError(error: unknown): PageError {
  if (error instanceof VerificationRequiredError) {
    return {
      kind: 'verification-required',
      message: 'Успеваемость открывается после верификации студенческого билета.',
    };
  }
  if (error instanceof OwnershipError) {
    return { kind: 'forbidden', message: 'Раздел недоступен для вашей учётной записи.' };
  }
  if (error instanceof ValidationError) {
    return { kind: 'not-found', message: error.message };
  }
  return {
    kind: 'error',
    message: 'Не удалось загрузить данные. Обновите страницу или попробуйте позже.',
  };
}

/** Оборачивает загрузку: любое падение → состояние ошибки, не исключение. */
async function attempt<T>(load: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return ok(await load());
  } catch (error) {
    return { ok: false, error: toPageError(error) };
  }
}

/** Сессия по cookie: нет сессии → страница должна увести на вход. */
async function requirePageSession(cookieHeader: string): Promise<LoadResult<AuthSession>> {
  const session = await getSessionFromCookieHeader(cookieHeader);
  if (session === null) {
    return {
      ok: false,
      error: { kind: 'unauthenticated', message: 'Сессия истекла. Войдите в кабинет снова.' },
    };
  }
  return ok(session);
}

// ---------------------------------------------------------------------------
// «Сегодня» (дашборд)
// ---------------------------------------------------------------------------

/** Сколько заявок и уведомлений показываем на дашборде. */
const DASHBOARD_REQUESTS_LIMIT = 3;
const DASHBOARD_NOTIFICATIONS_LIMIT = 4;
const DASHBOARD_ANNOUNCEMENTS_LIMIT = 3;

export interface DashboardData {
  readonly profile: MyProfile;
  readonly date: string;
  readonly todayLessons: readonly ScheduleLesson[];
  readonly nextLesson: LessonOccurrence | null;
  readonly freeGaps: readonly FreeGap[];
  /** Заявки, требующие внимания (кроме отклонённых), свежие сверху. */
  readonly activeRequests: readonly MyRequest[];
  readonly unreadCount: number;
  readonly unreadNotifications: readonly MyNotification[];
  readonly announcements: readonly AnnouncementItem[];
  /** Успеваемость закрыта гейтом верификации — на дашборде показываем заглушку. */
  readonly gradesLocked: boolean;
}

export async function loadDashboardData(cookieHeader: string): Promise<LoadResult<DashboardData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const session = sessionResult.value;

  return attempt(async () => {
    const [profile, todayLessons, nextLesson, freeGaps, requests, unreadCount, notifications, announcements, gate] =
      await Promise.all([
        getMyProfile(session),
        getMyScheduleToday(session),
        getMyNextLesson(session),
        getFreeGaps(session),
        getMyRequests(session),
        getMyUnreadCount(session),
        getMyNotifications(session),
        getAnnouncementsFor(session),
        getVerificationGate(session),
      ]);

    return {
      profile,
      date: dateKey(new Date()),
      todayLessons,
      nextLesson,
      freeGaps,
      activeRequests: requests
        .filter((request) => request.status !== 'REJECTED')
        .slice(0, DASHBOARD_REQUESTS_LIMIT),
      unreadCount,
      unreadNotifications: notifications
        .filter((notification) => !notification.read)
        .slice(0, DASHBOARD_NOTIFICATIONS_LIMIT),
      announcements: announcements.slice(0, DASHBOARD_ANNOUNCEMENTS_LIMIT),
      gradesLocked: !gate.verified,
    };
  });
}

// ---------------------------------------------------------------------------
// Расписание
// ---------------------------------------------------------------------------

export type ScheduleViewMode = 'today' | 'week';

export interface SchedulePageData {
  readonly profile: MyProfile;
  readonly view: ScheduleViewMode;
  /** Смещение недели для вида «неделя» (0 — текущая). */
  readonly offset: number;
  readonly date: string;
  readonly todayLessons: readonly ScheduleLesson[];
  readonly nextLesson: LessonOccurrence | null;
  readonly freeGaps: readonly FreeGap[];
  readonly week: ScheduleWeek | null;
}

export async function loadSchedulePageData(
  cookieHeader: string,
  view: string | undefined,
  offset: string | undefined,
): Promise<LoadResult<SchedulePageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const session = sessionResult.value;

  const mode: ScheduleViewMode = view === 'week' ? 'week' : 'today';
  const weekOffset = normalizeOffset(offset);

  return attempt(async () => {
    const profile = await getMyProfile(session);
    if (mode === 'week') {
      const week = await getMyScheduleWeek(session, weekOffset);
      return {
        profile,
        view: mode,
        offset: weekOffset,
        date: dateKey(week.weekStart),
        todayLessons: [],
        nextLesson: null,
        freeGaps: [],
        week,
      };
    }
    const [todayLessons, nextLesson, freeGaps] = await Promise.all([
      getMyScheduleToday(session),
      getMyNextLesson(session),
      getFreeGaps(session),
    ]);
    return {
      profile,
      view: mode,
      offset: 0,
      date: dateKey(new Date()),
      todayLessons,
      nextLesson,
      freeGaps,
      week: null,
    };
  });
}

/** Смещение недели из query: любое некорректное значение → 0 (текущая неделя). */
function normalizeOffset(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < -52 || parsed > 52) {
    return 0;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Успеваемость
// ---------------------------------------------------------------------------

export interface GradesPageData {
  readonly profile: MyProfile;
  readonly grades: MyGradesResult;
  readonly summary: AcademicSummary;
  /** Выбранный семестр (null — все). */
  readonly semester: number | null;
  /** Доступные семестры (сначала новые). */
  readonly availableSemesters: readonly number[];
  /** Предстоящие работы (EXAM/COURSEWORK без оценки) — для «левериджа». */
  readonly pendingWorksCount: number;
}

export async function loadGradesPageData(
  cookieHeader: string,
  semester: string | undefined,
): Promise<LoadResult<GradesPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const session = sessionResult.value;

  const semesterFilter = normalizeSemester(semester);

  return attempt(async () => {
    const [profile, allGrades, summary] = await Promise.all([
      getMyProfile(session),
      // Гейт верификации: getMyGrades бросает VerificationRequiredError,
      // attempt превращает его в состояние «verification-required».
      // Загружаем все семестры сразу: переключатель семестров на
      // странице показывает все доступные, а показ фильтруется ниже
      // (уже загруженные данные, без второго запроса в БД).
      getMyGrades(session),
      getMyAcademicSummary(session),
    ]);

    const visibleSemesters =
      semesterFilter === null
        ? allGrades.semesters
        : allGrades.semesters.filter((entry) => entry.semester === semesterFilter);

    return {
      profile,
      grades: { semesters: visibleSemesters },
      summary,
      semester: semesterFilter,
      availableSemesters: allGrades.semesters.map((entry) => entry.semester),
      pendingWorksCount: allGrades.semesters
        .flatMap((entry) => entry.entries)
        .filter((entry) => entry.type !== 'CREDIT' && entry.value === null).length,
    };
  });
}

/** Номер семестра из query: 1..20 или null (все семестры). */
function normalizeSemester(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    return null;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Заявки
// ---------------------------------------------------------------------------

export interface RequestsPageData {
  readonly requests: readonly MyRequest[];
}

export async function loadRequestsPageData(cookieHeader: string): Promise<LoadResult<RequestsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => ({ requests: await getMyRequests(sessionResult.value) }));
}

// ---------------------------------------------------------------------------
// Уведомления
// ---------------------------------------------------------------------------

export interface NotificationsPageData {
  readonly notifications: readonly MyNotification[];
  readonly unreadCount: number;
}

export async function loadNotificationsPageData(cookieHeader: string): Promise<LoadResult<NotificationsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const [notifications, unreadCount] = await Promise.all([
      getMyNotifications(sessionResult.value),
      getMyUnreadCount(sessionResult.value),
    ]);
    return { notifications, unreadCount };
  });
}

// ---------------------------------------------------------------------------
// Объявления
// ---------------------------------------------------------------------------

export interface AnnouncementsPageData {
  readonly announcements: readonly AnnouncementItem[];
}

export async function loadAnnouncementsPageData(cookieHeader: string): Promise<LoadResult<AnnouncementsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => ({ announcements: await getAnnouncementsFor(sessionResult.value) }));
}

// ---------------------------------------------------------------------------
// Профиль
// ---------------------------------------------------------------------------

export interface ProfilePageData {
  readonly profile: MyProfile;
}

export async function loadProfilePageData(cookieHeader: string): Promise<LoadResult<ProfilePageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => ({ profile: await getMyProfile(sessionResult.value) }));
}

// ---------------------------------------------------------------------------
// Верификация студбилета
// ---------------------------------------------------------------------------

export interface VerificationPageData {
  readonly profile: MyProfile;
  readonly verification: MyVerification | null;
  readonly gate: VerificationGate;
}

export async function loadVerificationPageData(cookieHeader: string): Promise<LoadResult<VerificationPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const [profile, verification, gate] = await Promise.all([
      getMyProfile(sessionResult.value),
      getMyVerification(sessionResult.value),
      getVerificationGate(sessionResult.value),
    ]);
    return { profile, verification, gate };
  });
}

// ---------------------------------------------------------------------------
// Статус «болею»
// ---------------------------------------------------------------------------

export interface SickLeavePageData {
  readonly items: readonly MySickLeave[];
  readonly sickNow: boolean;
}

export async function loadSickLeavePageData(cookieHeader: string): Promise<LoadResult<SickLeavePageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const [items, sickNow] = await Promise.all([
      getMySickLeaves(sessionResult.value),
      isSickNow(sessionResult.value),
    ]);
    return { items, sickNow };
  });
}

// ---------------------------------------------------------------------------
// Преподаватели
// ---------------------------------------------------------------------------

export interface TeachersPageData {
  readonly teachers: readonly TeacherListItem[];
}

export async function loadTeachersPageData(cookieHeader: string): Promise<LoadResult<TeachersPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => ({ teachers: await listTeachers(sessionResult.value) }));
}

/** Период карточки преподавателя — как в /api/teachers/[id] (две недели). */
const TEACHER_CARD_HORIZON_DAYS = 14;

export async function loadTeacherCardData(
  cookieHeader: string,
  teacherId: string,
): Promise<LoadResult<TeacherCard>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const from = startOfUtcDay(new Date());
    const to = addUtcDays(from, TEACHER_CARD_HORIZON_DAYS - 1);
    return getTeacherCard(sessionResult.value, teacherId, from, to);
  });
}

// ---------------------------------------------------------------------------
// Кабинет сотрудника деканата (/staff)
// ---------------------------------------------------------------------------

/**
 * Загрузчики кабинета сотрудника деканата.
 *
 * Правило то же, что у кабинета студента: данные берутся из ТЕХ ЖЕ
 * сервисов packages/core, что и роуты /api/staff/* (единая реализация),
 * поэтому страница не может показать больше, чем разрешает API. Сотрудник
 * видит только свой институт: faculty приходит из сессии, а не из query —
 * подмена параметров фильтра на чужие данные не работает.
 *
 * Ошибки резолвятся в состояния страницы: преподаватель (STAFF без
 * faculty) и студент получают понятную карточку «раздел недоступен»
 * вместо падения (services/staff-scope.ts → STAFF_ONLY → 404).
 */

/** Горизонт расписания сотрудника по умолчанию — две недели от сегодня. */
const STAFF_SCHEDULE_HORIZON_DAYS = 14;

/** Статус заявки в фильтре очереди. */
export type StaffRequestStatusFilter = 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED';

/** Статус верификации в фильтре очереди. */
export type StaffVerificationStatusFilter = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** Дата YYYY-MM-DD из query: любое иное значение → undefined (значение по умолчанию). */
function normalizeDateKey(raw: string | undefined): string | undefined {
  if (raw === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return undefined;
  }
  const date = new Date(`${raw.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dateKey(date) !== raw.trim()) {
    return undefined;
  }
  return raw.trim();
}

export interface StaffDashboardPageData {
  readonly dashboard: StaffDashboard;
}

export async function loadStaffDashboardPageData(cookieHeader: string): Promise<LoadResult<StaffDashboardPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => ({ dashboard: await getStaffDashboard(sessionResult.value) }));
}

export interface StaffRequestsPageData {
  readonly requests: readonly StaffRequestItem[];
  /** Выбранный фильтр (null — все статусы). */
  readonly status: StaffRequestStatusFilter | null;
}

export async function loadStaffRequestsPageData(
  cookieHeader: string,
  status: string | undefined,
): Promise<LoadResult<StaffRequestsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const filter: StaffRequestStatusFilter | null =
    status === 'NEW' || status === 'IN_PROGRESS' || status === 'READY' || status === 'REJECTED'
      ? status
      : null;
  return attempt(async () => ({
    requests: await listStaffRequests(sessionResult.value, filter === null ? {} : { status: filter }),
    status: filter,
  }));
}

export interface StaffVerificationsPageData {
  readonly verifications: readonly StaffVerificationItem[];
  readonly status: StaffVerificationStatusFilter | null;
}

export async function loadStaffVerificationsPageData(
  cookieHeader: string,
  status: string | undefined,
): Promise<LoadResult<StaffVerificationsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const filter: StaffVerificationStatusFilter | null =
    status === 'PENDING' || status === 'VERIFIED' || status === 'REJECTED' ? status : null;
  return attempt(async () => ({
    verifications: await listStaffVerifications(
      sessionResult.value,
      filter === null ? {} : { status: filter },
    ),
    status: filter,
  }));
}

export interface StaffSickLeavesPageData {
  readonly sickLeaves: readonly StaffSickLeaveItem[];
  readonly onlyActive: boolean;
  /** «Болеет прямо сейчас» — для сводки над списком. */
  readonly activeCount: number;
}

export async function loadStaffSickLeavesPageData(
  cookieHeader: string,
  onlyActive: boolean,
): Promise<LoadResult<StaffSickLeavesPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const sickLeaves = await listStaffSickLeaves(sessionResult.value, { onlyActive });
    const today = startOfUtcDay(new Date()).getTime();
    return {
      sickLeaves,
      onlyActive,
      activeCount: sickLeaves.filter(
        (leave) => leave.dateFrom.getTime() <= today && leave.dateTo.getTime() >= today,
      ).length,
    };
  });
}

/** Пары одного дня в расписании сотрудника. */
export interface StaffScheduleDay {
  readonly date: string;
  readonly lessons: readonly StaffLessonItem[];
}

export interface StaffSchedulePageData {
  readonly days: readonly StaffScheduleDay[];
  readonly from: string;
  readonly to: string;
}

export async function loadStaffSchedulePageData(
  cookieHeader: string,
  from: string | undefined,
  to: string | undefined,
): Promise<LoadResult<StaffSchedulePageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const start = startOfUtcDay(new Date());
  const fromKey = normalizeDateKey(from) ?? dateKey(start);
  const toKey = normalizeDateKey(to) ?? dateKey(addUtcDays(start, STAFF_SCHEDULE_HORIZON_DAYS - 1));

  return attempt(async () => {
    const lessons = await listStaffSchedule(sessionResult.value, { from: fromKey, to: toKey });
    const byDay = new Map<string, StaffLessonItem[]>();
    for (const lesson of lessons) {
      const key = dateKey(lesson.date);
      byDay.set(key, [...(byDay.get(key) ?? []), lesson]);
    }
    const days: StaffScheduleDay[] = [...byDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, dayLessons]) => ({ date, lessons: dayLessons }));
    return { days, from: fromKey, to: toKey };
  });
}

export interface StaffAnnouncementsPageData {
  readonly announcements: readonly StaffAnnouncementItem[];
  /** Группы института сотрудника — для аудитории «Группа». */
  readonly groups: readonly { id: string; name: string }[];
  /** Институт сотрудника; null у ADMIN (все институты). */
  readonly faculty: string | null;
  /** ADMIN публикует и «весь университет», и в любой институт. */
  readonly allFaculties: boolean;
}

export async function loadStaffAnnouncementsPageData(
  cookieHeader: string,
): Promise<LoadResult<StaffAnnouncementsPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return attempt(async () => {
    const session = sessionResult.value;
    const scope = requireStaffScope(session);
    const [announcements, groups] = await Promise.all([
      listStaffAnnouncements(session),
      listStaffGroups(session),
    ]);
    return {
      announcements,
      groups,
      faculty: scope.faculty,
      allFaculties: scope.allFaculties,
    };
  });
}

// ---------------------------------------------------------------------------
// Переписка (/messages)
// ---------------------------------------------------------------------------

/** Режим переписки по роли сессии. */
export type MessagesMode = 'student' | 'teacher' | 'none';

export interface MessagesPageData {
  readonly mode: MessagesMode;
  readonly conversations: readonly ConversationListItem[];
  /**
   * Открытый диалог — отдельным результатом: ошибка доступа к ЧУЖОМУ
   * диалогу (подстанов conversationId) не должна уносить весь список,
   * страница показывает объяснение в панели диалога.
   */
  readonly active: LoadResult<ConversationDetail> | null;
  /** Преподаватели для «Написать преподавателю» (только студент). */
  readonly teachers: readonly TeacherListItem[];
  /** Идентификатор преподавателя сессии — для ссылки «моё расписание». */
  readonly teacherId: string | null;
}

/**
 * Переписка кабинета. Два режима по роли (BRIEF v2 §4):
 * - студент: диалоги с преподавателями. До верификации загрузчик
 *   возвращает verification-required — страница рисует честную заглушку
 *   гейта со ссылкой на /verification (не 500 и не пустой экран);
 * - преподаватель (STAFF с профилем Teacher): диалоги, где ему пишут;
 *   в каждом видно ФИО и группу автора;
 * - сотрудник деканат и админ: перепиской не пользуются — mode='none',
 *   страница объясняет это и ведёт в их разделы.
 */
export async function loadMessagesPageData(
  cookieHeader: string,
  conversationId: string | undefined,
): Promise<LoadResult<MessagesPageData>> {
  const sessionResult = await requirePageSession(cookieHeader);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const session = sessionResult.value;
  const user = session.user;

  if (user.role === 'STUDENT') {
    return attempt(async () => {
      // Гейт верификации: listMyConversations бросает
      // VerificationRequiredError → состояние verification-required.
      const [conversations, teachers] = await Promise.all([
        listMyConversations(session),
        listTeachers(session),
      ]);
      return {
        mode: 'student' as const,
        conversations,
        active: conversationId === undefined ? null : await attempt(() => getConversation(session, conversationId)),
        teachers,
        teacherId: null,
      };
    });
  }

  if (typeof user.teacherId === 'string' && user.teacherId !== '') {
    return attempt(async () => {
      const conversations = await listMyConversations(session);
      return {
        mode: 'teacher' as const,
        conversations,
        active: conversationId === undefined ? null : await attempt(() => getConversation(session, conversationId)),
        teachers: [] as readonly TeacherListItem[],
        teacherId: user.teacherId,
      };
    });
  }

  return {
    ok: true,
    value: {
      mode: 'none' as const,
      conversations: [],
      active: null,
      teachers: [],
      teacherId: null,
    },
  };
}
