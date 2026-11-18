/**
 * Публичный API пакета @udgu/core.
 *
 * Границы пакета:
 * - password/session/ratelimit/ownership — безопасность и авторизация;
 * - storage — приватное хранилище фото студбилетов (вне webroot);
 * - services/* — домен кабинета: каждая функция принимает сессию и сама
 *   резолвит владельца данных (никаких «чужих» идентификаторов на входе);
 * - audit/mockOcr — вспомогательные модули домена.
 *
 * Пакет НЕ знает про Next.js и HTTP: cookie-хелперы — чистые функции,
 * маршруты (apps/web, P1.4) оборачивают их в Set-Cookie.
 */
export {
  saveIdCardPhoto,
  readIdCardPhoto,
  deleteIdCardPhoto,
  saveSickLeaveCertificate,
  readSickLeaveCertificate,
  deleteSickLeaveCertificate,
  saveStudyPlan,
  readStudyPlan,
  // Хранилище отдаёт файловые операции под именами «…File»: сервисный
  // deleteStudyPlan(session, id) — это удаление плана целиком (запись
  // в БД + файл), и два разных смысла не должны путаться в имени.
  deleteStudyPlan as deleteStudyPlanFile,
  storageRoot,
  idCardRoot,
  sickLeaveRoot,
  studyPlanRoot,
  idCardPhotoRelativePath,
  sickLeaveCertificateRelativePath,
  studyPlanRelativePath,
  IdCardStorageError,
  ID_CARD_DIR_NAME,
  SICK_LEAVE_DIR_NAME,
  STUDY_PLAN_DIR_NAME,
  ID_CARD_ALLOWED_MIME,
  STUDY_PLAN_ALLOWED_MIME,
  MAX_ID_CARD_SIZE_BYTES,
  MAX_STUDY_PLAN_SIZE_BYTES,
} from './storage';
export type { IdCardStorageErrorCode } from './storage';

export { CoreError, OwnershipError, ValidationError } from './errors';
export type {
  OwnershipErrorCode,
  ValidationErrorCode,
} from './errors';

export { firstIssues } from './validation';

export {
  hashPassword,
  verifyPassword,
  assertPassword,
  ARGON2_MEMORY_COST_KIB,
  ARGON2_TIME_COST,
  ARGON2_PARALLELISM,
  ARGON2_SALT_BYTES,
  ARGON2_HASH_LENGTH_BYTES,
  PASSWORD_HASH_ALGORITHM,
  ARGON2ID_PHASH_PREFIX,
} from './password';

