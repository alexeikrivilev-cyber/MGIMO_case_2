/**
 * Клиентский слой доступа к API кабинета (apps/web).
 *
 * Единственная точка, через которую браузерный код обращается к /api:
 * - CSRF (паттерн «двойная отправка», ARCHITECTURE §4): токен берётся из
 *   GET /api/auth/csrf и кешируется В ПАМЯТИ МОДУЛЯ. В localStorage /
 *   sessionStorage токен не пишется и не читается: секретов авторизации
 *   в браузере нет и быть не может, авторизация — только httpOnly-cookie,
 *   которую ставит сервер. Все мутирующие запросы (POST/PUT/PATCH/DELETE)
 *   уходят с заголовком x-csrf-token (CSRF_HEADER_NAME из packages/core —
 *   одно имя на клиенте и middleware);
 * - сервер ротирует CSRF-cookie при входе/выходе (issueCsrfCookie), поэтому
 *   кеш сбрасывается после login/logout/oauth-callback, а ответ
 *   CSRF_INVALID дополнительно даёт один повтор со свежим токеном —
 *   иначе первая же мутация после входа получила бы 403;
 * - ошибки приводятся к единому формату { error: { code, message, details } }
 *   (lib/http.ts на сервере) и бросаются как ApiClientError;
 * - 401 UNAUTHENTICATED (сессия истекла/отозвана) → редирект на /login
 *   ТОЛЬКО в браузерном окружении: в тестах и SSR window отсутствует.
 *   ВАЖНО: 401 INVALID_CREDENTIALS от входа редиректа НЕ вызывает —
 *   неверный пароль показывается формой, страница не уходит из-под пользователя;
 * - типизированные методы повторяют контракты роутов apps/web/app/api.
 *   Формы ответов — типы packages/core (единый источник истины), импортируются
 *   только как типы: клиентский бандл не тянет Prisma и argon2.
 *
 * Тесты подменяют fetch (createApiClient({ fetch })) — сеть не нужна.
 */
import type {
  MyProfile,
  MyVerification,
  SessionUser,
  VerificationGate,
} from '@udgu/core';

// ---------------------------------------------------------------------------
// Ошибки API
// ---------------------------------------------------------------------------

/**
 * Ошибка клиентского слоя: машинный код и сообщение приходят от сервера
 * в едином формате (lib/http.ts), details — сообщения уровня формы
 * («поле: причина») для полей ввода. retryAfterSeconds заполняется из
 * заголовка Retry-After ответа (rate-limit входа: 429) — чтобы форма
 * входа могла сказать «попробуйте через N минут».
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly string[];
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: readonly string[] = [],
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Заголовок CSRF: имя общее с packages/core (CSRF_HEADER_NAME). */
const CSRF_HEADER = 'x-csrf-token';

/** Изменяющие методы — требуют CSRF-токен (как в middleware). */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Retry-After: секунды (числом) или дата HTTP-date → секунды ожидания. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const seconds = Number.parseInt(value.trim(), 10);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

/** Лимит размера фото студбилета, байт (MAX_ID_CARD_SIZE_BYTES в packages/core). */
const MAX_ID_CARD_PHOTO_BYTES = 5 * 1024 * 1024;

/** Лимит длины сообщения в переписке (MAX_MESSAGE_LENGTH в packages/core). */
const MAX_MESSAGE_LENGTH_CLIENT = 4000;

/** Форматы фото студбилета (ID_CARD_ALLOWED_MIME в packages/core). */
const ID_CARD_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ---------------------------------------------------------------------------
// Типы контрактов роутов
// ---------------------------------------------------------------------------

/** Провайдер OAuth-эмуляции: сегмент пути роутов (vk_id | max | telegram). */
export type OAuthProviderPath = 'vk_id' | 'max' | 'telegram';

export interface LoginInput {
  readonly login: string;
  readonly password: string;
}

/** POST /api/auth/login → { ok, redirectTo } (роль решает, куда). */
export interface LoginResult {
  readonly ok: boolean;
  readonly redirectTo: string;
}

/** GET /api/auth/session → пользователь сессии + гейт верификации. */
export interface SessionPayload {
  readonly user: SessionUser;
  readonly session: {
    readonly id: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  };
  /** Гейт верификации — только для STUDENT; у сотрудника/админа null. */
  readonly verificationGate: VerificationGate | null;
}

/** POST /api/auth/oauth/[provider]/start → ссылка страницы согласия. */
export interface OAuthStartResult {
  readonly consentUrl: string;
  readonly state: string;
  readonly expiresInSeconds: number;
}

