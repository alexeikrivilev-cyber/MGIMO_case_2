/**
 * Экран «Переписка» (BRIEF v2 §4). Два режима по роли сессии:
 *
 * - студент: список диалогов с преподавателями + переписка; кнопка
 *   «Написать преподавателю» открывает диалог из справочника.
 *   Неверифицированному студенту загрузчик возвращает
 *   verification-required, и страница показывает честную заглушку гейта
 *   со ссылкой на /verification — не 500 и не пустой экран;
 * - преподаватель: список диалогов, где ему пишут; в каждом видно ФИО и
 *   ГРУППУ автора — иначе преподаватель не понимает, кто пишет;
 * - сотрудник деканата и админ: перепиской не пользуются, страница
 *   объясняет это и ведёт в их разделы.
 *
 * Отправка сообщения, отметка о прочтении и создание диалога — клиентские
 * острова; список и сообщения рендерит сервер из packages/core.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Card, EmptyState, LinkButton, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { formatMoment } from '../../../components/format';
import { FOCUS_RING } from '../../../lib/ui';
import {
  loadMessagesPageData,
  type LoadResult,
  type MessagesPageData,
} from '../../../lib/page-data';
import { MessageComposer } from './MessageComposer';
import { ConversationReadMarker } from './ConversationReadMarker';
import { NewConversationForm } from './NewConversationForm';
import type { ConversationDetail, ConversationListItem } from '@udgu/core';

/** Диалог в списке: собеседник, последнее сообщение, непрочитанные. */
function ConversationRow({
  conversation,
  active,
  peerLabel,
}: {
  conversation: ConversationListItem;
  active: boolean;
  /** Чей это диалог: «Преподаватель»/«Студент» — подпись в списке. */
  peerLabel: string;
}): React.JSX.Element {
  return (
    <li>
      <Link
        href={`/messages?conversation=${encodeURIComponent(conversation.id)}`}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-xl border bg-surface px-4 py-3 shadow-sm transition-colors hover:bg-surface-2 ${FOCUS_RING} ${
          active ? 'border-primary/50' : 'border-border'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text">{conversation.peer.fullName}</span>
            {conversation.peer.groupName === null ? null : (
              <span className="text-xs text-text-muted">группа {conversation.peer.groupName}</span>
            )}
            {conversation.unreadCount > 0 ? (
              <StatusBadge tone="info">{conversation.unreadCount} новых</StatusBadge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {conversation.lastMessage === null
              ? `${peerLabel}: сообщений пока нет`
              : `${conversation.lastMessage.mine ? 'Вы' : peerLabel}: ${conversation.lastMessage.body}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Панель открытого диалога: сообщения, отметка о прочтении, ответ. */
function ConversationPanel({
  detail,
  mode,
}: {
  detail: ConversationDetail;
  mode: 'student' | 'teacher';
}): React.JSX.Element {
  const peerLabel = mode === 'student' ? 'Преподаватель' : 'Студент';

  return (
    <Card className="mt-4" data-testid="conversation-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-text">{detail.peer.fullName}</h2>
        {detail.peer.groupName === null ? null : (
          <StatusBadge tone="neutral">Группа {detail.peer.groupName}</StatusBadge>
        )}
        {detail.unreadCount > 0 ? <StatusBadge tone="info">{detail.unreadCount} новых</StatusBadge> : null}
      </div>
      {mode === 'student' && detail.peer.department !== null ? (
        <p className="mt-0.5 text-xs text-text-muted">
          {detail.peer.position ?? ''}
          {detail.peer.position === null || detail.peer.position === '' ? '' : ' · '}
          {detail.peer.department}
        </p>
      ) : null}

      <div className="mt-3">
        <ConversationReadMarker conversationId={detail.id} unreadCount={detail.unreadCount} />
      </div>

      {detail.messages.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          Сообщений пока нет. Напишите первое — {peerLabel.toLowerCase()} получит уведомление и ответит здесь.
        </p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="conversation-messages">
          {detail.messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-md px-3 py-2 text-sm ${
                message.mine ? 'ml-8 bg-primary-soft text-text' : 'mr-8 bg-surface-2 text-text'
              }`}
            >
              <span className="block text-xs text-text-muted">
                {message.mine ? 'Вы' : detail.peer.fullName} · {formatMoment(new Date(message.createdAt))}
                {message.mine && message.readAt !== null ? ' · прочитано' : ''}
              </span>
              <span className="mt-0.5 block whitespace-pre-line">{message.body}</span>
            </li>
          ))}
        </ul>
      )}

      <MessageComposer conversationId={detail.id} peerName={detail.peer.fullName} />
    </Card>
  );
}