export {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  generateSessionToken,
  hashSessionToken,
  generateCsrfToken,
  verifyCsrfToken,
  sessionTtlDays,
  sessionMaxAgeSeconds,
  sessionCookieName,
  csrfCookieName,
  isSecureCookie,
  sessionCookieAttributes,
  buildSessionCookie,
  buildExpiredSessionCookie,
  buildCsrfCookie,
  parseCookieValue,
  SESSION_TOKEN_BYTES,
  CSRF_TOKEN_BYTES,
  DEFAULT_SESSION_TTL_DAYS,
  DEFAULT_SESSION_COOKIE_NAME,
  DEFAULT_CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from './session';
export type {
  AuthSession,
  CookieAttributes,
  CreateSessionMeta,
  CreateSessionResult,
  SessionInfo,
  SessionUser,
} from './session';

export {
  checkLoginRateLimit,
  recordLoginAttempt,
  resetLoginRateLimit,
  loginAttemptsLeft,
  MAX_LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
} from './ratelimit';
export type { LoginRateLimitResult } from './ratelimit';

export {
  requireUser,
  requireRole,
  requireStudent,
  requireTeacher,
  requireOwnStudent,
  requireStaffAccess,
} from './ownership';

export {
  requireStaffScope,
  facultyStudentFilter,
  assertFacultyInScope,
} from './services/staff-scope';
export type { StaffScope } from './services/staff-scope';

export { getStaffDashboard } from './services/staffDashboard';
export type { StaffDashboard } from './services/staffDashboard';

export {
  listStaffRequests,
  decideStaffRequest,
  staffRequestsFilterSchema,
  staffRequestDecisionSchema,
} from './services/staffRequests';
export type {
  StaffRequestsFilter,
  StaffRequestDecision,
  StaffRequestItem,
} from './services/staffRequests';

export {
  listStaffAnnouncements,
  createStaffAnnouncement,
  listStaffGroups,
  staffAnnouncementSchema,
} from './services/staffAnnouncements';
export type { StaffAnnouncementInput, StaffAnnouncementItem } from './services/staffAnnouncements';

export {
  listStaffSchedule,
  moveStaffLesson,
  cancelStaffLesson,
  staffScheduleRangeSchema,
  staffLessonMoveSchema,
  staffLessonCancelSchema,
} from './services/staffSchedule';
export type {
  StaffScheduleRange,
  StaffLessonMoveInput,
  StaffLessonCancelInput,
  StaffLessonItem,
} from './services/staffSchedule';

export {
  listStaffSickLeaves,
  staffSickLeavesFilterSchema,
} from './services/staffSickLeaves';
export type { StaffSickLeavesFilter, StaffSickLeaveItem } from './services/staffSickLeaves';

export {
  listStaffVerifications,
  getStaffVerificationPhoto,
  decideStaffVerification,
  mimeForPhotoPath,
  staffVerificationsFilterSchema,
} from './services/staffVerifications';
export type { StaffVerificationsFilter, StaffVerificationItem } from './services/staffVerifications';

export {
  listMyConversations,
  getConversation,
  startConversationWithTeacher,
  sendMessage,
  markConversationRead,
  messagingRole,
  messageBodySchema,
  conversationStartSchema,
  MAX_MESSAGE_LENGTH,
} from './services/messaging';
export type {
  ConversationDetail,
  ConversationListItem,
  ConversationMessageItem,
  ConversationPeer,
  ConversationStartInput,
  MessageInput,
  MessagingRole,
} from './services/messaging';

export { writeAuditEvent, getAuditTrail } from './audit';
export type { AuditMetaValue, WriteAuditEventInput } from './audit';

export {
  recognizeIdCard,
  notFoundRecognition,
  MOCK_OCR_CONFIDENCE,
} from './mockOcr';
export type { IdCardRecognition, IdentityRegistryEntryLike } from './mockOcr';

export { getMyProfile } from './services/profile';
export type { MyProfile } from './services/profile';

export {
  getMyScheduleToday,
  getMyScheduleWeek,
  getMyNextLesson,
  getFreeGaps,
  getTeacherSchedule,
  getTeacherOfficeHours,
  startOfUtcDay,
  addUtcDays,
  dateKey,
  mondayOfUtcWeek,
  SCHEDULE_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  OFFICE_HOUR_TYPE_LABELS,
  WEEKDAY_LABELS,
} from './services/schedule';
export type {
  FreeGap,
  LessonOccurrence,
  ScheduleDay,
  ScheduleLesson,
  ScheduleWeek,
  TeacherLesson,
  TeacherOfficeHour,
} from './services/schedule';

export {
  getMyGrades,
  getMyAcademicSummary,
  calculateLeverage,
  GRADE_TYPE_LABELS,
} from './services/grades';
export type {
  AcademicDebt,
  AcademicSummary,
  AcademicTrend,
  ImprovementHint,
  LeverageResult,
  LeverageWork,
  MyGradeEntry,
  MyGradesBySemester,
  MyGradesResult,
  TrendDirection,
} from './services/grades';

export {
  createMyRequest,
  getMyRequests,
  getMyRequest,
  cancelMyRequest,
  requestFormSchema,
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
} from './services/requests';
export type { CreateMyRequestInput, MyRequest } from './services/requests';

export {
  getMyNotifications,
  getMyUnreadCount,
  markNotificationRead,
  markAllRead,
} from './services/notifications';
export type { MyNotification } from './services/notifications';

export {
  getAnnouncementsFor,
  ANNOUNCEMENT_AUDIENCE_LABELS,
} from './services/announcements';
export type { AnnouncementItem } from './services/announcements';

export { listTeachers, getTeacherCard } from './services/teachers';
export type { TeacherCard, TeacherListItem } from './services/teachers';

export {
  createMySickLeave,
  getMySickLeaves,
  isSickNow,
  sickLeaveFormSchema,
  MAX_SICK_LEAVE_DAYS,
} from './services/sickleave';
export type { CreateMySickLeaveInput, MySickLeave } from './services/sickleave';

export {
  submitVerification,
  getMyVerification,
  reviewVerification,
  getVerificationGate,
  requireVerifiedStudent,
  VerificationRequiredError,
  verificationSubmitSchema,
  verificationReviewSchema,
  VERIFICATION_GATED_FEATURES,
  CABINET_FEATURES,
} from './services/verification';
export type {
  CabinetFeature,
  MyVerification,
  ReviewVerificationInput,
  SubmitVerificationInput,
  VerificationGate,
} from './services/verification';

export {
  askAssistant,
  detectAssistantIntent,
  ASSISTANT_STARTER_QUESTIONS,
} from './services/assistant';

// Каналы доступа (BRIEF v3): ядро ботов Telegram / VK / MAX. Бот — тонкий
// адаптер: он вызывает те же сервисы кабинета, что и сайт.
export {
  BOT_CHANNELS,
  BOT_CHANNEL_LABELS,
  botChannelForProvider,
  botChannelProvider,
  isBotChannel,
  MAX_BOT_REPLIES,
} from './bot/protocol';
export type {
  BotChannel,
  BotReply,
  BotUpdate,
  ChannelProvider,
} from './bot/protocol';

export {
  botSessionFor,
  consumeBotLinkCode,
  createBotLinkCode,
  resolveChannelUser,
  BOT_LINK_CODE_LENGTH,
  BOT_LINK_CODE_TTL_MS,
} from './bot/identity';
export type {
  ChannelLinkResult,
  CreatedBotLinkCode,
} from './bot/identity';

export {
  enqueueChannelDeliveries,
  enqueueChannelDeliveriesSafely,
  listChannelInbox,
  dispatchPendingDeliveries,
  CHANNEL_INBOX_LIMIT,
  DISPATCH_BATCH_SIZE,
  MAX_DELIVERY_ERROR_LENGTH,
} from './bot/outbox';
export type {
  ChannelDeliveryInput,
  ChannelDeliveryItem,
  ChannelDeliverer,
  ChannelDeliveryRecipient,
  DispatchDeliveriesResult,
} from './bot/outbox';

export { handleBotCommand } from './bot/commands';

// Ассистент преподавателя: RAG по учебному плану (BRIEF v2 §5, P2b).
export {
  uploadStudyPlan,
  listMyStudyPlans,
  deleteStudyPlan,
  askStudyPlanAssistant,
  parseStudyPlanText,
  parseStudyPlanSections,
  buildPlanChunks,
  buildStudyPlanIndex,
  retrieveChunks,
  tokenizePlanText,
  tokensMatch,
  studyPlanUploadSchema,
  studyPlanQuestionSchema,
  TEACHER_ASSISTANT_STARTER_QUESTIONS,
} from './services/studyPlan';
export type {
  AskStudyPlanAssistantInput,
  AskStudyPlanAssistantOptions,
  ParsedPlan,
  PlanChunk,
  PlanSection,
  PlanSectionLines,
  RetrievedChunk,
  StudyPlanAssistantAnswer,
  StudyPlanCitation,
  StudyPlanIndex,
  StudyPlanListItem,
  UploadStudyPlanInput,
} from './services/studyPlan';

// Константы ассистента, пригодные для браузерного кода (без ядра и БД):
// их импортируют подпутем @udgu/core/assistant.
export { ASSISTANT_VERIFICATION_SUGGESTION } from './assistantClient';
export type {
  AssistantAnswer,
  AssistantIntent,
  AssistantMode,
  AskAssistantOptions,
} from './services/assistant';

export {
  ASSISTANT_SYSTEM_PROMPT,
  TEACHER_ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_LLM_TIMEOUT_MS,
  llmConfigFromEnv,
  createLlmClient,
  createLlmClientFromEnv,
} from './llm';
export type { LlmClient, LlmConfig, LlmRequest } from './llm';