/** Тело согласия: ФИО и группа обязательны (BRIEF v2), логин и ID аккаунта — нет. */
export interface OAuthCallbackInput {
  readonly state: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly login?: string;
  readonly providerAccountId?: string;
}

/** POST /api/auth/oauth/[provider]/callback → { ok, redirectTo }. */
export interface OAuthCallbackResult {
  readonly ok: boolean;
  readonly redirectTo: string;
}

/** GET /api/verification → своя заявка (null — не подана) + гейт. */
export interface VerificationPayload {
  readonly verification: MyVerification | null;
  readonly verificationGate: VerificationGate;
}

/** GET /api/profile → свой профиль студента. */
export interface ProfilePayload {
  readonly profile: MyProfile;
}

// ---------------------------------------------------------------------------
// Контракты данных кабинета (wire-форма: даты приходят строками ISO)
// ---------------------------------------------------------------------------

/** Уведомление в ленте (GET /api/notifications). */
export interface NotificationItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly link: string | null;
  readonly createdAt: string;
}

export interface NotificationsPayload {
  readonly notifications: readonly NotificationItem[];
  readonly unreadCount: number;
}

/** Заявка/справка в списке (GET /api/requests). */
export interface RequestItem {
  readonly id: string;
  readonly type: 'REFERENCE' | 'APPLICATION';
  readonly typeLabel: string;
  readonly status: 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED';
  readonly statusLabel: string;
  readonly formData: Record<string, string>;
  readonly staffComment: string | null;
  readonly createdAt: string;
}

/** Тело создания заявки (POST /api/requests). */
export interface CreateRequestInput {
  readonly type: 'REFERENCE' | 'APPLICATION';
  readonly formData: Record<string, string>;
}

/**
 * Ответ ассистента студента (POST /api/assistant, BRIEF v2 §5).
 * mode: deterministic — ответ движка по данным кабинета; llm — ответ
 * модели по той же сводке (ключ только в env сервера).
 */
export interface AssistantPayload {
  readonly answer: string;
  readonly intent: string;
  readonly suggestions: readonly string[];
  readonly mode: 'deterministic' | 'llm';
}

/**
 * Результат «левериджа» (POST /api/grades/leverage) — расчёт
 * packages/core calculateLeverage, сериализованный для браузера.
 */
export interface LeverageResultPayload {
  readonly targetGpa: number;
  readonly gradedCount: number;
  readonly pendingCount: number;
  readonly currentAverage: number | null;
  readonly neededSumOnPending: number | null;
  readonly neededAverageOnPending: number | null;
  readonly maxPossibleAverage: number | null;
  readonly achievable: boolean;
  readonly alreadyAchieved: boolean;
}

/** Отметка «болею» (GET/POST /api/sick-leave). */
export interface SickLeaveItem {
  readonly id: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly reason: string | null;
  readonly hasAttachment: boolean;
  readonly createdAt: string;
}

export interface SickLeavePayload {
  readonly items: readonly SickLeaveItem[];
  readonly sickNow: boolean;
}

// ---------------------------------------------------------------------------
// Контракты кабинета сотрудника деканата (/api/staff/*)
// ---------------------------------------------------------------------------

/** Сводка кабинета сотрудника: счётчики очередей его института. */
export interface StaffDashboardPayload {
  readonly faculty: string | null;
  readonly newRequests: number;
  readonly pendingVerifications: number;
  readonly sickNow: number;
  readonly todayScheduleChanges: number;
  readonly todayMovedIn: number;
}

/** Студент в очереди сотрудника: ФИО, группа, институт. */
export interface StaffStudentPayload {
  readonly id: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly faculty: string;
}

/** Заявка в очереди сотрудника (GET /api/staff/requests). */
export interface StaffRequestItemPayload {
  readonly id: string;
  readonly type: 'REFERENCE' | 'APPLICATION';
  readonly typeLabel: string;
  readonly status: 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED';
  readonly statusLabel: string;
  readonly formData: Record<string, string>;
  readonly staffComment: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly student: StaffStudentPayload;
}

/** Решение сотрудника по заявке (POST /api/staff/requests/[id]/decide). */
export interface StaffRequestDecisionInput {
  readonly status: 'IN_PROGRESS' | 'READY' | 'REJECTED';
  readonly staffComment?: string;
}

/** Заявка на верификацию в очереди (GET /api/staff/verifications). */
export interface StaffVerificationItemPayload {
  readonly id: string;
  readonly status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  readonly student: StaffStudentPayload;
  readonly recognizedLastName: string;
  readonly recognizedFirstName: string;
  readonly recognizedGroupName: string;
  readonly recognizedCardNumber: string;
  readonly matchScore: number | null;
  readonly submittedAt: string;
}

