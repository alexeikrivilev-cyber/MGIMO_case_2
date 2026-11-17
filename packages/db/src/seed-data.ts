/**
 * Генератор синтетических данных Университета «Горизонт».
 *
 * Чистая функция без обращений к БД: строит все сущности сидера в памяти.
 * Благодаря этому инварианты данных проверяются в тестах (test/seed.test.ts)
 * без подключения к PostgreSQL, а запись в БД живёт в prisma/seed.ts.
 *
 * Все данные вымышленные. Пароль тестовых аккаунтов — фикстура сидера,
 * в продакшене пароли задаются только через переменные окружения.
 */
import { hash as argon2Hash } from 'argon2';

export const TEST_PASSWORD = 'password123';

export interface FacultyDef {
  readonly short: string;
  readonly name: string;
  readonly directions: readonly string[];
}

export const FACULTIES: readonly FacultyDef[] = [
  {
    short: 'ИТ',
    name: 'Факультет информационных технологий',
    directions: ['Программная инженерия', 'Прикладная информатика'],
  },
  {
    short: 'ЭК',
    name: 'Экономический факультет',
    directions: ['Экономика', 'Менеджмент'],
  },
  {
    short: 'ИН',
    name: 'Инженерный факультет',
    directions: ['Робототехника', 'Энергетика'],
  },
  {
    short: 'ГУ',
    name: 'Гуманитарный факультет',
    directions: ['Лингвистика', 'Психология'],
  },
];

interface SubjectDef {
  readonly code: string;
  readonly name: string;
  readonly faculty: string;
}

const SUBJECT_DEFS: readonly Omit<SubjectDef, 'faculty'>[][] = [
  [
    { code: 'ИТ-101', name: 'Алгоритмы и структуры данных' },
    { code: 'ИТ-102', name: 'Базы данных' },
    { code: 'ИТ-103', name: 'Операционные системы' },
    { code: 'ИТ-104', name: 'Веб-технологии' },
    { code: 'ИТ-105', name: 'Компьютерные сети' },
    { code: 'ИТ-106', name: 'Дискретная математика' },
    { code: 'ИТ-107', name: 'Программирование на Python' },
    { code: 'ИТ-108', name: 'Архитектура ЭВМ' },
    { code: 'ИТ-109', name: 'Иностранный язык' },
    { code: 'ИТ-110', name: 'Математический анализ' },
  ],
  [
    { code: 'ЭК-201', name: 'Микроэкономика' },
    { code: 'ЭК-202', name: 'Макроэкономика' },
    { code: 'ЭК-203', name: 'Бухгалтерский учёт' },
    { code: 'ЭК-204', name: 'Статистика' },
    { code: 'ЭК-205', name: 'Финансовый менеджмент' },
    { code: 'ЭК-206', name: 'Маркетинг' },
    { code: 'ЭК-207', name: 'Экономическая теория' },
    { code: 'ЭК-208', name: 'Информационные технологии в экономике' },
    { code: 'ЭК-209', name: 'Иностранный язык' },
    { code: 'ЭК-210', name: 'Высшая математика' },
  ],
  [
    { code: 'ИН-301', name: 'Теоретическая механика' },
    { code: 'ИН-302', name: 'Сопротивление материалов' },
    { code: 'ИН-303', name: 'Электротехника' },
    { code: 'ИН-304', name: 'Термодинамика' },
    { code: 'ИН-305', name: 'Машиностроительное черчение' },
    { code: 'ИН-306', name: 'Автоматизация производства' },
    { code: 'ИН-307', name: 'Робототехника' },
    { code: 'ИН-308', name: 'Материаловедение' },
    { code: 'ИН-309', name: 'Иностранный язык' },
    { code: 'ИН-310', name: 'Физика' },
  ],
  [
    { code: 'ГУ-401', name: 'Лингвистика' },
    { code: 'ГУ-402', name: 'Культурология' },
    { code: 'ГУ-403', name: 'Психология общения' },
    { code: 'ГУ-404', name: 'Философия' },
    { code: 'ГУ-405', name: 'Риторика' },
    { code: 'ГУ-406', name: 'Социология' },
    { code: 'ГУ-407', name: 'История России' },
    { code: 'ГУ-408', name: 'Логика' },
    { code: 'ГУ-409', name: 'Иностранный язык' },
    { code: 'ГУ-410', name: 'Правоведение' },
  ],
];

interface TeacherDef {
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string;
  readonly department: string;
  readonly position: string;
}

