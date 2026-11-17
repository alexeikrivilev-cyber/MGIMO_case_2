import { randomBytes } from "node:crypto";

import "../src/env";
import { hash } from "@node-rs/argon2";
import { prisma } from "../src/client";
import type {
  Audience,
  GradeType,
  Group,
  LessonType,
  NotificationType,
  ScheduleStatus,
  Student,
  Subject,
  Teacher,
  User,
} from "../src/generated/prisma/client";

const PASSWORD = "password123";

const SLOTS: ReadonlyArray<{ start: string; end: string }> = [
  { start: "09:00", end: "10:30" },
  { start: "10:45", end: "12:15" },
  { start: "13:00", end: "14:30" },
  { start: "14:45", end: "16:15" },
];

const LESSON_TYPES: readonly LessonType[] = ["LECTURE", "SEMINAR", "LAB"];

const utc = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const scheduleHorizon = addDays(today, 14);

const weekdays: Date[] = [];
for (let day = new Date(today); day <= scheduleHorizon; day = addDays(day, 1)) {
  const weekday = day.getUTCDay();
  if (weekday !== 0 && weekday !== 6) {
    weekdays.push(new Date(day));
  }
}

type GroupSeed = {
  name: string;
  faculty: string;
  course: number;
  direction: string;
  subjectCodes: string[];
  roomPrefix: string;
};

const groupSeeds: GroupSeed[] = [
  {
    name: "ИТ-21-1",
    faculty: "ФИТ",
    course: 3,
    direction: "Информатика и вычислительная техника",
    subjectCodes: ["ПИ-301", "БД-302", "ВТ-303"],
    roomPrefix: "А",
  },
  {
    name: "ИТ-21-2",
    faculty: "ФИТ",
    course: 3,
    direction: "Информатика и вычислительная техника",
    subjectCodes: ["ПИ-301", "БД-302", "ВТ-303"],
    roomPrefix: "А",
  },
  {
    name: "ЭК-22-1",
    faculty: "ЭФ",
    course: 2,
    direction: "Экономика",
    subjectCodes: ["МЭ-201", "ЭЦ-202", "ФИ-203"],
    roomPrefix: "Б",
  },
  {
    name: "ИН-20-1",
    faculty: "ИФ",
    course: 4,
    direction: "Строительство",
    subjectCodes: ["СМ-401", "ТС-403"],
    roomPrefix: "В",
  },
];

type SubjectSeed = {
  code: string;
  name: string;
  teacherIndex: number;
  gradeType: GradeType;
};

const subjectSeeds: SubjectSeed[] = [
  { code: "ПИ-301", name: "Программная инженерия", teacherIndex: 0, gradeType: "EXAM" },
  { code: "БД-302", name: "Базы данных", teacherIndex: 1, gradeType: "EXAM" },
  { code: "ВТ-303", name: "Веб-технологии", teacherIndex: 1, gradeType: "PASS" },
  { code: "МЭ-201", name: "Микроэкономика", teacherIndex: 2, gradeType: "EXAM" },
  { code: "ЭЦ-202", name: "Эконометрика", teacherIndex: 2, gradeType: "EXAM" },
  { code: "ФИ-203", name: "Финансы и кредит", teacherIndex: 2, gradeType: "PASS" },
  { code: "СМ-401", name: "Сопротивление материалов", teacherIndex: 3, gradeType: "EXAM" },
  { code: "ТС-403", name: "Технология строительства", teacherIndex: 3, gradeType: "COURSEWORK" },
];

const teacherSeeds = [
  {
    fullName: "Волкова Ирина Сергеевна",
    department: "Кафедра программной инженерии",
    position: "Доцент",
  },
  {
    fullName: "Ким Дмитрий Александрович",
    department: "Кафедра информационных технологий",
    position: "Профессор",
  },
  {
    fullName: "Романова Ольга Николаевна",
    department: "Кафедра экономической теории",
    position: "Доцент",
  },
  {
    fullName: "Ли Сергей Викторович",
    department: "Кафедра строительных конструкций",
    position: "Старший преподаватель",
  },
];

type StudentSeed = {
  login: string;
  fullName: string;
  group: string;
  email: string;
  recordBookNumber: string;
  semester1: string[];
  semester2: string[];
};