/** Решение по верификации (POST /api/staff/verifications/[id]/decide). */
export interface StaffVerificationDecisionInput {
  readonly status: 'VERIFIED' | 'REJECTED';
  readonly comment?: string;
}

/** Отметка «болею» в списке сотрудника (GET /api/staff/sick-leaves). */
export interface StaffSickLeaveItemPayload {
  readonly id: string;
  readonly studentId: string;
  readonly fullName: string;
  readonly groupName: string;
  readonly faculty: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly reason: string | null;
  readonly hasAttachment: boolean;
}

/** Пара в расписании групп института (GET /api/staff/schedule). */
export interface StaffLessonItemPayload {
  readonly id: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: 'LECTURE' | 'SEMINAR' | 'LAB';
  readonly typeLabel: string;
  readonly status: 'SCHEDULED' | 'MOVED' | 'CANCELLED';
  readonly statusLabel: string;
  readonly note: string | null;
  readonly movedToDate: string | null;
  readonly movedToRoom: string | null;
  readonly subjectName: string;
  readonly subjectCode: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly teacherName: string;
}

/** Перенос пары (POST /api/staff/schedule/[id]/move). */
export interface StaffLessonMoveInput {
  readonly date: string;
  readonly room?: string;
  readonly note?: string;
}

/** Объявление в списке сотрудника (GET /api/staff/announcements). */
export interface StaffAnnouncementItemPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly audience: 'ALL' | 'FACULTY' | 'GROUP';
  readonly audienceLabel: string;
  readonly faculty: string | null;
  readonly groupName: string | null;
  readonly pinned: boolean;
  readonly publishedAt: string;
}

/** Публикация объявления (POST /api/staff/announcements). */
export interface StaffAnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly audience: 'ALL' | 'FACULTY' | 'GROUP';
  readonly groupId?: string;
  readonly pinned?: boolean;
  readonly faculty?: string;
}

// ---------------------------------------------------------------------------
// Контракты ассистента преподавателя (/api/teacher/*, BRIEF v2 §5)
// ---------------------------------------------------------------------------

/**
 * Учебный план в списке преподавателя (GET /api/teacher/study-plans).
 * storagePath намеренно отсутствует: файл плана лежит в приватном
 * хранилище, публичных ссылок на него нет.
 */
export interface TeacherStudyPlanItem {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
}

/** Цитата-подсказка из плана: раздел и оценка релевантности. */
export interface TeacherAssistantCitation {
  readonly section: string;
  readonly score: number;
}

/**
 * Ответ ассистента преподавателя (POST /api/teacher/assistant).
 * mode: deterministic — ответ движка по разделам плана; llm — ответ
 * модели по тем же разделам (ключ только в env сервера).
 */
export interface TeacherAssistantPayload {
  readonly answer: string;
  readonly mode: 'deterministic' | 'llm';
  readonly citations: readonly TeacherAssistantCitation[];
  readonly suggestions: readonly string[];
  readonly plan: { readonly id: string; readonly title: string } | null;
}

// ---------------------------------------------------------------------------
// Контракты переписки (/api/conversations/*)
// ---------------------------------------------------------------------------

/** Собеседник диалога: преподаватель (для студента) или студент (для преподавателя). */
export interface ConversationPeerPayload {
  readonly id: string;
  readonly fullName: string;
  /** Группа студента — её видит преподаватель (требование BRIEF v2). */
  readonly groupName: string | null;
  readonly department: string | null;
  readonly position: string | null;
}

/** Диалог в списке переписки. */
export interface ConversationListItemPayload {
  readonly id: string;
  readonly peer: ConversationPeerPayload;
  readonly lastMessage: {
    readonly body: string;
    readonly createdAt: string;
    readonly mine: boolean;
  } | null;
  readonly unreadCount: number;
  readonly updatedAt: string;
}

/** Сообщение диалога. */
export interface ConversationMessagePayload {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly authorUserId: string;
  readonly mine: boolean;
  readonly readAt: string | null;
}

/** Диалог с сообщениями (GET /api/conversations/[id]). */
export interface ConversationDetailPayload {
  readonly id: string;
  readonly peer: ConversationPeerPayload;
  readonly messages: readonly ConversationMessagePayload[];
  readonly unreadCount: number;
}

