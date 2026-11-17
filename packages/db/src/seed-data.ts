/**
 * Генератор синтетических данных Удмуртского государственного университета
 * (УдГУ), город Ижевск.
 *
 * Чистая функция без обращений к БД: строит все сущности сидера в памяти.
 * Благодаря этому инварианты данных проверяются в тестах (test/seed.test.ts)
 * без подключения к PostgreSQL, а запись в БД живёт в prisma/seed.ts.
 *
 * Структура вуза (институты, коды и названия направлений подготовки)
 * соответствует открытым сведениям об УдГУ, но ВСЕ люди, группы, оценки,
 * зачётки и фото студбилетов — вымышленные. Пароль тестовых аккаунтов —
 * фикстура сидера, в продакшене пароли задаются только через переменные
 * окружения.
 */
import { hash as argon2Hash } from 'argon2';

export const TEST_PASSWORD = 'password123';

/** Полное наименование вуза. */
export const UNIVERSITY_NAME = 'Удмуртский государственный университет';
/** Короткое наименование вуза. */
export const UNIVERSITY_SHORT_NAME = 'УдГУ';
/** Город вуза. */
export const UNIVERSITY_CITY = 'Ижевск';

/** Направление подготовки бакалавриата (код и название — реальные у УдГУ). */
interface DirectionDef {
  /** Короткий код направления — используется в названиях групп и зачёток. */
  readonly short: string;
  /** Код направления подготовки по ФГОС. */
  readonly code: string;
  /** Название направления подготовки. */
  readonly name: string;
}

/** Институт УдГУ (реальная структура вуза). */
interface InstituteDef {
  readonly name: string;
  readonly directions: readonly DirectionDef[];
}

export const INSTITUTES: readonly InstituteDef[] = [
  {
    name: 'Институт математики, информационных технологий и физики',
    directions: [
      { short: 'ПИ', code: '09.03.03', name: 'Прикладная информатика' },
      { short: 'ПМИ', code: '01.03.02', name: 'Прикладная математика и информатика' },
    ],
  },
  {
    name: 'Институт языка и литературы',
    directions: [
      { short: 'ФИЛ', code: '45.03.01', name: 'Филология' },
      { short: 'ЛИН', code: '45.03.02', name: 'Лингвистика' },
    ],
  },
  {
    name: 'Институт истории и социологии',
    directions: [
      { short: 'ИОР', code: '46.03.01', name: 'История' },
      { short: 'СОЦ', code: '39.03.01', name: 'Социология' },
    ],
  },
  {
    name: 'Институт права, социального управления и безопасности',
    directions: [
      { short: 'ЮР', code: '40.03.01', name: 'Юриспруденция' },
      { short: 'ИБ', code: '10.03.01', name: 'Информационная безопасность' },
    ],
  },
  {
    name: 'Институт экономики и управления',
    directions: [
      { short: 'БИ', code: '38.03.05', name: 'Бизнес-информатика' },
      { short: 'ЭК', code: '38.03.01', name: 'Экономика' },
    ],
  },
  {
    name: 'Институт физической культуры и спорта',
    directions: [
      { short: 'ФК', code: '49.03.01', name: 'Физическая культура' },
      { short: 'ТУР', code: '43.03.02', name: 'Туризм' },
    ],
  },
  {
    name: 'Институт искусств и дизайна',
    directions: [
      { short: 'ДЗ', code: '54.03.01', name: 'Дизайн' },
      { short: 'ДПИ', code: '54.03.02', name: 'Декоративно-прикладное искусство и народные промыслы' },
    ],
  },
  {
    name: 'Институт педагогики, психологии и социальных технологий',
    directions: [
      { short: 'ПО', code: '44.03.05', name: 'Педагогическое образование (с двумя профилями подготовки)' },
      { short: 'ПСИ', code: '37.03.01', name: 'Психология' },
    ],
  },
];

interface SubjectDef {
  readonly code: string;
  readonly name: string;
}