const TEACHER_DEFS: readonly TeacherDef[][] = [
  [
    { lastName: 'Соколов', firstName: 'Андрей', middleName: 'Викторович', department: 'Кафедра программной инженерии', position: 'Доцент' },
    { lastName: 'Лебедева', firstName: 'Ольга', middleName: 'Петровна', department: 'Кафедра информационных систем', position: 'Профессор' },
    { lastName: 'Кузнецов', firstName: 'Денис', middleName: 'Игоревич', department: 'Кафедра прикладной математики', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Морозова', firstName: 'Елена', middleName: 'Сергеевна', department: 'Кафедра экономики', position: 'Доцент' },
    { lastName: 'Волков', firstName: 'Игорь', middleName: 'Николаевич', department: 'Кафедра финансов', position: 'Профессор' },
    { lastName: 'Никитина', firstName: 'Татьяна', middleName: 'Юрьевна', department: 'Кафедра менеджмента', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Зайцев', firstName: 'Павел', middleName: 'Романович', department: 'Кафедра робототехники', position: 'Доцент' },
    { lastName: 'Орлова', firstName: 'Марина', middleName: 'Львовна', department: 'Кафедра энергетики', position: 'Профессор' },
    { lastName: 'Белов', firstName: 'Артём', middleName: 'Олегович', department: 'Кафедра машиностроения', position: 'Старший преподаватель' },
  ],
  [
    { lastName: 'Романова', firstName: 'Ирина', middleName: 'Викторовна', department: 'Кафедра лингвистики', position: 'Доцент' },
    { lastName: 'Гусев', firstName: 'Виктор', middleName: 'Александрович', department: 'Кафедра философии', position: 'Профессор' },
    { lastName: 'Крылова', firstName: 'Светлана', middleName: 'Дмитриевна', department: 'Кафедра психологии', position: 'Старший преподаватель' },
  ],
];

interface GroupDef {
  readonly name: string;
  readonly facultyShort: string;
  readonly course: number;
  readonly direction: string;
}

const GROUP_DEFS: readonly GroupDef[] = [
  { name: 'ИТ-21-1', facultyShort: 'ИТ', course: 2, direction: 'Программная инженерия' },
  { name: 'ИТ-21-2', facultyShort: 'ИТ', course: 2, direction: 'Прикладная информатика' },
  { name: 'ЭК-22-1', facultyShort: 'ЭК', course: 2, direction: 'Экономика' },
  { name: 'ЭК-22-2', facultyShort: 'ЭК', course: 2, direction: 'Менеджмент' },
  { name: 'ИН-20-1', facultyShort: 'ИН', course: 1, direction: 'Робототехника' },
  { name: 'ИН-20-2', facultyShort: 'ИН', course: 1, direction: 'Энергетика' },
  { name: 'ГУ-23-1', facultyShort: 'ГУ', course: 3, direction: 'Лингвистика' },
  { name: 'ГУ-23-2', facultyShort: 'ГУ', course: 3, direction: 'Психология' },
];

interface StudentDef {
  readonly login: string;
  readonly group: string;
  readonly facultyShort: string;
  readonly direction: string;
  readonly course: number;
  readonly lastName: string;
  readonly firstName: string;
  readonly middleName: string;
}

const STUDENT_DEFS: readonly StudentDef[] = [
  { login: 'student1', group: 'ИТ-21-1', facultyShort: 'ИТ', direction: 'Программная инженерия', course: 2, lastName: 'Иванов', firstName: 'Александр', middleName: 'Дмитриевич' },
  { login: 'student2', group: 'ЭК-22-1', facultyShort: 'ЭК', direction: 'Экономика', course: 2, lastName: 'Петрова', firstName: 'Мария', middleName: 'Андреевна' },
  { login: 'student3', group: 'ИТ-21-2', facultyShort: 'ИТ', direction: 'Прикладная информатика', course: 2, lastName: 'Смирнов', firstName: 'Никита', middleName: 'Иванович' },
  { login: 'student4', group: 'ИН-20-1', facultyShort: 'ИН', direction: 'Робототехника', course: 1, lastName: 'Кузнецова', firstName: 'Анна', middleName: 'Сергеевна' },
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

const ROOMS: readonly string[] = [
  'А-101', 'А-204', 'А-311', 'А-418',
  'Б-202', 'Б-315',
  'В-107', 'В-210',
  'Л-201', 'Л-305',
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

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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

  const facultyNameByShort = new Map(FACULTIES.map((f) => [f.short, f.name]));

  const groups: GroupSeed[] = GROUP_DEFS.map((g) => ({
    name: g.name,
    faculty: facultyNameByShort.get(g.facultyShort) ?? g.facultyShort,
    course: g.course,
    direction: g.direction,
  }));

  const subjects: SubjectSeed[] = FACULTIES.flatMap((faculty, index) =>
    (SUBJECT_DEFS[index] ?? []).map((s) => ({ ...s, faculty: faculty.name })),
  );

  const subjectsByFaculty = new Map<string, SubjectSeed[]>();
  for (const subject of subjects) {
    const list = subjectsByFaculty.get(subject.faculty) ?? [];
    list.push(subject);
    subjectsByFaculty.set(subject.faculty, list);
  }

  const teachers: TeacherSeed[] = TEACHER_DEFS.flatMap((facultyTeachers, index) =>
    facultyTeachers.map((t, teacherIndex) => ({
      login: `teacher${index * 3 + teacherIndex + 1}`,
      lastName: t.lastName,
      firstName: t.firstName,
      middleName: t.middleName,
      department: t.department,
      position: t.position,
    })),
  );

  const teachersByFaculty = new Map<string, TeacherSeed[]>();
  TEACHER_DEFS.forEach((facultyTeachers, index) => {
    const faculty = FACULTIES[index]?.name;
    if (!faculty) return;
    const list: TeacherSeed[] = [];
    facultyTeachers.forEach((_, teacherIndex) => {
      const teacher = teachers[index * 3 + teacherIndex];
      if (teacher) list.push(teacher);
    });
    teachersByFaculty.set(faculty, list);
  });

  const students: StudentSeed[] = STUDENT_DEFS.map((def, index) => {
    const cardIndex = String(100 + index * 7).padStart(3, '0');
    const phoneIndex = String(100 + index * 37).padStart(3, '0');
    return {
      login: def.login,
      lastName: def.lastName,
      firstName: def.firstName,
      middleName: def.middleName,
      faculty: facultyNameByShort.get(def.facultyShort) ?? def.facultyShort,
      direction: def.direction,
      course: def.course,
      groupName: def.group,
      email: `${def.login}@horizon-university.ru`,
      studentCardNumber: `HZ-${def.facultyShort}-2026-${cardIndex}`,
      phone: def.login === 'student2' ? null : `+7 (900) ${phoneIndex}-${String(20 + index * 11).padStart(2, '0')}-${String(10 + index * 5).padStart(2, '0')}`,
    };
  });

  const staffUser: UserSeed = { login: 'staff1', passwordHash, role: 'STAFF' };
  const adminUser: UserSeed = { login: 'admin1', passwordHash, role: 'ADMIN' };
  const teacherUsers: UserSeed[] = teachers.map((t) => ({ login: t.login, passwordHash, role: 'STAFF' }));
  const studentUsers: UserSeed[] = students.map((s) => ({ login: s.login, passwordHash, role: 'STUDENT' }));

  const allUsers: UserSeed[] = [...studentUsers, ...teacherUsers, staffUser, adminUser];

  // ---- Расписание: 2 недели вперёд от сегодня, 5-6 пар в будний день ----
  const scheduleEntries: ScheduleEntrySeed[] = [];

  GROUP_DEFS.forEach((groupDef, groupIndex) => {
    const faculty = facultyNameByShort.get(groupDef.facultyShort) ?? groupDef.facultyShort;
    const facultySubjects = subjectsByFaculty.get(faculty) ?? [];
    const facultyTeachers = teachersByFaculty.get(faculty) ?? [];

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
          groupName: groupDef.name,
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

      chosen.forEach((subject, subjectIndex) => {
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
      (g) =>
        g.studentLogin === student1.login &&
        g.semester === 2 &&
        g.type === 'CREDIT' &&
        g.passed === true,
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
    { topic: 'Перевод на другую программу', program: 'Прикладная информатика' },
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

  // ---- Объявления: 4-6 штук, разные аудитории, 2 закреплённых ----
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
      title: 'День открытых дверей факультета',
      body: 'Приглашаем школьников и абитуриентов: экскурсии по лабораториям и встречи с преподавателями.',
      audience: 'FACULTY',
      faculty: FACULTIES[0]?.name ?? null,
      groupName: null,
      pinned: true,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -9)),
    },
    {
      title: 'Сдача курсовых работ',
      body: 'Курсовые работы принимаются до 30 ноября в электронном виде через кабинет.',
      audience: 'FACULTY',
      faculty: FACULTIES[1]?.name ?? null,
      groupName: null,
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -12)),
    },
    {
      title: 'Консультация перед экзаменом',
      body: 'Групповая консультация по базам данных — в субботу в 10:00, аудитория Б-202.',
      audience: 'GROUP',
      faculty: null,
      groupName: 'ИТ-21-1',
      pinned: false,
      authorLogin: 'staff1',
      publishedAt: toDateKey(addDays(now, -1)),
    },
    {
      title: 'Экскурсия на предприятие',
      body: 'Организованная экскурсия для 1 курса — сбор у главного входа в 09:00.',
      audience: 'GROUP',
      faculty: null,
      groupName: 'ИН-20-1',
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
      title: 'Добро пожаловать в «Горизонт»',
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
  ];

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
  };
}

export const SEED_COUNTS = {
  students: STUDENT_DEFS.length,
  groups: GROUP_DEFS.length,
  subjects: SUBJECT_DEFS.reduce((sum, list) => sum + list.length, 0),
  teachers: TEACHER_DEFS.reduce((sum, list) => sum + list.length, 0),
};