export interface ApiClient {
  /** POST /api/auth/login — вход по логину/паролю университетской УЗ. */
  login(input: LoginInput): Promise<LoginResult>;
  /** POST /api/auth/logout — выход (сервер ревокает сессию и чистит cookie). */
  logout(): Promise<{ ok: boolean }>;
  /** GET /api/auth/session — кто вошёл и что открыто по гейту верификации. */
  getSession(): Promise<SessionPayload>;
  /** POST /api/auth/oauth/[provider]/start — начало регистрации через провайдера. */
  startOAuth(
    provider: OAuthProviderPath,
    prefill?: { login?: string; fullName?: string; groupName?: string },
  ): Promise<OAuthStartResult>;
  /** POST /api/auth/oauth/[provider]/callback — завершение эмуляции согласия. */
  oauthCallback(provider: OAuthProviderPath, input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
  /** GET /api/verification — заявка на верификацию студбилета и гейт. */
  getVerification(): Promise<VerificationPayload>;
  /** POST /api/verification — multipart: номер билета + фото (приватное хранилище). */
  submitVerification(cardNumber: string, photo: File): Promise<{ verification: MyVerification }>;
  /** GET /api/profile — профиль студента сессии. */
  getProfile(): Promise<ProfilePayload>;
  /** GET /api/notifications — лента уведомлений + счётчик непрочитанных. */
  getNotifications(): Promise<NotificationsPayload>;
  /** POST /api/notifications/read-all — отметить все уведомления прочитанными. */
  markAllNotificationsRead(): Promise<{ ok: boolean; updated: number }>;
  /** GET /api/requests — свои заявки и справки. */
  getRequests(): Promise<{ requests: readonly RequestItem[] }>;
  /** POST /api/requests — подать заявку (справка/заявление). */
  createRequest(input: CreateRequestInput): Promise<{ request: RequestItem }>;
  /** POST /api/requests/[id]/cancel — отменить свою заявку в статусе NEW. */
  cancelRequest(id: string): Promise<{ request: RequestItem }>;
  /** POST /api/grades/leverage — расчёт баллов до целевого среднего (ядро). */
  getLeverage(targetGpa: number): Promise<{ result: LeverageResultPayload }>;
  /** POST /api/assistant — вопрос ассистенту студента (ответ по его данным). */
  askAssistant(question: string): Promise<AssistantPayload>;
  /** POST /api/sick-leave — отметить «болею» (multipart: период + необязательное фото справки). */
  createSickLeave(form: FormData): Promise<{ sickLeave: SickLeaveItem }>;
  // ---- Ассистент преподавателя ----
  /** GET /api/teacher/study-plans — свои учебные планы (без путей хранилища). */
  getTeacherStudyPlans(): Promise<{ plans: readonly TeacherStudyPlanItem[] }>;
  /** POST /api/teacher/study-plans — загрузить план (multipart: title + файл .md/.txt). */
  uploadTeacherStudyPlan(title: string, file: File): Promise<{ plan: TeacherStudyPlanItem }>;
  /** DELETE /api/teacher/study-plans/[id] — удалить свой план (чужой → 404). */
  deleteTeacherStudyPlan(id: string): Promise<{ ok: boolean }>;
  /** POST /api/teacher/assistant — вопрос по учебному плану (RAG, ответ с цитатами). */
  askTeacherAssistant(question: string, planId?: string): Promise<TeacherAssistantPayload>;
  // ---- Кабинет сотрудника деканата ----
  /** GET /api/staff/dashboard — счётчики очередей института сотрудника. */
  getStaffDashboard(): Promise<{ dashboard: StaffDashboardPayload }>;
  /** GET /api/staff/requests — очередь заявок (необязательный фильтр по статусу). */
  getStaffRequests(status?: 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED'): Promise<{
    requests: readonly StaffRequestItemPayload[];
  }>;
  /** POST /api/staff/requests/[id]/decide — решение по заявке + комментарий студенту. */
  decideStaffRequest(id: string, input: StaffRequestDecisionInput): Promise<{ request: StaffRequestItemPayload }>;
  /** GET /api/staff/verifications — очередь верификаций студбилетов. */
  getStaffVerifications(status?: 'PENDING' | 'VERIFIED' | 'REJECTED'): Promise<{
    verifications: readonly StaffVerificationItemPayload[];
  }>;
  /** POST /api/staff/verifications/[id]/decide — одобрить/отклонить верификацию. */
  decideStaffVerification(
    id: string,
    input: StaffVerificationDecisionInput,
  ): Promise<{ verification: StaffVerificationItemPayload }>;
  /** GET /api/staff/sick-leaves — кто из студентов института болеет. */
  getStaffSickLeaves(onlyActive?: boolean): Promise<{ sickLeaves: readonly StaffSickLeaveItemPayload[] }>;
  /** GET /api/staff/schedule?from&to — пары групп института за период. */
  getStaffSchedule(from: string, to: string): Promise<{ lessons: readonly StaffLessonItemPayload[] }>;
  /** POST /api/staff/schedule/[id]/move — перенос пары на новую дату (и аудиторию). */
  moveStaffLesson(id: string, input: StaffLessonMoveInput): Promise<{ lesson: StaffLessonItemPayload }>;
  /** POST /api/staff/schedule/[id]/cancel — отмена пары с причиной. */
  cancelStaffLesson(id: string, reason: string): Promise<{ lesson: StaffLessonItemPayload }>;
  /** GET /api/staff/announcements — объявления, видимые сотруднику. */
  getStaffAnnouncements(): Promise<{ announcements: readonly StaffAnnouncementItemPayload[] }>;
  /** POST /api/staff/announcements — публикация объявления. */
  createStaffAnnouncement(input: StaffAnnouncementInput): Promise<{ announcement: StaffAnnouncementItemPayload }>;
  // ---- Переписка ----
  /** GET /api/conversations — диалоги владельца сессии (студент или преподаватель). */
  getConversations(): Promise<{ conversations: readonly ConversationListItemPayload[] }>;
  /** POST /api/conversations — студент начинает диалог с преподавателем. */
  createConversation(teacherId: string): Promise<{ conversation: ConversationDetailPayload }>;
  /** GET /api/conversations/[id] — диалог с сообщениями. */
  getConversation(id: string): Promise<{ conversation: ConversationDetailPayload }>;
  /** POST /api/conversations/[id]/messages — сообщение в диалог. */
  sendConversationMessage(id: string, body: string): Promise<{ message: ConversationMessagePayload }>;
  /** POST /api/conversations/[id]/read — отметить диалог прочитанным. */
  markConversationRead(id: string): Promise<{ ok: boolean; updated: number }>;
}

// ---------------------------------------------------------------------------
// Реализация
// ---------------------------------------------------------------------------

/**
 * Подменяемый fetch: глобальный по умолчанию, в тестах — заглушка.
 * Тип намеренно уже глобального fetch: реальный fetch ему удовлетворяет,
 * а тест получает узкий вход (путь-строка) и полный контроль ответа.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly fetch?: FetchLike;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-тело: Content-Type выставляется автоматически. */
  readonly json?: unknown;
  /** Multipart-тело: Content-Type НЕ выставляется (boundary ставит fetch). */
  readonly form?: FormData;
  readonly headers?: Record<string, string>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  // Кеш CSRF-токена — в замыкании модульного экземпляра: в памяти,
  // без какого-либо хранилища браузера. csrfRequest дедуплицирует
  // параллельные обращения: токен запрашивается один раз.
  let csrfToken: string | null = null;
  let csrfRequest: Promise<string> | null = null;