/** Дисциплины по институтам (по 10 на институт — все названия общие для вуза). */
const SUBJECT_DEFS: readonly (readonly SubjectDef[])[] = [
  [
    { code: 'ПИ-101', name: 'Математический анализ' },
    { code: 'ПИ-102', name: 'Линейная алгебра и аналитическая геометрия' },
    { code: 'ПИ-103', name: 'Дискретная математика' },
    { code: 'ПИ-104', name: 'Алгоритмы и структуры данных' },
    { code: 'ПИ-105', name: 'Базы данных' },
    { code: 'ПИ-106', name: 'Операционные системы' },
    { code: 'ПИ-107', name: 'Веб-технологии' },
    { code: 'ПИ-108', name: 'Программирование на Python' },
    { code: 'ПИ-109', name: 'Иностранный язык' },
    { code: 'ПИ-110', name: 'Физика' },
  ],
  [
    { code: 'ФИЛ-201', name: 'Русский язык и культура речи' },
    { code: 'ФИЛ-202', name: 'История русской литературы' },
    { code: 'ФИЛ-203', name: 'Зарубежная литература' },
    { code: 'ФИЛ-204', name: 'Лексикология и стилистика' },
    { code: 'ФИЛ-205', name: 'Практический курс английского языка' },
    { code: 'ФИЛ-206', name: 'Практический курс французского языка' },
    { code: 'ФИЛ-207', name: 'Латинский язык' },
    { code: 'ФИЛ-208', name: 'Культурология' },
    { code: 'ФИЛ-209', name: 'Логика' },
    { code: 'ФИЛ-210', name: 'Риторика' },
  ],
  [
    { code: 'ИОР-301', name: 'История России' },
    { code: 'ИОР-302', name: 'Всеобщая история' },
    { code: 'ИОР-303', name: 'История Удмуртии' },
    { code: 'ИОР-304', name: 'Археология' },
    { code: 'ИОР-305', name: 'Этнология Удмуртии' },
    { code: 'ИОР-306', name: 'Социология' },
    { code: 'ИОР-307', name: 'Документоведение и архивоведение' },
    { code: 'ИОР-308', name: 'Международные отношения' },
    { code: 'ИОР-309', name: 'Методика исторического исследования' },
    { code: 'ИОР-310', name: 'Политология' },
  ],
  [
    { code: 'ЮР-401', name: 'Гражданское право' },
    { code: 'ЮР-402', name: 'Уголовное право' },
    { code: 'ЮР-403', name: 'Конституционное право' },
    { code: 'ЮР-404', name: 'Административное право' },
    { code: 'ЮР-405', name: 'Трудовое право' },
    { code: 'ЮР-406', name: 'Экологическое право' },
    { code: 'ЮР-407', name: 'Правоведение' },
    { code: 'ЮР-408', name: 'Информационная безопасность' },
    { code: 'ЮР-409', name: 'Логика и юридическая техника' },
    { code: 'ЮР-410', name: 'История государства и права России' },
  ],
  [
    { code: 'БИ-501', name: 'Микроэкономика' },
    { code: 'БИ-502', name: 'Макроэкономика' },
    { code: 'БИ-503', name: 'Бухгалтерский учёт' },
    { code: 'БИ-504', name: 'Статистика' },
    { code: 'БИ-505', name: 'Финансовый менеджмент' },
    { code: 'БИ-506', name: 'Маркетинг' },
    { code: 'БИ-507', name: 'Менеджмент' },
    { code: 'БИ-508', name: 'Экономика предприятий и организаций' },
    { code: 'БИ-509', name: 'Информационные технологии в экономике' },
    { code: 'БИ-510', name: 'Государственное и муниципальное управление' },
  ],
  [
    { code: 'ФК-601', name: 'Анатомия и физиология человека' },
    { code: 'ФК-602', name: 'Биомеханика двигательных действий' },
    { code: 'ФК-603', name: 'Спортивные игры' },
    { code: 'ФК-604', name: 'Лёгкая атлетика' },
    { code: 'ФК-605', name: 'Плавание' },
    { code: 'ФК-606', name: 'Гимнастика' },
    { code: 'ФК-607', name: 'Основы здорового образа жизни' },
    { code: 'ФК-608', name: 'Психология физической культуры' },
    { code: 'ФК-609', name: 'Теория и методика физического воспитания' },
    { code: 'ФК-610', name: 'Первая помощь' },
  ],
  [
    { code: 'ДЗ-701', name: 'Рисунок' },
    { code: 'ДЗ-702', name: 'Живопись' },
    { code: 'ДЗ-703', name: 'Композиция' },
    { code: 'ДЗ-704', name: 'История искусств' },
    { code: 'ДЗ-705', name: 'Цветоведение' },
    { code: 'ДЗ-706', name: 'Графический дизайн' },
    { code: 'ДЗ-707', name: 'Проектирование костюма' },
    { code: 'ДЗ-708', name: 'Типографика' },
    { code: 'ДЗ-709', name: 'История костюма' },
    { code: 'ДЗ-710', name: 'Керамика и декоративно-прикладное искусство' },
  ],
  [
    { code: 'ПО-801', name: 'Педагогика' },
    { code: 'ПО-802', name: 'Психология развития' },
    { code: 'ПО-803', name: 'Социальная психология' },
    { code: 'ПО-804', name: 'Психология общения' },
    { code: 'ПО-805', name: 'Основы логопедии' },
    { code: 'ПО-806', name: 'Социальная работа с семьёй' },
    { code: 'ПО-807', name: 'Организация работы с молодёжью' },
    { code: 'ПО-808', name: 'Основы инклюзивного образования' },
    { code: 'ПО-809', name: 'Психологическая диагностика' },
    { code: 'ПО-810', name: 'Педагогическая практика' },
  ],
];

interface TeacherDef {
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string;
  readonly department: string;
  readonly position: string;
}