const studentSeeds: StudentSeed[] = [
  {
    login: "student1",
    fullName: "Иванов Алексей Дмитриевич",
    group: "ИТ-21-1",
    email: "i.a.ivanov@horizon.example",
    recordBookNumber: "ГЗ-2021-0143",
    semester1: ["5", "5", "ЗАЧЁТ"],
    semester2: ["5", "5", "ЗАЧЁТ"],
  },
  {
    login: "student2",
    fullName: "Петрова Мария Андреевна",
    group: "ЭК-22-1",
    email: "m.a.petrova@horizon.example",
    recordBookNumber: "ГЗ-2022-0087",
    semester1: ["4", "4", "ЗАЧЁТ"],
    semester2: ["5", "4", "ЗАЧЁТ"],
  },
  {
    login: "student3",
    fullName: "Смирнов Никита Игоревич",
    group: "ИТ-21-2",
    email: "n.i.smirnov@horizon.example",
    recordBookNumber: "ГЗ-2021-0156",
    semester1: ["4", "3", "ЗАЧЁТ"],
    semester2: ["3", "4", "ЗАЧЁТ"],
  },
  {
    login: "student4",
    fullName: "Кузнецова Анна Сергеевна",
    group: "ИН-20-1",
    email: "a.s.kuznetsova@horizon.example",
    recordBookNumber: "ГЗ-2020-0032",
    semester1: ["3", "4"],
    semester2: ["2", "3"],
  },
];