  function invalidateCsrf(): void {
    csrfToken = null;
    csrfRequest = null;
  }

  async function ensureCsrfToken(): Promise<string> {
    if (csrfToken !== null) {
      return csrfToken;
    }
    csrfRequest ??= (async () => {
      const response = await fetchImpl('/api/auth/csrf', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as { csrfToken?: unknown } | null;
      const token = payload?.csrfToken;
      if (!response.ok || typeof token !== 'string' || token === '') {
        throw new ApiClientError(
          response.status,
          'CSRF_UNAVAILABLE',
          'Не удалось получить токен безопасности. Обновите страницу.',
        );
      }
      csrfToken = token;
      return token;
    })();
    try {
      return await csrfRequest;
    } finally {
      // Запрос завершён (успехом или ошибкой): следующий — заново.
      // При ошибке кеш остаётся пустым, повтор возможен.
      csrfRequest = null;
    }
  }

  function toApiClientError(status: number, payload: unknown, retryAfterSeconds: number | null): ApiClientError {
    const body = payload as { error?: unknown } | null;
    const error = body?.error as
      | { code?: unknown; message?: unknown; details?: unknown }
      | undefined;
    if (error !== undefined && error !== null && typeof error === 'object') {
      const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'INTERNAL';
      const message =
        typeof error.message === 'string' && error.message !== ''
          ? error.message
          : 'Что-то пошло не так. Попробуйте позже.';
      const details = Array.isArray(error.details)
        ? error.details.filter((item): item is string => typeof item === 'string')
        : [];
      return new ApiClientError(status, code, message, details, retryAfterSeconds);
    }
    return new ApiClientError(status, 'INTERNAL', 'Что-то пошло не так. Попробуйте позже.', [], retryAfterSeconds);
  }

  async function request<T>(path: string, options: RequestOptions, allowCsrfRetry = true): Promise<T> {
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    let body: BodyInit | null = null;

    if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      // Content-Type намеренно не выставляем: браузер сам добавит
      // multipart/form-data с boundary — иначе сервер не разберёт файл.
      body = options.form;
    }

    if (MUTATING_METHODS.has(method)) {
      headers.set(CSRF_HEADER, await ensureCsrfToken());
    }

    const response = await fetchImpl(path, {
      method,
      headers,
      body,
      // Cookie сессии уходит автоматически: авторизация — только она,
      // клиент токены не читает и не хранит.
      credentials: 'same-origin',
    });

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const error = toApiClientError(response.status, payload, parseRetryAfter(response.headers.get('retry-after')));

      // Сервер ротирует CSRF-cookie (вход/выход) или токен устарел:
      // один повтор со свежим токеном. Повтор запрещён для самого
      // CSRF-запроса — иначе возможен цикл.
      if (error.code === 'CSRF_INVALID' && allowCsrfRetry && MUTATING_METHODS.has(method)) {
        invalidateCsrf();
        return request<T>(path, options, false);
      }

      // Сессия истекла — в браузере уводим на вход. INVALID_CREDENTIALS
      // (неверный пароль) остаётся на форме: редирект там был бы ошибкой.
      if (response.status === 401 && error.code === 'UNAUTHENTICATED' && typeof window !== 'undefined') {
        window.location.assign('/login');
      }
      throw error;
    }