/** Преподаватели: по 2 на институт (все — вымышленные). */
const TEACHER_DEFS: readonly TeacherDef[][] = [
  [
    { lastName: 'Соколов', firstName: 'Андрей', middleName: 'Викторович', department: 'Кафедра прикладной информатики', position: 'Доцент' },
    { lastName: 'Лебедева', firstName: 'Ольга', middleName: 'Петровна', department: 'Кафедра информационных технологий', position: 'Профессор' },
  ],
  [
    { lastName: 'Романова', firstName: 'Ирина', middleName: 'Викторовна', department: 'Кафедра русской литературы', position: 'Доцент' },
    { lastName: 'Гусев', firstName: 'Виктор', middleName: 'Александрович', department: 'Кафедра иностранных языков', position: 'Профессор' },
  ],
  [
    { lastName: 'Захаров', firstName: 'Пётр', middleName: 'Николаевич', department: 'Кафедра истории России', position: 'Профессор' },
    { lastName: 'Крылова', firstName: 'Светлана', middleName: 'Дмитриевна', department: 'Кафедра социологии', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Морозов', firstName: 'Денис', middleName: 'Игоревич', department: 'Кафедра гражданского права', position: 'Доцент' },
    { lastName: 'Волкова', firstName: 'Елена', middleName: 'Сергеевна', department: 'Кафедра теории и истории права', position: 'Профессор' },
  ],
  [
    { lastName: 'Никитин', firstName: 'Артём', middleName: 'Олегович', department: 'Кафедра экономики предприятия', position: 'Доцент' },
    { lastName: 'Тарасова', firstName: 'Марина', middleName: 'Львовна', department: 'Кафедра менеджмента и маркетинга', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Белов', firstName: 'Павел', middleName: 'Романович', department: 'Кафедра физического воспитания', position: 'Доцент' },
    { lastName: 'Орлова', firstName: 'Наталья', middleName: 'Ильинична', department: 'Кафедра спортивных дисциплин', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Зайцев', firstName: 'Кирилл', middleName: 'Андреевич', department: 'Кафедра графического дизайна', position: 'Доцент' },
    { lastName: 'Ефимова', firstName: 'Алёна', middleName: 'Владимировна', department: 'Кафедра декоративно-прикладного искусства', position: 'Профессор' },
  ],
  [
    { lastName: 'Верещагин', firstName: 'Игорь', middleName: 'Юрьевич', department: 'Кафедра педагогики и психологии', position: 'Профессор' },
    { lastName: 'Комарова', firstName: 'Лидия', middleName: 'Павловна', department: 'Кафедра социальной педагогики', position: 'Доцент' },
  ],
];

/** Группа: одна группа на институт, направление — directions[0] института. */
interface GroupDef {
  /** Индекс института в INSTITUTES. */
  readonly instituteIndex: number;
  readonly directionIndex: number;
  readonly course: number;
}

const GROUP_DEFS: readonly GroupDef[] = [
  { instituteIndex: 0, directionIndex: 0, course: 3 },
  { instituteIndex: 1, directionIndex: 0, course: 2 },
  { instituteIndex: 2, directionIndex: 0, course: 4 },
  { instituteIndex: 3, directionIndex: 0, course: 3 },
  { instituteIndex: 4, directionIndex: 0, course: 2 },
  { instituteIndex: 5, directionIndex: 0, course: 1 },
  { instituteIndex: 6, directionIndex: 0, course: 2 },
  { instituteIndex: 7, directionIndex: 0, course: 3 },
];

interface StudentDef {
  readonly login: string;
  /** Индекс института. */
  readonly instituteIndex: number;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string;
}

const STUDENT_DEFS: readonly StudentDef[] = [
  { login: 'student1', instituteIndex: 0, lastName: 'Иванов', firstName: 'Александр', middleName: 'Дмитриевич' },
  { login: 'student2', instituteIndex: 4, lastName: 'Петрова', firstName: 'Мария', middleName: 'Андреевна' },
  { login: 'student3', instituteIndex: 3, lastName: 'Смирнов', firstName: 'Никита', middleName: 'Иванович' },
  { login: 'student4', instituteIndex: 7, lastName: 'Кузнецова', firstName: 'Анна', middleName: 'Сергеевна' },
];

export const SCHEDULE_HORIZON_DAYS = 14;

const TIME_SLOTS: readonly { start: string; end: string }[] = [
  { start: '08:30', end: '09:50' },
  { start: '10:00', end: '11:20' },
  { start: '11:40', end: '13:00' },
  { start: '13:30', end: '14:50' },
  { start: '15:00', end: '16:20' },
  { start: '16:30', end: '17:50' },
];

/**
 * Аудитории. Префиксы условно обозначают корпуса вуза: У — главный корпус
 * (Университетская, 1), Л — лекционный корпус, С — спортивный корпус,
 * Т — технический корпус. Все номера вымышленные.
 */
const ROOMS: readonly string[] = [
  'У-101', 'У-204', 'У-311', 'У-418',
  'Л-201', 'Л-305',
  'С-105', 'С-207',
  'Т-302',
];

const CANCELLED_REASONS: readonly string[] = [
  'Отменено: преподаватель на научной конференции',
  'Отменено: приказ ректора № 214-од',
  'Отменено: заболевание преподавателя',
  'Отменено: аудитория на ремонте',
];

const MOVED_NOTE = 'Перенос согласован с кафедрой';

const SEMESTER_DATE_RANGES: readonly { semester: number; from: string; to: string }[] = [
  { semester: 1, from: '2025-12-15', to: '2026-01-20' },
  { semester: 2, from: '2026-05-20', to: '2026-06-20' },
];

export type Role = 'STUDENT' | 'STAFF' | 'ADMIN';
export type ScheduleType = 'LECTURE' | 'SEMINAR' | 'LAB';
export type ScheduleStatus = 'SCHEDULED' | 'MOVED' | 'CANCELLED';
export type GradeType = 'EXAM' | 'CREDIT' | 'COURSEWORK';
export type RequestType = 'REFERENCE' | 'APPLICATION';
export type RequestStatus = 'NEW' | 'IN_PROGRESS' | 'READY' | 'REJECTED';
export type AnnouncementAudience = 'ALL' | 'FACULTY' | 'GROUP';
export type NotificationType =
  | 'SCHEDULE_CHANGE'
  | 'GRADE'
  | 'REQUEST_STATUS'
  | 'ANNOUNCEMENT'
  | 'DEADLINE'
  | 'SYSTEM';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type OAuthProvider = 'VK_ID' | 'MAX' | 'TELEGRAM';
export type OfficeHourType = 'CONSULTATION' | 'RECEPTION' | 'EXTRA_CLASS';

export interface UserSeed {
  readonly login: string;
  readonly passwordHash: string;
  readonly role: Role;
}

export interface GroupSeed {
  readonly name: string;
  readonly faculty: string;
  readonly course: number;
  readonly direction: string;
}

export interface SubjectSeed {
  readonly code: string;
  readonly name: string;
  readonly faculty: string;
}

export interface TeacherSeed {
  readonly login: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly department: string;
  readonly position: string;
}

export interface StudentSeed {
  readonly login: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly faculty: string;
  readonly direction: string;
  readonly course: number;
  readonly groupName: string;
  readonly email: string;
  readonly studentCardNumber: string;
  readonly phone: string | null;
}

export interface ScheduleEntrySeed {
  readonly groupName: string;
  readonly subjectCode: string;
  readonly teacherLogin: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: ScheduleType;
  readonly status: ScheduleStatus;
  readonly note: string | null;
  readonly movedToDate: string | null;
  readonly movedToRoom: string | null;
}

export interface GradeSeed {
  readonly studentLogin: string;
  readonly subjectCode: string;
  readonly value: number | null;
  readonly passed: boolean | null;
  readonly type: GradeType;
  readonly date: string;
  readonly semester: number;
}

export interface RequestSeed {
  readonly studentLogin: string;
  readonly type: RequestType;
  readonly formData: Record<string, string>;
  readonly status: RequestStatus;
  readonly staffComment: string | null;
  readonly createdAt: string;
}

export interface AnnouncementSeed {
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  readonly faculty: string | null;
  readonly groupName: string | null;
  readonly pinned: boolean;
  readonly authorLogin: string;
  readonly publishedAt: string;
}

export interface NotificationSeed {
  readonly userLogin: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly link: string | null;
  readonly createdAt: string;
}

export interface AuditEventSeed {
  readonly actorLogin: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly meta: Record<string, string> | null;
  readonly createdAt: string;
}

/** Запись синтетического реестра студенческих билетов (мок-сверка). */
export interface IdentityRegistrySeed {
  readonly cardNumber: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly groupName: string;
  readonly faculty: string;
  readonly program: string;
  readonly course: number;
  readonly issuedAt: string;
}

/** Заявка на верификацию по фото студенческого билета. */
export interface StudentVerificationSeed {
  readonly studentLogin: string;
  readonly status: VerificationStatus;
  /** Имя файла внутри каталога id-cards/<studentId>/ приватного хранилища. */
  readonly photoFileName: string;
  readonly recognizedLastName: string;
  readonly recognizedFirstName: string;
  readonly recognizedGroupName: string;
  readonly recognizedCardNumber: string;
  readonly matchScore: number | null;
  readonly reviewerLogin: string | null;
  readonly reviewComment: string | null;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
}

/** Привязка учётной записи к OAuth-провайдеру (эмуляция согласия). */
export interface OAuthAccountSeed {
  readonly userLogin: string;
  readonly provider: OAuthProvider;
  readonly providerAccountId: string;
  readonly createdAt: string;
}

/** Одноразовый эмулятор согласия OAuth-провайдера. */
export interface OAuthIntentSeed {
  readonly state: string;
  readonly provider: OAuthProvider;
  readonly login: string | null;
  readonly fullName: string | null;
  readonly groupName: string | null;
  readonly purpose: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

/** Статус «болею». */
export interface SickLeaveSeed {
  readonly studentLogin: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly reason: string | null;
  readonly attachmentPath: string | null;
}

/** Консультация или час приёма преподавателя. */
export interface OfficeHourSeed {
  readonly teacherLogin: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
  readonly type: OfficeHourType;
  readonly note: string | null;
}

export interface SeedData {
  readonly users: readonly UserSeed[];
  readonly groups: readonly GroupSeed[];
  readonly subjects: readonly SubjectSeed[];
  readonly teachers: readonly TeacherSeed[];
  readonly students: readonly StudentSeed[];
  readonly scheduleEntries: readonly ScheduleEntrySeed[];
  readonly grades: readonly GradeSeed[];
  readonly requests: readonly RequestSeed[];
  readonly announcements: readonly AnnouncementSeed[];
  readonly notifications: readonly NotificationSeed[];
  readonly auditEvents: readonly AuditEventSeed[];
  readonly identityRegistry: readonly IdentityRegistrySeed[];
  readonly studentVerifications: readonly StudentVerificationSeed[];
  readonly oauthAccounts: readonly OAuthAccountSeed[];
  readonly oauthIntents: readonly OAuthIntentSeed[];
  readonly sickLeaves: readonly SickLeaveSeed[];
  readonly officeHours: readonly OfficeHourSeed[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Дата в конкретное время суток (UTC). */
function atTime(date: Date, hours: number, minutes: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes),
  );
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDateTimeKey(date: Date): string {
  return date.toISOString();
}

/** Детерминированный UUID (v4-подобный) из PRNG — сидер воспроизводим. */
function uuidFromRng(rng: () => number): string {
  const hex = '0123456789abcdef';
  const block = (length: number): string =>
    Array.from({ length }, () => hex[Math.floor(rng() * 16)]).join('');
  return `${block(8)}-${block(4)}-4${block(3)}-8${block(3)}-${block(12)}`;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function nextWeekdayOnwards(date: Date, minOffset: number, horizon: Date): Date {
  let candidate = addDays(date, minOffset);
  while (!isWeekday(candidate) || candidate.getTime() > horizon.getTime()) {
    candidate = addDays(candidate, -1);
    if (candidate.getTime() < date.getTime()) {
      candidate = addDays(date, 1);
      break;
    }
  }
  return candidate;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error('pick: пустой массив');
  }
  return item;
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/** Учебный год, начавшийся в сентябре (сентябрь = 8-й месяц). */
function academicYear(now: Date): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** Год поступления для группы заданного курса. */
function admissionYear(now: Date, course: number): number {
  return academicYear(now) - (course - 1);
}

export interface BuildSeedDataOptions {
  /** Базовая дата для расписания (по умолчанию — сегодня). */
  readonly now?: Date;
}

export async function buildSeedData(options: BuildSeedDataOptions = {}): Promise<SeedData> {
  const rng = mulberry32(20261117);
  const now = startOfDay(options.now ?? new Date());
  const scheduleEnd = addDays(now, SCHEDULE_HORIZON_DAYS);

  const passwordHash = await argon2Hash(TEST_PASSWORD, {
    type: 2, // argon2id
  });

  // ---- Группы: название вида ПИ-24-1 (код направления + год поступления) ----
  const groups: GroupSeed[] = GROUP_DEFS.map((groupDef) => {
    const institute = INSTITUTES[groupDef.instituteIndex];
    const direction = institute?.directions[groupDef.directionIndex];
    if (!institute || !direction) {
      throw new Error('Сидер: описанию группы не соответствует институт или направление');
    }
    const year = admissionYear(now, groupDef.course) % 100;
    return {
      name: `${direction.short}-${String(year).padStart(2, '0')}-1`,
      faculty: institute.name,
      course: groupDef.course,
      direction: `${direction.code} ${direction.name}`,
    };
  });

  const groupNameByInstitute = new Map<string, string>();
  GROUP_DEFS.forEach((groupDef, index) => {
    const institute = INSTITUTES[groupDef.instituteIndex];
    const group = groups[index];
    if (institute && group) groupNameByInstitute.set(institute.name, group.name);
  });

  const groupNameByDirectionShort = new Map<string, string>();
  const groupInfoByDirectionShort = new Map<
    string,
    { name: string; faculty: string; course: number; direction: string }
  >();
  GROUP_DEFS.forEach((groupDef, index) => {
    const institute = INSTITUTES[groupDef.instituteIndex];
    const direction = institute?.directions[groupDef.directionIndex];
    const group = groups[index];
    if (direction && group) {
      groupNameByDirectionShort.set(direction.short, group.name);
      groupInfoByDirectionShort.set(direction.short, {
        name: group.name,
        faculty: group.faculty,
        course: group.course,
        direction: group.direction,
      });
    }
  });

  // ---- Дисциплины: 10 на институт ----
  const subjects: SubjectSeed[] = INSTITUTES.flatMap((institute, index) =>
    (SUBJECT_DEFS[index] ?? []).map((subject) => ({ ...subject, faculty: institute.name })),
  );

  const subjectsByFaculty = new Map<string, SubjectSeed[]>();
  for (const subject of subjects) {
    const list = subjectsByFaculty.get(subject.faculty) ?? [];
    list.push(subject);
    subjectsByFaculty.set(subject.faculty, list);
  }

  // ---- Преподаватели: по 2 на институт ----
  const teachers: TeacherSeed[] = TEACHER_DEFS.flatMap((instituteTeachers, index) =>
    instituteTeachers.map((teacher, teacherIndex) => ({
      login: `teacher${index * 2 + teacherIndex + 1}`,
      lastName: teacher.lastName,
      firstName: teacher.firstName,
      middleName: teacher.middleName,
      department: teacher.department,
      position: teacher.position,
    })),
  );

  const teachersByFaculty = new Map<string, TeacherSeed[]>();
  TEACHER_DEFS.forEach((instituteTeachers, index) => {
    const faculty = INSTITUTES[index]?.name;
    if (!faculty) return;
    const list: TeacherSeed[] = [];
    instituteTeachers.forEach((_, teacherIndex) => {
      const teacher = teachers[index * 2 + teacherIndex];
      if (teacher) list.push(teacher);
    });
    teachersByFaculty.set(faculty, list);
  });

  // ---- Студенты ----
  const students: StudentSeed[] = STUDENT_DEFS.map((def, index) => {
    const institute = INSTITUTES[def.instituteIndex];
    const direction = institute?.directions[0];
    const groupDef = GROUP_DEFS.find((candidate) => candidate.instituteIndex === def.instituteIndex);
    const groupName = groupNameByInstitute.get(institute?.name ?? '');
    if (!institute || !direction || !groupDef || !groupName) {
      throw new Error(`Сидер: для студента ${def.login} не найдена группа`);
    }
    const cardSerial = String(101 + index * 37).padStart(4, '0');
    const phoneIndex = String(100 + index * 37).padStart(3, '0');
    return {
      login: def.login,
      lastName: def.lastName,
      firstName: def.firstName,
      middleName: def.middleName,
      faculty: institute.name,
      direction: `${direction.code} ${direction.name}`,
      course: groupDef.course,
      groupName,
      email: `${def.login}@udsu.ru`,
      studentCardNumber: `${direction.short}-${admissionYear(now, groupDef.course)}-${cardSerial}`,
      phone:
        def.login === 'student2'
          ? null
          : `+7 (900) ${phoneIndex}-${String(20 + index * 11).padStart(2, '0')}-${String(10 + index * 5).padStart(2, '0')}`,
    };
  });

  const staffUser: UserSeed = { login: 'staff1', passwordHash, role: 'STAFF' };
  const adminUser: UserSeed = { login: 'admin1', passwordHash, role: 'ADMIN' };
  const teacherUsers: UserSeed[] = teachers.map((teacher) => ({
    login: teacher.login,
    passwordHash,
    role: 'STAFF',
  }));
  const studentUsers: UserSeed[] = students.map((student) => ({ login: student.login, passwordHash, role: 'STUDENT' }));

  const allUsers: UserSeed[] = [...studentUsers, ...teacherUsers, staffUser, adminUser];

  // ---- Расписание: 2 недели вперёд от сегодня, 5-6 пар в будний день ----
  const scheduleEntries: ScheduleEntrySeed[] = [];

  GROUP_DEFS.forEach((groupDef, groupIndex) => {
    const institute = INSTITUTES[groupDef.instituteIndex];
    const faculty = institute?.name ?? '';
    const facultySubjects = subjectsByFaculty.get(faculty) ?? [];
    const facultyTeachers = teachersByFaculty.get(faculty) ?? [];
    const groupName = groupNameByInstitute.get(faculty);
    if (!groupName) return;

    for (let dayOffset = 1; dayOffset <= SCHEDULE_HORIZON_DAYS; dayOffset += 1) {
      const date = addDays(now, dayOffset);
      if (!isWeekday(date)) continue;

      const pairsCount = rng() < 0.5 ? 5 : 6;
      const slots = shuffled(rng, TIME_SLOTS).slice(0, pairsCount);
      slots.sort((a, b) => a.start.localeCompare(b.start));

      const subjectCounts = new Map<string, number>();

      slots.forEach((slot, slotIndex) => {
        const subject = facultySubjects[(dayOffset * pairsCount + slotIndex + groupIndex) % facultySubjects.length];
        if (!subject) return;
        const teacher = facultyTeachers[(dayOffset + slotIndex + groupIndex) % facultyTeachers.length];
        if (!teacher) return;

        const seen = subjectCounts.get(subject.code) ?? 0;
        subjectCounts.set(subject.code, seen + 1);

        let type: ScheduleType = 'LECTURE';
        if (seen === 1) type = rng() < 0.5 ? 'SEMINAR' : 'LAB';
        else if (seen > 1) type = rng() < 0.5 ? 'LAB' : 'SEMINAR';

        scheduleEntries.push({
          groupName,
          subjectCode: subject.code,
          teacherLogin: teacher.login,
          date: toDateKey(date),
          startTime: slot.start,
          endTime: slot.end,
          room: pick(rng, ROOMS),
          type,
          status: 'SCHEDULED',
          note: null,
          movedToDate: null,
          movedToRoom: null,
        });
      });
    }
  });

  // ---- Переносы и отмены (требование кейса) ----
  const totalEntries = scheduleEntries.length;
  const movedIndexes = [0.07, 0.23, 0.51].map((f) =>
    Math.min(totalEntries - 1, Math.floor(totalEntries * f)),
  );
  const cancelledIndexes = [0.13, 0.31, 0.62, 0.83].map((f) =>
    Math.min(totalEntries - 1, Math.floor(totalEntries * f)),
  );

  const uniqueIndexes = (indexes: number[]): number[] => [...new Set(indexes)];

  for (const index of uniqueIndexes(movedIndexes)) {
    const entry = scheduleEntries[index];
    if (!entry || entry.status !== 'SCHEDULED') continue;
    const original = new Date(`${entry.date}T00:00:00.000Z`);
    const movedToDate = nextWeekdayOnwards(original, 2, scheduleEnd);
    const movedToRoom = pick(
      rng,
      ROOMS.filter((room) => room !== entry.room),
    );
    scheduleEntries[index] = {
      ...entry,
      status: 'MOVED',
      note: MOVED_NOTE,
      movedToDate: toDateKey(movedToDate),
      movedToRoom,
    };
  }

  for (const index of uniqueIndexes(cancelledIndexes)) {
    const entry = scheduleEntries[index];
    if (!entry || entry.status !== 'SCHEDULED') continue;
    scheduleEntries[index] = {
      ...entry,
      status: 'CANCELLED',
      note: CANCELLED_REASONS[index % CANCELLED_REASONS.length] ?? CANCELLED_REASONS[0] ?? 'Отменено',
    };
  }

  // ---- Оценки: 2 семестра, 6-9 дисциплин, у student1 один незачёт ----
  const grades: GradeSeed[] = [];

  for (const student of students) {
    for (const range of SEMESTER_DATE_RANGES) {
      const facultySubjects = subjectsByFaculty.get(student.faculty) ?? [];
      const count = 6 + Math.floor(rng() * 4); // 6..9
      const chosen = shuffled(rng, facultySubjects).slice(0, count);
      const from = new Date(`${range.from}T00:00:00.000Z`);
      const to = new Date(`${range.to}T00:00:00.000Z`);
      const span = Math.round((to.getTime() - from.getTime()) / 86_400_000);

      chosen.forEach((subject) => {
        const roll = rng();
        let type: GradeType;
        let value: number | null = null;
        let passed: boolean | null = null;

        if (roll < 0.45) {
          type = 'EXAM';
          value = pick(rng, [5, 4, 4, 4, 3, 3]);
        } else if (roll < 0.75) {
          type = 'CREDIT';
          passed = true;
        } else {
          type = 'COURSEWORK';
          value = pick(rng, [5, 4, 4, 3]);
        }

        const date = addDays(from, Math.floor(rng() * span));

        grades.push({
          studentLogin: student.login,
          subjectCode: subject.code,
          value,
          passed,
          type,
          date: toDateKey(date),
          semester: range.semester,
        });
      });
    }
  }

  // У student1 — один незачёт (долг) во 2-м семестре, для наглядности.
  const student1 = students[0];
  if (student1) {
    const debt = grades.find(
      (grade) =>
        grade.studentLogin === student1.login &&
        grade.semester === 2 &&
        grade.type === 'CREDIT' &&
        grade.passed === true,
    );
    if (debt) {
      const index = grades.indexOf(debt);
      grades[index] = { ...debt, passed: false };
    }
  }

  // ---- Заявки: 1-3 на студента, разные типы и статусы ----
  const requests: RequestSeed[] = [];
  const statusCycle: RequestStatus[] = ['NEW', 'IN_PROGRESS', 'READY', 'REJECTED'];

  const REFERENCE_FORMS: Record<string, string>[] = [
    { purpose: 'в банк', semester: '2', delivery: 'Электронная' },
    { purpose: 'по месту требования работодателя', semester: '2', delivery: 'На бумажном носителе' },
    { purpose: 'для оформления проездного', semester: '2', delivery: 'Электронная' },
  ];

  const APPLICATION_FORMS: Record<string, string>[] = [
    { topic: 'Академический отпуск', reason: 'По состоянию здоровья' },
    {
      topic: 'Перевод на другую программу',
      program: '01.03.02 Прикладная математика и информатика',
    },
    { topic: 'Материальная помощь', reason: 'Тяжёлые семейные обстоятельства' },
    { topic: 'Повышенная стипендия', reason: 'Успехи в учёбе и науке' },
  ];

  students.forEach((student, studentIndex) => {
    const requestCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < requestCount; i += 1) {
      const type: RequestType = rng() < 0.6 ? 'REFERENCE' : 'APPLICATION';
      const status = statusCycle[(studentIndex + i) % statusCycle.length] ?? 'NEW';
      const formData = type === 'REFERENCE' ? pick(rng, REFERENCE_FORMS) : pick(rng, APPLICATION_FORMS);
      const createdAt = addDays(now, -(2 + Math.floor(rng() * 20)));
      let staffComment: string | null = null;
      if (status === 'IN_PROGRESS') staffComment = 'Принято в работу, ожидайте решения.';
      if (status === 'READY') {
        staffComment =
          type === 'REFERENCE'
            ? 'Справка готова. Заберите в деканате или скачайте в кабинете.'
            : 'Заявление рассмотрено и подписано.';
      }
      if (status === 'REJECTED') staffComment = 'Отказано: для решения нужны дополнительные документы.';

      requests.push({
        studentLogin: student.login,
        type,
        formData,
        status,
        staffComment,
        createdAt: toDateKey(createdAt),
      });
    }
  });

  // ---- Объявления ----
  const firstInstitute = INSTITUTES[0]?.name ?? null;
  const secondInstitute = INSTITUTES[1]?.name ?? null;
  const announcements: AnnouncementSeed[] = [
    {
      title: 'График сессии опубликован',
      body: 'Расписание экзаменов и зачётов зимней сессии доступно в разделе «Расписание». Консультации — с 10 декабря.',
      audience: 'ALL',
      faculty: null,
      groupName: null,
      pinned: true,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -3)),
    },
    {
      title: 'Изменение времени работы деканата',
      body: 'С 25 ноября деканат принимает документы до 18:00 по будням.',
      audience: 'ALL',
      faculty: null,
      groupName: null,
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -6)),
    },
    {
      title: 'День открытых дверей института',
      body: `Приглашаем школьников и абитуриентов ${UNIVERSITY_CITY}а: экскурсии по лабораториям и встречи с преподавателями.`,
      audience: 'FACULTY',
      faculty: firstInstitute,
      groupName: null,
      pinned: true,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -9)),
    },
    {
      title: 'Сдача курсовых работ',
      body: 'Курсовые работы принимаются до 30 ноября в электронном виде через кабинет.',
      audience: 'FACULTY',
      faculty: secondInstitute,
      groupName: null,
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -12)),
    },
    {
      title: 'Консультация перед экзаменом',
      body: 'Групповая консультация по базам данных — в субботу в 10:00, аудитория Л-201.',
      audience: 'GROUP',
      faculty: null,
      groupName: groupNameByDirectionShort.get('ПИ') ?? null,
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -1)),
    },
    {
      title: 'Экскурсия на предприятие',
      body: 'Организованная экскурсия для студентов 3 курса — сбор у главного входа в 09:00.',
      audience: 'GROUP',
      faculty: null,
      groupName: groupNameByDirectionShort.get('ЮР') ?? null,
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -2)),
    },
  ];

  // ---- Уведомления: 5-8 на студента, часть непрочитанных ----
  const notifications: NotificationSeed[] = [];

  const NOTIFICATION_TEMPLATES: readonly {
    type: NotificationType;
    title: string;
    body: string;
    link: string | null;
  }[] = [
    {
      type: 'SCHEDULE_CHANGE',
      title: 'Пара перенесена',
      body: 'Занятие перенесено: новая дата и аудитория указаны в расписании.',
      link: '/schedule',
    },
    {
      type: 'REQUEST_STATUS',
      title: 'Статус заявки обновлён',
      body: 'По вашей заявке есть изменения — проверьте раздел «Заявки».',
      link: '/requests',
    },
    {
      type: 'ANNOUNCEMENT',
      title: 'Объявление деканата',
      body: 'Опубликовано новое объявление. Откройте уведомления в кабинете.',
      link: '/',
    },
    {
      type: 'GRADE',
      title: 'Новая оценка',
      body: 'В ведомость добавлена оценка за семестр. Смотрите раздел «Успеваемость».',
      link: '/grades',
    },
    {
      type: 'DEADLINE',
      title: 'Приближается дедлайн',
      body: 'Срок сдачи курсовой работы — 30 ноября. Не забудьте загрузить работу.',
      link: '/schedule',
    },
    {
      type: 'SYSTEM',
      title: `Добро пожаловать в кабинет ${UNIVERSITY_SHORT_NAME}`,
      body: 'Ваш личный кабинет готов к работе: расписание, оценки и заявки в одном месте.',
      link: null,
    },
    {
      type: 'SCHEDULE_CHANGE',
      title: 'Занятие отменено',
      body: 'Одна из пар на этой неделе отменена — причина указана в расписании.',
      link: '/schedule',
    },
    {
      type: 'ANNOUNCEMENT',
      title: 'График сессии',
      body: 'Опубликован график экзаменов зимней сессии.',
      link: '/',
    },
  ];

  for (const student of students) {
    const count = 5 + Math.floor(rng() * 4); // 5..8
    const chosen = shuffled(rng, NOTIFICATION_TEMPLATES).slice(0, count);
    chosen.forEach((template, index) => {
      notifications.push({
        userLogin: student.login,
        type: template.type,
        title: template.title,
        body: template.body,
        read: index < count - 3,
        link: template.link,
        createdAt: toDateKey(addDays(now, -index)),
      });
    });
  }

  // ---- Аудит ----
  const auditEvents: AuditEventSeed[] = [
    ...students.slice(0, 3).map((student, index) => ({
      actorLogin: student.login,
      action: 'auth.login',
      entity: 'User',
      entityId: null,
      meta: { login: student.login },
      createdAt: toDateKey(addDays(now, -(1 + index))),
    })),
    {
      actorLogin: 'staff1',
      action: 'auth.login',
      entity: 'User',
      entityId: null,
      meta: { login: 'staff1' },
      createdAt: toDateKey(addDays(now, -1)),
    },
    {
      actorLogin: 'student1',
      action: 'request.create',
      entity: 'Request',
      entityId: null,
      meta: { type: 'REFERENCE' },
      createdAt: toDateKey(addDays(now, -4)),
    },
    {
      actorLogin: 'staff1',
      action: 'announcement.publish',
      entity: 'Announcement',
      entityId: null,
      meta: { audience: 'ALL' },
      createdAt: toDateKey(addDays(now, -3)),
    },
    {
      actorLogin: 'staff1',
      action: 'schedule.move',
      entity: 'ScheduleEntry',
      entityId: null,
      meta: { status: 'MOVED' },
      createdAt: toDateKey(addDays(now, -2)),
    },
    {
      actorLogin: 'staff1',
      action: 'verification.review',
      entity: 'StudentVerification',
      entityId: null,
      meta: { decision: 'VERIFIED' },
      createdAt: toDateKey(addDays(now, -2)),
    },
    {
      actorLogin: 'staff1',
      action: 'sick_leave.notify_deanery',
      entity: 'SickLeave',
      entityId: null,
      meta: { student: 'student2' },
      createdAt: toDateKey(now),
    },
  ];

  // ---- Синтетический реестр студбилетов ----
  // По записи на каждого студента + 2 «незарегистрированные» карточки
  // (одногруппники без учётной записи) — на них мок-сверка должна отвечать
  // «найдено в реестре, но заявка не ваша».
  /** Карточка одногруппника, у которого нет учётной записи в кабинете. */
  function unregisteredCard(
    directionShort: string,
    serial: string,
    lastName: string,
    firstName: string,
    middleName: string,
  ): IdentityRegistrySeed {
    const info = groupInfoByDirectionShort.get(directionShort);
    if (!info) {
      throw new Error(`Сидер: для незарегистрированной карточки не найдена группа ${directionShort}`);
    }
    return {
      cardNumber: `${directionShort}-${admissionYear(now, info.course)}-${serial}`,
      lastName,
      firstName,
      middleName,
      groupName: info.name,
      faculty: info.faculty,
      program: info.direction,
      course: info.course,
      issuedAt: toDateKey(addDays(now, -700)),
    };
  }

  const identityRegistry: IdentityRegistrySeed[] = [
    ...students.map((student) => ({
      cardNumber: student.studentCardNumber,
      lastName: student.lastName,
      firstName: student.firstName,
      middleName: student.middleName,
      groupName: student.groupName,
      faculty: student.faculty,
      program: student.direction,
      course: student.course,
      issuedAt: toDateKey(addDays(now, -700)),
    })),
    unregisteredCard('ПИ', '0777', 'Крылов', 'Артём', 'Олегович'),
    unregisteredCard('ЮР', '0888', 'Горохова', 'Дарья', 'Игоревна'),
  ];

  // ---- Заявки на верификацию студбилета ----
  const studentByLogin = new Map(students.map((student) => [student.login, student]));

  const verificationDefs: readonly {
    login: string;
    status: VerificationStatus;
    /** Группа, «распознанная» на фото; null — совпадает с группой студента. */
    recognizedGroupShort: string | null;
    matchScore: number | null;
    reviewerLogin: string | null;
    reviewComment: string | null;
    submittedDaysAgo: number;
    reviewedDaysAgo: number | null;
  }[] = [
    {
      login: 'student1',
      status: 'VERIFIED',
      recognizedGroupShort: null,
      matchScore: 1,
      reviewerLogin: 'staff1',
      reviewComment: null,
      submittedDaysAgo: 12,
      reviewedDaysAgo: 11,
    },
    {
      login: 'student4',
      status: 'VERIFIED',
      recognizedGroupShort: null,
      matchScore: 0.97,
      reviewerLogin: 'staff1',
      reviewComment: null,
      submittedDaysAgo: 9,
      reviewedDaysAgo: 8,
    },
    {
      login: 'student2',
      status: 'PENDING',
      recognizedGroupShort: null,
      matchScore: null,
      reviewerLogin: null,
      reviewComment: null,
      submittedDaysAgo: 1,
      reviewedDaysAgo: null,
    },
    {
      login: 'student3',
      status: 'REJECTED',
      recognizedGroupShort: 'БИ',
      matchScore: 0.61,
      reviewerLogin: 'staff1',
      reviewComment:
        'На фото указана другая группа — сверка не пройдена. Подайте заявку повторно с актуальным фото студбилета.',
      submittedDaysAgo: 6,
      reviewedDaysAgo: 5,
    },
  ];

  const studentVerifications: StudentVerificationSeed[] = verificationDefs.map((def) => {
    const student = studentByLogin.get(def.login);
    if (!student) {
      throw new Error(`Сидер: не найден студент для верификации ${def.login}`);
    }
    const recognizedGroupName =
      def.recognizedGroupShort === null
        ? student.groupName
        : groupNameByDirectionShort.get(def.recognizedGroupShort) ?? student.groupName;
    const submittedAt = toDateTimeKey(addMinutes(addDays(now, -def.submittedDaysAgo), 11 * 60 + 15));
    const reviewedAt =
      def.reviewedDaysAgo === null
        ? null
        : toDateTimeKey(addMinutes(addDays(now, -def.reviewedDaysAgo), 16 * 60 + 40));

    return {
      studentLogin: def.login,
      status: def.status,
      photoFileName: `${uuidFromRng(rng)}.jpg`,
      recognizedLastName: student.lastName,
      recognizedFirstName: student.firstName,
      recognizedGroupName,
      recognizedCardNumber: student.studentCardNumber,
      matchScore: def.matchScore,
      reviewerLogin: def.reviewerLogin,
      reviewComment: def.reviewComment,
      submittedAt,
      reviewedAt,
    };
  });

  // ---- OAuth-привязки (эмуляция VK ID / MAX / Telegram) ----
  const oauthAccounts: OAuthAccountSeed[] = [
    {
      userLogin: 'student1',
      provider: 'VK_ID',
      providerAccountId: 'vk_1000421',
      createdAt: toDateTimeKey(addDays(now, -30)),
    },
    {
      userLogin: 'student2',
      provider: 'TELEGRAM',
      providerAccountId: 'tg_7712093',
      createdAt: toDateTimeKey(addDays(now, -14)),
    },
  ];

  // ---- Эмуляция согласия OAuth: один использованный интент, один активный ----
  const exactNow = new Date();
  const consumedCreatedAt = atTime(addDays(now, -30), 10, 0);

  const oauthIntents: OAuthIntentSeed[] = [
    {
      state: uuidFromRng(rng),
      provider: 'VK_ID',
      login: 'student1',
      fullName: 'Иванов Александр Дмитриевич',
      groupName: groupNameByDirectionShort.get('ПИ') ?? null,
      purpose: 'login',
      expiresAt: toDateTimeKey(addMinutes(consumedCreatedAt, 180)),
      consumedAt: toDateTimeKey(addMinutes(consumedCreatedAt, 120)),
      createdAt: toDateTimeKey(consumedCreatedAt),
    },
    {
      state: uuidFromRng(rng),
      provider: 'TELEGRAM',
      login: null,
      fullName: 'Петрова Мария Андреевна',
      groupName: groupNameByDirectionShort.get('БИ') ?? null,
      purpose: 'register',
      expiresAt: toDateTimeKey(addMinutes(exactNow, 15)),
      consumedAt: null,
      createdAt: toDateTimeKey(exactNow),
    },
  ];

  // ---- Статусы «болею» ----
  const sickLeaves: SickLeaveSeed[] = [
    {
      studentLogin: 'student2',
      dateFrom: toDateKey(now),
      dateTo: toDateKey(addDays(now, 3)),
      reason: 'ОРВИ, температура',
      attachmentPath: null,
    },
    {
      studentLogin: 'student1',
      dateFrom: toDateKey(addDays(now, -12)),
      dateTo: toDateKey(addDays(now, -8)),
      reason: 'Грипп',
      attachmentPath: null,
    },
  ];

  // ---- Консультации и часы приёма: 2-3 на преподавателя у 6 преподавателей ----
  const officeHourDefs: readonly {
    teacherLogin: string;
    entries: readonly { weekday: number; start: string; end: string; type: OfficeHourType; note: string | null }[];
  }[] = [
    {
      teacherLogin: 'teacher1',
      entries: [
        { weekday: 2, start: '13:00', end: '14:00', type: 'CONSULTATION', note: 'Консультация по курсовому проекту' },
        { weekday: 4, start: '15:00', end: '16:00', type: 'RECEPTION', note: null },
      ],
    },
    {
      teacherLogin: 'teacher2',
      entries: [
        { weekday: 1, start: '10:00', end: '11:30', type: 'CONSULTATION', note: 'Подготовка к экзамену' },
        { weekday: 3, start: '12:00', end: '13:00', type: 'RECEPTION', note: null },
        { weekday: 5, start: '16:30', end: '17:50', type: 'EXTRA_CLASS', note: 'Отработка пропущенной лабораторной' },
      ],
    },
    {
      teacherLogin: 'teacher5',
      entries: [
        { weekday: 2, start: '11:40', end: '13:00', type: 'CONSULTATION', note: null },
        { weekday: 4, start: '13:30', end: '14:50', type: 'RECEPTION', note: null },
      ],
    },
    {
      teacherLogin: 'teacher7',
      entries: [
        { weekday: 1, start: '13:00', end: '14:00', type: 'RECEPTION', note: 'Приём по учебным вопросам' },
        { weekday: 5, start: '10:00', end: '11:20', type: 'CONSULTATION', note: null },
      ],
    },
    {
      teacherLogin: 'teacher9',
      entries: [
        { weekday: 3, start: '15:00', end: '16:20', type: 'CONSULTATION', note: null },
        { weekday: 5, start: '12:00', end: '13:00', type: 'RECEPTION', note: null },
      ],
    },
    {
      teacherLogin: 'teacher15',
      entries: [
        { weekday: 2, start: '14:00', end: '15:00', type: 'RECEPTION', note: null },
        { weekday: 4, start: '10:00', end: '11:20', type: 'EXTRA_CLASS', note: 'Отработка практики' },
      ],
    },
  ];

  const officeHours: OfficeHourSeed[] = officeHourDefs.flatMap((def) =>
    def.entries.map((entry) => ({
      teacherLogin: def.teacherLogin,
      weekday: entry.weekday,
      startTime: entry.start,
      endTime: entry.end,
      room: pick(rng, ROOMS),
      type: entry.type,
      note: entry.note,
    })),
  );

  return {
    users: allUsers,
    groups,
    subjects,
    teachers,
    students,
    scheduleEntries,
    grades,
    requests,
    announcements,
    notifications,
    auditEvents,
    identityRegistry,
    studentVerifications,
    oauthAccounts,
    oauthIntents,
    sickLeaves,
    officeHours,
  };
}

export const SEED_COUNTS = {
  institutes: INSTITUTES.length,
  students: STUDENT_DEFS.length,
  groups: GROUP_DEFS.length,
  subjects: SUBJECT_DEFS.reduce((sum, list) => sum + list.length, 0),
  teachers: TEACHER_DEFS.reduce((sum, list) => sum + list.length, 0),
  identityRegistry: STUDENT_DEFS.length + 2,
  officeHourTeachers: 6,
};