async function main(): Promise<void> {
  await prisma.auditEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.request.deleteMany();
  await prisma.scheduleEntry.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hash(PASSWORD);

  const groups = new Map<string, Group>();
  for (const seed of groupSeeds) {
    const group = await prisma.group.create({
      data: {
        name: seed.name,
        faculty: seed.faculty,
        course: seed.course,
        direction: seed.direction,
      },
    });
    groups.set(group.name, group);
  }

  const subjects = new Map<string, Subject>();
  for (const seed of subjectSeeds) {
    const subject = await prisma.subject.create({
      data: { name: seed.name, code: seed.code },
    });
    subjects.set(subject.code, subject);
  }

  const teachers: Teacher[] = [];
  for (const seed of teacherSeeds) {
    teachers.push(
      await prisma.teacher.create({
        data: {
          fullName: seed.fullName,
          department: seed.department,
          position: seed.position,
        },
      }),
    );
  }

  const staff = await prisma.user.create({
    data: { login: "staff1", passwordHash, role: "STAFF" },
  });

  const studentUsers: User[] = [];
  for (const seed of studentSeeds) {
    studentUsers.push(
      await prisma.user.create({
        data: { login: seed.login, passwordHash, role: "STUDENT" },
      }),
    );
  }

  const students: Student[] = [];
  for (const [index, seed] of studentSeeds.entries()) {
    const group = groups.get(seed.group);
    if (!group) {
      throw new Error(`Неизвестная группа: ${seed.group}`);
    }
    students.push(
      await prisma.student.create({
        data: {
          fullName: seed.fullName,
          faculty: group.faculty,
          direction: group.direction,
          course: group.course,
          email: seed.email,
          recordBookNumber: seed.recordBookNumber,
          group: { connect: { id: group.id } },
          user: { connect: { id: studentUsers[index].id } },
        },
      }),
    );
  }

  type ScheduleDraft = {
    groupName: string;
    subjectCode: string;
    teacherIndex: number;
    date: Date;
    startTime: string;
    endTime: string;
    room: string;
    type: LessonType;
    status: ScheduleStatus;
    note: string | null;
  };

  const scheduleDrafts: ScheduleDraft[] = [];
  const occurrences = new Map<string, number>();

  for (const groupSeed of groupSeeds) {
    for (const [dayIndex, day] of weekdays.entries()) {
      const weekday = day.getUTCDay();
      const lessonsCount = weekday === 1 || weekday === 3 ? 4 : 3;

      for (let slotIndex = 0; slotIndex < lessonsCount; slotIndex += 1) {
        const subjectCode =
          groupSeed.subjectCodes[(dayIndex + slotIndex) % groupSeed.subjectCodes.length];
        const subjectSeed = subjectSeeds.find((item) => item.code === subjectCode);
        if (!subjectSeed) {
          throw new Error(`Неизвестный предмет: ${subjectCode}`);
        }

        const occurrenceKey = `${groupSeed.name}:${subjectCode}`;
        const occurrence = occurrences.get(occurrenceKey) ?? 0;
        occurrences.set(occurrenceKey, occurrence + 1);

        const slot = SLOTS[slotIndex];
        const draft: ScheduleDraft = {
          groupName: groupSeed.name,
          subjectCode,
          teacherIndex: subjectSeed.teacherIndex,
          date: new Date(day),
          startTime: slot.start,
          endTime: slot.end,
          room: `${groupSeed.roomPrefix}-${101 + (dayIndex % 3) * 40 + slotIndex * 7}`,
          type: LESSON_TYPES[occurrence % LESSON_TYPES.length],
          status: "SCHEDULED",
          note: null,
        };

        if (groupSeed.name === "ИТ-21-1" && dayIndex === 2 && slotIndex === 2) {
          draft.status = "MOVED";
          draft.startTime = "18:00";
          draft.endTime = "19:30";
          draft.room = "А-210";
          draft.note =
            "Перенесено с 13:00 (преподаватель на конференции), аудитория изменена на А-210";
        }

        if (
          groupSeed.name === "ИТ-21-2" &&
          dayIndex === weekdays.length - 1 &&
          slotIndex === 0
        ) {
          draft.status = "CANCELLED";
          draft.note = "Занятие отменено: болезнь преподавателя";
        }

        scheduleDrafts.push(draft);
      }
    }
  }

  await prisma.scheduleEntry.createMany({
    data: scheduleDrafts.map((draft) => {
      const group = groups.get(draft.groupName);
      const subject = subjects.get(draft.subjectCode);
      if (!group || !subject) {
        throw new Error("Для пары не найдена группа или предмет");
      }
      return {
        groupId: group.id,
        subjectId: subject.id,
        teacherId: teachers[draft.teacherIndex].id,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        room: draft.room,
        type: draft.type,
        status: draft.status,
        note: draft.note,
      };
    }),
  });

  const semesterPlans = [
    { semester: 1, baseDate: utc(2026, 9, 22), stepDays: 10 },
    { semester: 2, baseDate: utc(2026, 2, 16), stepDays: 14 },
  ];

  for (const [index, seed] of studentSeeds.entries()) {
    const groupSeed = groupSeeds.find((item) => item.name === seed.group);
    if (!groupSeed) {
      throw new Error(`Неизвестная группа: ${seed.group}`);
    }
    const student = students[index];
    const values = [seed.semester1, seed.semester2];

    for (const [semesterIndex, plan] of semesterPlans.entries()) {
      for (const [subjectIndex, subjectCode] of groupSeed.subjectCodes.entries()) {
        const subject = subjects.get(subjectCode);
        const subjectSeed = subjectSeeds.find((item) => item.code === subjectCode);
        if (!subject || !subjectSeed) {
          throw new Error(`Неизвестный предмет: ${subjectCode}`);
        }
        await prisma.grade.create({
          data: {
            studentId: student.id,
            subjectId: subject.id,
            value: values[semesterIndex][subjectIndex],
            type: subjectSeed.gradeType,
            date: addDays(plan.baseDate, subjectIndex * plan.stepDays),
            semester: plan.semester,
          },
        });
      }
    }
  }

  const requests = await Promise.all([
    prisma.request.create({
      data: {
        student: { connect: { id: students[0].id } },
        type: "CERTIFICATE",
        formData: {
          purpose: "По месту требования (банк)",
          copies: 2,
          language: "Русский",
          delivery: "На электронную почту",
        },
        status: "NEW",
        createdAt: addDays(now, -2),
      },
    }),
    prisma.request.create({
      data: {
        student: { connect: { id: students[1].id } },
        type: "APPLICATION",
        formData: {
          topic: "Материальная помощь",
          reason: "Тяжёлое материальное положение",
          period: "Ноябрь 2026",
        },
        status: "IN_PROGRESS",
        comment: "Документы получены и проверены. Решение ожидается до 25 ноября 2026 года.",
        createdAt: addDays(now, -7),
        updatedAt: addDays(now, -1),
      },
    }),
  ]);

  type AnnouncementSeed = {
    title: string;
    body: string;
    audience: Audience;
    faculty: string | null;
    groupId: string | null;
    pinned: boolean;
    authorId: string;
    createdAt: Date;
  };

  const announcementSeeds: AnnouncementSeed[] = [
    {
      title: "Экзаменационная сессия: расписание опубликовано",
      body: "Расписание экзаменов зимней сессии 2026/2027 доступно в личном кабинете. При накладках обратитесь к куратору до 5 декабря 2026 года.",
      audience: "ALL",
      faculty: null,
      groupId: null,
      pinned: true,
      authorId: staff.id,
      createdAt: addDays(now, -3),
    },
    {
      title: "Открыт набор на факультатив «Машинное обучение»",
      body: "Занятия по средам в 18:00, аудитория А-210. Запись — до 25 ноября 2026 года.",
      audience: "FACULTY",
      faculty: "ФИТ",
      groupId: null,
      pinned: false,
      authorId: staff.id,
      createdAt: addDays(now, -5),
    },
    {
      title: "Перенос занятия по базам данных",
      body: "Занятие группы ИТ-21-1 по дисциплине «Базы данных» перенесено на 18:00, аудитория А-210.",
      audience: "GROUP",
      faculty: null,
      groupId: groups.get("ИТ-21-1")?.id ?? null,
      pinned: false,
      authorId: staff.id,
      createdAt: addDays(now, -1),
    },
  ];

  const announcements = [];
  for (const seed of announcementSeeds) {
    announcements.push(await prisma.announcement.create({ data: seed }));
  }

  const notificationSeeds: Array<{
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    read: boolean;
    link: string | null;
    createdAt: Date;
  }> = [
    {
      userId: studentUsers[0].id,
      type: "SCHEDULE_CHANGE",
      title: "Изменение в расписании",
      body: "Пара «Базы данных» 20 ноября перенесена на 18:00, аудитория А-210.",
      read: false,
      link: "/schedule",
      createdAt: addDays(now, -1),
    },
    {
      userId: studentUsers[0].id,
      type: "GRADE",
      title: "Новая оценка",
      body: "По дисциплине «Базы данных» за 1 семестр выставлена оценка 5.",
      read: true,
      link: "/grades",
      createdAt: addDays(now, -6),
    },
    {
      userId: studentUsers[1].id,
      type: "ANNOUNCEMENT",
      title: "Новое объявление деканата",
      body: "Расписание экзаменационной сессии опубликовано в личном кабинете.",
      read: false,
      link: "/announcements",
      createdAt: addDays(now, -3),
    },
    {
      userId: studentUsers[1].id,
      type: "REQUEST_STATUS",
      title: "Статус заявки обновлён",
      body: "Заявление «Материальная помощь» взято в работу.",
      read: true,
      link: "/requests",
      createdAt: addDays(now, -1),
    },
    {
      userId: studentUsers[2].id,
      type: "ANNOUNCEMENT",
      title: "Объявление для вашей группы",
      body: "Проверьте расписание на ближайшие две недели.",
      read: false,
      link: "/announcements",
      createdAt: addDays(now, -2),
    },
    {
      userId: studentUsers[3].id,
      type: "GRADE",
      title: "Новая оценка",
      body: "По дисциплине «Сопротивление материалов» за 2 семестр выставлена оценка 3.",
      read: false,
      link: "/grades",
      createdAt: addDays(now, -4),
    },
    {
      userId: staff.id,
      type: "SYSTEM",
      title: "Новая заявка",
      body: "Иванов А. Д. подал заявку: справка об обучении.",
      read: false,
      link: "/staff/requests",
      createdAt: addDays(now, -2),
    },
  ];

  await prisma.notification.createMany({ data: notificationSeeds });

  await prisma.session.create({
    data: {
      userId: studentUsers[0].id,
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: addDays(now, 7),
      createdAt: now,
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        actorId: studentUsers[0].id,
        action: "LOGIN",
        entity: "User",
        entityId: studentUsers[0].id,
        meta: { ip: "203.0.113.42" },
        createdAt: addDays(now, -1),
      },
      {
        actorId: staff.id,
        action: "REQUEST_STATUS_CHANGED",
        entity: "Request",
        entityId: requests[1].id,
        meta: { from: "NEW", to: "IN_PROGRESS" },
        createdAt: addDays(now, -1),
      },
      {
        actorId: staff.id,
        action: "ANNOUNCEMENT_CREATED",
        entity: "Announcement",
        entityId: announcements[2].id,
        meta: { audience: "GROUP", group: "ИТ-21-1" },
        createdAt: addDays(now, -1),
      },
    ],
  });

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.student.count(),
    prisma.teacher.count(),
    prisma.subject.count(),
    prisma.group.count(),
    prisma.scheduleEntry.count(),
    prisma.grade.count(),
    prisma.request.count(),
    prisma.announcement.count(),
    prisma.notification.count(),
    prisma.session.count(),
    prisma.auditEvent.count(),
  ]);

  console.log("Сидер выполнен. Университет «Горизонт», все данные вымышленные.");
  console.table({
    users: counts[0],
    students: counts[1],
    teachers: counts[2],
    subjects: counts[3],
    groups: counts[4],
    scheduleEntries: counts[5],
    grades: counts[6],
    requests: counts[7],
    announcements: counts[8],
    notifications: counts[9],
    sessions: counts[10],
    auditEvents: counts[11],
  });
}

main()
  .catch((error) => {
    console.error("Сидер упал:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