    return payload as T;
  }

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      // Сервер выдаёт новую CSRF-cookie вместе с сессией — кеш токена
      // после входа недействителен.
      const result = await request<LoginResult>('/api/auth/login', {
        method: 'POST',
        json: input,
      });
      invalidateCsrf();
      return result;
    },

    async logout(): Promise<{ ok: boolean }> {
      const result = await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
      invalidateCsrf();
      return result;
    },

    async getSession(): Promise<SessionPayload> {
      return request<SessionPayload>('/api/auth/session', { method: 'GET' });
    },

    async startOAuth(
      provider: OAuthProviderPath,
      prefill?: { login?: string; fullName?: string; groupName?: string },
    ): Promise<OAuthStartResult> {
      return request<OAuthStartResult>(`/api/auth/oauth/${provider}/start`, {
        method: 'POST',
        json: prefill ?? {},
      });
    },

    async oauthCallback(
      provider: OAuthProviderPath,
      input: OAuthCallbackInput,
    ): Promise<OAuthCallbackResult> {
      // Пустые необязательные поля не отправляем: сервер сам выведет
      // логин и идентификатор аккаунта провайдера (BRIEF v2).
      const body: Record<string, string> = {
        state: input.state,
        fullName: input.fullName,
        groupName: input.groupName,
      };
      const login = input.login?.trim();
      if (login !== undefined && login !== '') {
        body.login = login;
      }
      const providerAccountId = input.providerAccountId?.trim();
      if (providerAccountId !== undefined && providerAccountId !== '') {
        body.providerAccountId = providerAccountId;
      }
      const result = await request<OAuthCallbackResult>(
        `/api/auth/oauth/${provider}/callback`,
        { method: 'POST', json: body },
      );
      invalidateCsrf();
      return result;
    },

    async getVerification(): Promise<VerificationPayload> {
      return request<VerificationPayload>('/api/verification', { method: 'GET' });
    },

    async submitVerification(cardNumber: string, photo: File): Promise<{ verification: MyVerification }> {
      const form = new FormData();
      form.set('cardNumber', cardNumber.trim());
      form.set('photo', photo);
      return request<{ verification: MyVerification }>('/api/verification', {
        method: 'POST',
        form,
      });
    },

    async getProfile(): Promise<ProfilePayload> {
      return request<ProfilePayload>('/api/profile', { method: 'GET' });
    },

    async getNotifications(): Promise<NotificationsPayload> {
      return request<NotificationsPayload>('/api/notifications', { method: 'GET' });
    },

    async markAllNotificationsRead(): Promise<{ ok: boolean; updated: number }> {
      return request<{ ok: boolean; updated: number }>('/api/notifications/read-all', {
        method: 'POST',
        json: {},
      });
    },

    async getRequests(): Promise<{ requests: readonly RequestItem[] }> {
      return request<{ requests: readonly RequestItem[] }>('/api/requests', { method: 'GET' });
    },

    async createRequest(input: CreateRequestInput): Promise<{ request: RequestItem }> {
      return request<{ request: RequestItem }>('/api/requests', {
        method: 'POST',
        json: { type: input.type, formData: input.formData },
      });
    },

    async cancelRequest(id: string): Promise<{ request: RequestItem }> {
      return request<{ request: RequestItem }>(`/api/requests/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        json: {},
      });
    },

    async getLeverage(targetGpa: number): Promise<{ result: LeverageResultPayload }> {
      return request<{ result: LeverageResultPayload }>('/api/grades/leverage', {
        method: 'POST',
        json: { targetGpa },
      });
    },

    async askAssistant(question: string): Promise<AssistantPayload> {
      return request<AssistantPayload>('/api/assistant', {
        method: 'POST',
        json: { question },
      });
    },

    async createSickLeave(form: FormData): Promise<{ sickLeave: SickLeaveItem }> {
      return request<{ sickLeave: SickLeaveItem }>('/api/sick-leave', {
        method: 'POST',
        form,
      });
    },

    // ---- Ассистент преподавателя ----

    async getTeacherStudyPlans(): Promise<{ plans: readonly TeacherStudyPlanItem[] }> {
      return request<{ plans: readonly TeacherStudyPlanItem[] }>('/api/teacher/study-plans', {
        method: 'GET',
      });
    },

    async uploadTeacherStudyPlan(title: string, file: File): Promise<{ plan: TeacherStudyPlanItem }> {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('file', file);
      return request<{ plan: TeacherStudyPlanItem }>('/api/teacher/study-plans', {
        method: 'POST',
        form,
      });
    },

    async deleteTeacherStudyPlan(id: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>(`/api/teacher/study-plans/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },

    async askTeacherAssistant(question: string, planId?: string): Promise<TeacherAssistantPayload> {
      return request<TeacherAssistantPayload>('/api/teacher/assistant', {
        method: 'POST',
        json: { question, ...(planId === undefined ? {} : { planId }) },
      });
    },

    // ---- Кабинет сотрудника деканата ----

    async getStaffDashboard(): Promise<{ dashboard: StaffDashboardPayload }> {
      return request<{ dashboard: StaffDashboardPayload }>('/api/staff/dashboard', { method: 'GET' });
    },

    async getStaffRequests(status?: 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED'): Promise<{
      requests: readonly StaffRequestItemPayload[];
    }> {
      const query = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
      return request<{ requests: readonly StaffRequestItemPayload[] }>(`/api/staff/requests${query}`, {
        method: 'GET',
      });
    },

    async decideStaffRequest(
      id: string,
      input: StaffRequestDecisionInput,
    ): Promise<{ request: StaffRequestItemPayload }> {
      return request<{ request: StaffRequestItemPayload }>(
        `/api/staff/requests/${encodeURIComponent(id)}/decide`,
        { method: 'POST', json: input },
      );
    },

    async getStaffVerifications(status?: 'PENDING' | 'VERIFIED' | 'REJECTED'): Promise<{
      verifications: readonly StaffVerificationItemPayload[];
    }> {
      const query = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
      return request<{ verifications: readonly StaffVerificationItemPayload[] }>(
        `/api/staff/verifications${query}`,
        { method: 'GET' },
      );
    },

    async decideStaffVerification(
      id: string,
      input: StaffVerificationDecisionInput,
    ): Promise<{ verification: StaffVerificationItemPayload }> {
      return request<{ verification: StaffVerificationItemPayload }>(
        `/api/staff/verifications/${encodeURIComponent(id)}/decide`,
        { method: 'POST', json: input },
      );
    },

    async getStaffSickLeaves(onlyActive = false): Promise<{ sickLeaves: readonly StaffSickLeaveItemPayload[] }> {
      return request<{ sickLeaves: readonly StaffSickLeaveItemPayload[] }>(
        `/api/staff/sick-leaves?onlyActive=${onlyActive ? 'true' : 'false'}`,
        { method: 'GET' },
      );
    },

    async getStaffSchedule(from: string, to: string): Promise<{ lessons: readonly StaffLessonItemPayload[] }> {
      const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      return request<{ lessons: readonly StaffLessonItemPayload[] }>(`/api/staff/schedule${query}`, {
        method: 'GET',
      });
    },

    async moveStaffLesson(id: string, input: StaffLessonMoveInput): Promise<{ lesson: StaffLessonItemPayload }> {
      return request<{ lesson: StaffLessonItemPayload }>(
        `/api/staff/schedule/${encodeURIComponent(id)}/move`,
        { method: 'POST', json: input },
      );
    },

    async cancelStaffLesson(id: string, reason: string): Promise<{ lesson: StaffLessonItemPayload }> {
      return request<{ lesson: StaffLessonItemPayload }>(
        `/api/staff/schedule/${encodeURIComponent(id)}/cancel`,
        { method: 'POST', json: { reason } },
      );
    },

    async getStaffAnnouncements(): Promise<{ announcements: readonly StaffAnnouncementItemPayload[] }> {
      return request<{ announcements: readonly StaffAnnouncementItemPayload[] }>('/api/staff/announcements', {
        method: 'GET',
      });
    },

    async createStaffAnnouncement(input: StaffAnnouncementInput): Promise<{ announcement: StaffAnnouncementItemPayload }> {
      return request<{ announcement: StaffAnnouncementItemPayload }>('/api/staff/announcements', {
        method: 'POST',
        json: input,
      });
    },

    // ---- Переписка ----

    async getConversations(): Promise<{ conversations: readonly ConversationListItemPayload[] }> {
      return request<{ conversations: readonly ConversationListItemPayload[] }>('/api/conversations', {
        method: 'GET',
      });
    },

    async createConversation(teacherId: string): Promise<{ conversation: ConversationDetailPayload }> {
      return request<{ conversation: ConversationDetailPayload }>('/api/conversations', {
        method: 'POST',
        json: { teacherId },
      });
    },

    async getConversation(id: string): Promise<{ conversation: ConversationDetailPayload }> {
      return request<{ conversation: ConversationDetailPayload }>(
        `/api/conversations/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );
    },

    async sendConversationMessage(id: string, body: string): Promise<{ message: ConversationMessagePayload }> {
      return request<{ message: ConversationMessagePayload }>(
        `/api/conversations/${encodeURIComponent(id)}/messages`,
        { method: 'POST', json: { body } },
      );
    },

    async markConversationRead(id: string): Promise<{ ok: boolean; updated: number }> {
      return request<{ ok: boolean; updated: number }>(
        `/api/conversations/${encodeURIComponent(id)}/read`,
        { method: 'POST', json: {} },
      );
    },
  };
}

/**
 * Экземпляр по умолчанию: кеш CSRF живёт в памяти этого модуля.
 * Страницы кабинета используют его; тесты создают свои через createApiClient.
 */
export const api: ApiClient = createApiClient();

/** Лимит размера фото студбилета, байт (дублирует MAX_ID_CARD_SIZE_BYTES core для клиента). */
export const ID_CARD_PHOTO_MAX_BYTES = MAX_ID_CARD_PHOTO_BYTES;

/** Лимит длины сообщения в переписке (дублирует MAX_MESSAGE_LENGTH core для клиента). */
export const MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH_CLIENT;

/** Допустимые MIME фото студбилета (дублирует ID_CARD_ALLOWED_MIME core для клиента). */
export const ID_CARD_PHOTO_ALLOWED_MIME: readonly string[] = ID_CARD_PHOTO_MIME;

/** Лимит размера учебного плана, байт (MAX_STUDY_PLAN_SIZE_BYTES в packages/core). */
export const STUDY_PLAN_MAX_BYTES = 1024 * 1024;

/** Допустимые MIME учебного плана (STUDY_PLAN_ALLOWED_MIME в packages/core). */
export const STUDY_PLAN_ALLOWED_MIME: readonly string[] = ['text/markdown', 'text/plain'];

/** Проверка файла учебного плана на клиенте: понятная ошибка до отправки. */
export function validateStudyPlanFile(file: File): string | null {
  const extension = file.name.toLowerCase().split('.').pop();
  const looksLikePlan =
    STUDY_PLAN_ALLOWED_MIME.includes(file.type) || extension === 'md' || extension === 'txt';
  if (!looksLikePlan) {
    return 'План — текстовый файл .md или .txt.';
  }
  if (file.size > STUDY_PLAN_MAX_BYTES) {
    return 'Размер плана не должен превышать 1 МБ.';
  }
  return null;
}

/** Проверка файла фото на клиенте: понятная ошибка до отправки на сервер. */
export function validateIdCardPhoto(file: File): string | null {
  if (!ID_CARD_PHOTO_ALLOWED_MIME.includes(file.type)) {
    return 'Фото должно быть в формате JPEG, PNG или WebP.';
  }
  if (file.size > MAX_ID_CARD_PHOTO_BYTES) {
    return 'Размер фото не должен превышать 5 МБ.';
  }
  return null;
}
