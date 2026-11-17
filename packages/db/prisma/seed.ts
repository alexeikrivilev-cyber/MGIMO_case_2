/**
 * Сидер базы Удмуртского государственного университета (УдГУ).
 *
 * Запуск: npm run db:seed (в packages/db) или npm run db:seed из корня.
 * Пишет все сущности из buildSeedData(); перед записью очищает таблицы
 * в порядке, безопасном для FK, поэтому сидер идемпотентен.
 * Файлы приватного хранилища (фото студбилетов, учебные планы) тоже
 * пересоздаются: старые чистятся, новые пишутся по путям из БД.
 * Все данные вымышленные.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { buildSeedData, SYNTHETIC_ID_CARD_JPEG_BASE64 } from '../src/seed-data.js';
import { getPrisma, Prisma } from '../src/client.js';
import {
  idCardPhotoRelativePath,
  idCardRoot,
  storageRoot,
  studyPlanRelativePath,
  studyPlanRoot,
} from '@udgu/core';

const configDir = path.dirname(fileURLToPath(import.meta.url));

function loadRootEnv(): void {
  const envPath = path.resolve(configDir, '../../.env');
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env отсутствует — переменные должны прийти из окружения.
  }
}

loadRootEnv();

const prisma = getPrisma();

async function cleanDatabase(): Promise<void> {
  // Порядок: сначала зависимые таблицы, затем родительские.
  await prisma.auditEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.session.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.request.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.scheduleEntry.deleteMany();
  await prisma.studentVerification.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.oAuthIntent.deleteMany();
  await prisma.sickLeave.deleteMany();
  await prisma.officeHour.deleteMany();
  await prisma.identityRegistry.deleteMany();
  // Переписка: сообщения ссылаются на диалог И на автора (User),
  // поэтому чистим до удаления студентов, преподавателей и пользователей.
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  // Учебные планы ссылаются на преподавателя — чистим до преподавателей.
  await prisma.studyPlan.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateTime(value: string): Date {
  return new Date(value);
}

/**
 * Пишет синтетическое фото студбилета в ПРИВАТНОЕ хранилище
 * (storage/, вне webroot) по относительному пути из БД.
 *
 * Каталоги создаются при необходимости: повторный сидер пишет тот же
 * файл заново (идемпотентность), поэтому ошибку «каталог есть» не
 * проверяем.
 */
function writeIdCardPhoto(relativePath: string): void {
  const absolutePath = path.join(storageRoot(), relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, Buffer.from(SYNTHETIC_ID_CARD_JPEG_BASE64, 'base64'));
}

/**
 * Убирает прошлые фото студбилетов: идентификаторы студентов при каждом
 * сидере новые (UUID из БД), поэтому без очистки в хранилище копились бы
 * файлы, на которые не ссылается ни одна запись.
 *
 * Удаляются ТОЛЬКО подкаталоги студентов — служебный .gitkeep (он держит
 * каталог в репозитории) остаётся на месте, как и всё остальное хранилище.
 * Каталог создаётся при отсутствии: на свежем хранилище (новый volume,
 * тестовый STORAGE_DIR) readdirSync иначе упал бы на ENOENT.
 */
