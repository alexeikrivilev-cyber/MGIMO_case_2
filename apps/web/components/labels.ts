/**
 * Метки статусов кабинета: единый словарь «код → текст».
 *
 * Требование Council и WCAG: статус кодируется ФОРМОЙ И ТЕКСТОМ, никогда
 * только цветом — поэтому все метки живут здесь и сопровождают бейджи.
 */
import type { RequestStatus, VerificationStatus } from '@udgu/db';

/** Статус верификации студбилета (включая «заявки не было»). */
export const VERIFICATION_STATUS_LABELS: Readonly<Record<VerificationStatus | 'NO_APPLICATION', string>> = {
  NO_APPLICATION: 'Заявка не подана',
  PENDING: 'На проверке',
  VERIFIED: 'Верифицирован',
  REJECTED: 'Отклонена',
};

/**
 * Чей ход по заявке (решение Council, PRD §8): статус из буквы
 * превращается в действие. NEW/IN_PROGRESS — заявка у сотрудника
 * деканата; READY/REJECTED — решение принято, дальше действует студент
 * (забрать результат или ознакомиться и подать заново).
 */
export function requestTurn(status: RequestStatus): 'student' | 'deanery' {
  return status === 'READY' || status === 'REJECTED' ? 'student' : 'deanery';
}

/** Метка «чей ход» для бейджа заявки. */
export function requestTurnLabel(status: RequestStatus): string {
  return requestTurn(status) === 'student' ? 'Ваш ход' : 'В деканате';
}

/** Тон бейджа по статусу заявки (цвет сопровождает текст, не заменяет). */
export function requestStatusTone(status: RequestStatus): 'neutral' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'NEW':
      return 'info';
    case 'IN_PROGRESS':
      return 'info';
    case 'READY':
      return 'success';
    case 'REJECTED':
      return 'danger';
  }
}

/** Тон бейджа по статусу верификации. */
export function verificationStatusTone(
  status: VerificationStatus | 'NO_APPLICATION',
): 'neutral' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'NO_APPLICATION':
      return 'neutral';
    case 'PENDING':
      return 'info';
    case 'VERIFIED':
      return 'success';
    case 'REJECTED':
      return 'danger';
  }
}

/** Подписи полей формы заявки (formData приходит свободным объектом). */
export const REQUEST_FIELD_LABELS: Readonly<Record<string, string>> = {
  purpose: 'Цель справки',
  delivery: 'Способ получения',
  semester: 'Семестр',
  topic: 'Тема заявления',
  reason: 'Причина',
  body: 'Текст заявления',
  program: 'Программа',
};

/** Подпись поля формы: известный ключ — человекочитаемо, иной — как есть. */
export function requestFieldLabel(key: string): string {
  return REQUEST_FIELD_LABELS[key] ?? key;
}

/** Семестры для выбора в форме справки (бакалавриат УдГУ — 8 семестров). */
export const SEMESTER_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