export function MessagesView({ result }: { result: LoadResult<MessagesPageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        if (data.mode === 'none') {
          return (
            <>
              <PageHeader title="Переписка" subtitle="Диалоги с преподавателями" />
              <Card>
                <h2 className="text-base font-semibold text-text">Раздел для студентов и преподавателей</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Переписка связывает студента с преподавателем: преподаватель видит ФИО и группу автора,
                  поэтому писать могут только верифицированные студенты. Учётной записи сотрудника деканата в
                  переписке нет — ваши инструменты в кабинете деканата.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LinkButton href="/staff" variant="primary">
                    Кабинет деканата
                  </LinkButton>
                  <LinkButton href="/" variant="secondary">
                    Личный кабинет
                  </LinkButton>
                </div>
              </Card>
            </>
          );
        }

        const isStudent = data.mode === 'student';
        const peerLabel = isStudent ? 'Преподаватель' : 'Студент';
        const active = data.active?.ok === true ? data.active.value : null;
        const activeError = data.active !== null && !data.active.ok ? data.active.error : null;
        return (
          <>
            <PageHeader
              title="Переписка"
              subtitle={
                isStudent
                  ? 'Диалоги с преподавателями — после верификации студбилета'
                  : 'Диалоги со студентами: видно ФИО и группу автора'
              }
            />

            {isStudent ? (
              <Card className="mb-4">
                <h2 className="text-sm font-semibold text-text">Написать преподавателю</h2>
                <p className="mt-1 text-xs text-text-muted">
                  Выберите преподавателя из справочника: откроется диалог с историей переписки. Повторный выбор
                  того же преподавателя вернёт тот же диалог.
                </p>
                <div className="mt-3">
                  <NewConversationForm teachers={data.teachers} />
                </div>
              </Card>
            ) : null}

            <section aria-labelledby="messages-list">
              <h2 id="messages-list" className="mb-2 text-base font-semibold text-text">
                {isStudent ? 'Мои диалоги' : 'Диалоги со студентами'}
              </h2>
              {data.conversations.length === 0 ? (
                <EmptyState
                  title={isStudent ? 'Диалогов пока нет' : 'Студенты ещё не писали'}
                  description={
                    isStudent
                      ? 'Нажмите «Написать преподавателю» выше и выберите преподавателя: диалог появится здесь, а ответ придёт уведомлением.'
                      : 'Когда верифицированный студент напишет вам, диалог появится здесь: с ФИО, группой и историей сообщений.'
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {data.conversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={active?.id === conversation.id}
                      peerLabel={peerLabel}
                    />
                  ))}
                </ul>
              )}
            </section>

            {activeError === null ? null : (
              <Card className="mt-4" data-testid="conversation-error">
                <h2 className="text-base font-semibold text-text">Диалог недоступен</h2>
                <p className="mt-1 text-sm text-text-muted">
                  Этот диалог не принадлежит вашей учётной записи: переписка видна только её участникам.
                  Выберите диалог из списка выше.
                </p>
              </Card>
            )}

            {active === null ? null : <ConversationPanel detail={active} mode={data.mode} />}
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function MessagesScreen({
  conversationId,
}: {
  conversationId: string | undefined;
}): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadMessagesPageData(cookieStore.toString(), conversationId);
  return <MessagesView result={result} />;
}