function cleanIdCardStorage(): void {
  mkdirSync(idCardRoot(), { recursive: true });
  for (const entry of readdirSync(idCardRoot(), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      rmSync(path.join(idCardRoot(), entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Убирает прошлые учебные планы преподавателей — по той же причине, что
 * и фото студбилетов: преподаватели при каждом сидере новые (UUID), и
 * файлы прошлого плана стали бы мусором без ссылки из БД.
 *
 * Каталог study-plans может отсутствовать (первый сидер): создаём его,
 * затем удаляем подкаталоги преподавателей. Служебный .gitkeep остаётся.
 */
function cleanStudyPlanStorage(): void {
  mkdirSync(studyPlanRoot(), { recursive: true });
  for (const entry of readdirSync(studyPlanRoot(), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      rmSync(path.join(studyPlanRoot(), entry.name), { recursive: true, force: true });
    }
  }
}

/**
 * Пишет учебный план преподавателя в ПРИВАТНОЕ хранилище
 * (storage/study-plans/<teacherId>/, вне webroot) по относительному пути
 * из БД — публичных ссылок на план не существует.
 *
 * Каталоги создаются при необходимости: повторный сидер пишет файл
 * заново (идемпотентность), поэтому ошибку «каталог есть» не проверяем.
 */
function writeStudyPlanFile(relativePath: string, text: string): void {
  const absolutePath = path.join(storageRoot(), relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, Buffer.from(text, 'utf8'));
}

async function main(): Promise<void> {
  await cleanDatabase();
  cleanIdCardStorage();
  cleanStudyPlanStorage();

  const data = await buildSeedData();

  await prisma.user.createMany({
    data: data.users.map((user) => ({
      login: user.login,
      passwordHash: user.passwordHash,
      role: user.role,
      faculty: user.faculty,
    })),
  });

  const userIdByLogin = new Map(
    (await prisma.user.findMany({ select: { id: true, login: true } })).map((user) => [
      user.login,
      user.id,
    ]),
  );

  await prisma.group.createMany({
    data: data.groups.map((group) => ({
      name: group.name,
      faculty: group.faculty,
      course: group.course,
      direction: group.direction,
    })),
  });

  const groupIdByName = new Map(
    (await prisma.group.findMany({ select: { id: true, name: true } })).map((group) => [
      group.name,
      group.id,
    ]),
  );

  await prisma.subject.createMany({
    data: data.subjects.map((subject) => ({
      code: subject.code,
      name: subject.name,
      faculty: subject.faculty,
    })),
  });

  const subjectIdByCode = new Map(
    (await prisma.subject.findMany({ select: { id: true, code: true } })).map((subject) => [
      subject.code,
      subject.id,
    ]),
  );

  await prisma.teacher.createMany({
    data: data.teachers.map((teacher) => {
      const userId = userIdByLogin.get(teacher.login);
      if (!userId) throw new Error(`Сидер: не найден пользователь для преподавателя ${teacher.login}`);
      return {
        userId,
        lastName: teacher.lastName,
        firstName: teacher.firstName,
        middleName: teacher.middleName,
        department: teacher.department,
        position: teacher.position,
      };
    }),
  });

  const teacherIdByLogin = new Map(
    (
      await prisma.teacher.findMany({
        select: { id: true, user: { select: { login: true } } },
      })
    ).map((teacher) => [teacher.user.login, teacher.id]),
  );

  await prisma.student.createMany({
    data: data.students.map((student) => {
      const userId = userIdByLogin.get(student.login);
      const groupId = groupIdByName.get(student.groupName);
      if (!userId) throw new Error(`Сидер: не найден пользователь для студента ${student.login}`);
      if (!groupId) throw new Error(`Сидер: не найдена группа ${student.groupName}`);
      return {
        userId,
        lastName: student.lastName,
        firstName: student.firstName,
        middleName: student.middleName,
        faculty: student.faculty,
        direction: student.direction,
        course: student.course,
        groupId,
        email: student.email,
        studentCardNumber: student.studentCardNumber,
        phone: student.phone,
      };
    }),
  });

  const studentIdByLogin = new Map(
    (
      await prisma.student.findMany({
        select: { id: true, user: { select: { login: true } } },
      })
    ).map((student) => [student.user.login, student.id]),
  );

  await prisma.scheduleEntry.createMany({
    data: data.scheduleEntries.map((entry) => {
      const groupId = groupIdByName.get(entry.groupName);
      const subjectId = subjectIdByCode.get(entry.subjectCode);
      const teacherId = teacherIdByLogin.get(entry.teacherLogin);
      if (!groupId) throw new Error(`Сидер: не найдена группа ${entry.groupName}`);
      if (!subjectId) throw new Error(`Сидер: не найден предмет ${entry.subjectCode}`);
      if (!teacherId) throw new Error(`Сидер: не найден преподаватель ${entry.teacherLogin}`);
      return {
        groupId,
        subjectId,
        teacherId,
        date: toDate(entry.date),
        startTime: entry.startTime,
        endTime: entry.endTime,
        room: entry.room,
        type: entry.type,
        status: entry.status,
        note: entry.note,
        movedToDate: entry.movedToDate ? toDate(entry.movedToDate) : null,
        movedToRoom: entry.movedToRoom,
      };
    }),
  });

  await prisma.grade.createMany({
    data: data.grades.map((grade) => {
      const studentId = studentIdByLogin.get(grade.studentLogin);
      const subjectId = subjectIdByCode.get(grade.subjectCode);
      if (!studentId) throw new Error(`Сидер: не найден студент ${grade.studentLogin}`);
      if (!subjectId) throw new Error(`Сидер: не найден предмет ${grade.subjectCode}`);
      return {
        studentId,
        subjectId,
        value: grade.value,
        passed: grade.passed,
        type: grade.type,
        date: toDate(grade.date),
        semester: grade.semester,
      };
    }),
  });

  await prisma.request.createMany({
    data: data.requests.map((request) => {
      const studentId = studentIdByLogin.get(request.studentLogin);
      if (!studentId) throw new Error(`Сидер: не найден студент ${request.studentLogin}`);
      return {
        studentId,
        type: request.type,
        formData: request.formData,
        status: request.status,
        staffComment: request.staffComment,
        createdAt: toDate(request.createdAt),
      };
    }),
  });

  await prisma.announcement.createMany({
    data: data.announcements.map((announcement) => {
      const authorId = userIdByLogin.get(announcement.authorLogin);
      if (!authorId) throw new Error(`Сидер: не найден автор ${announcement.authorLogin}`);
      return {
        title: announcement.title,
        body: announcement.body,
        audience: announcement.audience,
        faculty: announcement.faculty,
        groupId: announcement.groupName ? groupIdByName.get(announcement.groupName) ?? null : null,
        pinned: announcement.pinned,
        authorId,
        publishedAt: toDate(announcement.publishedAt),
      };
    }),
  });

  await prisma.notification.createMany({
    data: data.notifications.map((notification) => {
      const userId = userIdByLogin.get(notification.userLogin);
      if (!userId) throw new Error(`Сидер: не найден пользователь ${notification.userLogin}`);
      return {
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        read: notification.read,
        link: notification.link,
        createdAt: toDate(notification.createdAt),
      };
    }),
  });

  await prisma.auditEvent.createMany({
    data: data.auditEvents.map((event) => {
      const actorUserId = userIdByLogin.get(event.actorLogin);
      if (!actorUserId) throw new Error(`Сидер: не найден актор ${event.actorLogin}`);
      return {
        actorUserId,
        action: event.action,
        entity: event.entity,
        entityId: event.entityId,
        meta: event.meta === null ? Prisma.JsonNull : event.meta,
        createdAt: toDate(event.createdAt),
      };
    }),
  });

  // ---- Синтетический реестр студбилетов ----
  await prisma.identityRegistry.createMany({
    data: data.identityRegistry.map((entry) => {
      const groupId = groupIdByName.get(entry.groupName);
      if (!groupId) throw new Error(`Сидер: не найдена группа ${entry.groupName}`);
      return {
        cardNumber: entry.cardNumber,
        lastName: entry.lastName,
        firstName: entry.firstName,
        middleName: entry.middleName,
        groupId,
        faculty: entry.faculty,
        program: entry.program,
        course: entry.course,
        issuedAt: toDate(entry.issuedAt),
      };
    }),
  });

  // ---- Заявки на верификацию студбилета ----
  // Каждой заявке нужно фото в приватном хранилище: иначе очередь
  // верификаций в кабинете сотрудника показывала бы ошибку вместо
  // изображения (роут /api/staff/verifications/[id]/photo читает файл).
  await prisma.studentVerification.createMany({
    data: data.studentVerifications.map((verification) => {
      const studentId = studentIdByLogin.get(verification.studentLogin);
      if (!studentId) throw new Error(`Сидер: не найден студент ${verification.studentLogin}`);
      const reviewerId = verification.reviewerLogin
        ? userIdByLogin.get(verification.reviewerLogin) ?? null
        : null;
      if (verification.reviewerLogin && !reviewerId) {
        throw new Error(`Сидер: не найден проверяющий ${verification.reviewerLogin}`);
      }
      const photoPath = idCardPhotoRelativePath(studentId, verification.photoFileName);
      writeIdCardPhoto(photoPath);
      return {
        studentId,
        status: verification.status,
        idCardPhotoPath: photoPath,
        recognizedLastName: verification.recognizedLastName,
        recognizedFirstName: verification.recognizedFirstName,
        recognizedGroupName: verification.recognizedGroupName,
        recognizedCardNumber: verification.recognizedCardNumber,
        matchScore: verification.matchScore,
        reviewerId,
        reviewComment: verification.reviewComment,
        submittedAt: toDateTime(verification.submittedAt),
        reviewedAt: verification.reviewedAt === null ? null : toDateTime(verification.reviewedAt),
      };
    }),
  });

  // ---- OAuth-привязки и эмуляция согласия ----
  await prisma.oAuthAccount.createMany({
    data: data.oauthAccounts.map((account) => {
      const userId = userIdByLogin.get(account.userLogin);
      if (!userId) throw new Error(`Сидер: не найден пользователь ${account.userLogin}`);
      return {
        userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        createdAt: toDateTime(account.createdAt),
      };
    }),
  });

  await prisma.oAuthIntent.createMany({
    data: data.oauthIntents.map((intent) => ({
      state: intent.state,
      provider: intent.provider,
      login: intent.login,
      fullName: intent.fullName,
      groupName: intent.groupName,
      purpose: intent.purpose,
      expiresAt: toDateTime(intent.expiresAt),
      consumedAt: intent.consumedAt === null ? null : toDateTime(intent.consumedAt),
      createdAt: toDateTime(intent.createdAt),
    })),
  });

  // ---- Статусы «болею» ----
  await prisma.sickLeave.createMany({
    data: data.sickLeaves.map((leave) => {
      const studentId = studentIdByLogin.get(leave.studentLogin);
      if (!studentId) throw new Error(`Сидер: не найден студент ${leave.studentLogin}`);
      return {
        studentId,
        dateFrom: toDate(leave.dateFrom),
        dateTo: toDate(leave.dateTo),
        reason: leave.reason,
        attachmentPath: leave.attachmentPath,
      };
    }),
  });

  // ---- Консультации и часы приёма преподавателей ----
  await prisma.officeHour.createMany({
    data: data.officeHours.map((hour) => {
      const teacherId = teacherIdByLogin.get(hour.teacherLogin);
      if (!teacherId) throw new Error(`Сидер: не найден преподаватель ${hour.teacherLogin}`);
      return {
        teacherId,
        weekday: hour.weekday,
        startTime: hour.startTime,
        endTime: hour.endTime,
        room: hour.room,
        type: hour.type,
        note: hour.note,
      };
    }),
  });

  // ---- Учебные планы преподавателей (демо RAG-ассистента, BRIEF v2 §5) ----
  // Каждому плану нужен файл в приватном хранилище: ассистент
  // преподавателя читает текст по storagePath, публичных ссылок нет.
  await prisma.studyPlan.createMany({
    data: data.studyPlans.map((plan) => {
      const teacherId = teacherIdByLogin.get(plan.teacherLogin);
      if (!teacherId) throw new Error(`Сидер: не найден преподаватель ${plan.teacherLogin} для учебного плана`);
      const storagePath = studyPlanRelativePath(teacherId, `${randomUUID()}.md`);
      writeStudyPlanFile(storagePath, plan.text);
      return {
        teacherId,
        title: plan.title,
        fileName: plan.fileName,
        mime: plan.mime,
        sizeBytes: Buffer.byteLength(plan.text, 'utf8'),
        storagePath,
      };
    }),
  });

  // ---- Переписка студент ↔ преподаватель ----
  // Диалог создаётся парой (студент, преподаватель) — она уникальна,
  // поэтому повторный сидер не плодит копии. Сообщения пишутся по одному
  // (нужен authorUserId и порядок createdAt).
  for (const conversation of data.conversations) {
    const studentId = studentIdByLogin.get(conversation.studentLogin);
    const teacherId = teacherIdByLogin.get(conversation.teacherLogin);
    if (!studentId) throw new Error(`Сидер: не найден студент ${conversation.studentLogin}`);
    if (!teacherId) throw new Error(`Сидер: не найден преподаватель ${conversation.teacherLogin}`);

    const created = await prisma.conversation.create({
      data: { studentId, teacherId },
      select: { id: true },
    });

    for (const message of conversation.messages) {
      const authorId = userIdByLogin.get(message.authorLogin);
      if (!authorId) throw new Error(`Сидер: не найден автор сообщения ${message.authorLogin}`);
      const createdAt = new Date(Date.now() - message.minutesAgo * 60_000);
      await prisma.message.create({
        data: {
          conversationId: created.id,
          authorUserId: authorId,
          body: message.body,
          createdAt,
          readAt: message.read ? new Date(createdAt.getTime() + 60_000) : null,
        },
      });
    }

    // updatedAt диалога = время последнего сообщения: список сортируется по нему.
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (lastMessage) {
      await prisma.conversation.update({
        where: { id: created.id },
        data: { updatedAt: new Date(Date.now() - lastMessage.minutesAgo * 60_000) },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    groups: await prisma.group.count(),
    subjects: await prisma.subject.count(),
    teachers: await prisma.teacher.count(),
    students: await prisma.student.count(),
    scheduleEntries: await prisma.scheduleEntry.count(),
    scheduleMoved: await prisma.scheduleEntry.count({ where: { status: 'MOVED' } }),
    scheduleCancelled: await prisma.scheduleEntry.count({ where: { status: 'CANCELLED' } }),
    grades: await prisma.grade.count(),
    requests: await prisma.request.count(),
    announcements: await prisma.announcement.count(),
    notifications: await prisma.notification.count(),
    auditEvents: await prisma.auditEvent.count(),
    identityRegistry: await prisma.identityRegistry.count(),
    studentVerifications: await prisma.studentVerification.count(),
    oauthAccounts: await prisma.oAuthAccount.count(),
    oauthIntents: await prisma.oAuthIntent.count(),
    sickLeaves: await prisma.sickLeave.count(),
    officeHours: await prisma.officeHour.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
    studyPlans: await prisma.studyPlan.count(),
  };

  console.log('Сидер завершён. Записей в базе:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table}: ${count}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('Сидер упал:', error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
