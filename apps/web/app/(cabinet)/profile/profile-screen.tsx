/**
 * Экран «Профиль»: ФИО, институт, направление, курс, группа, email,
 * номер зачётки, статус верификации, аватар-инициалы, выход.
 *
 * Профиль доступен всегда, в том числе до верификации (BRIEF v2):
 * «до верификации студент видит свой профиль, расписание своей группы
 * и общедоступную информацию».
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Avatar, Card, StatusBadge } from '../../../components/ui';
import { PageHeader } from '../../../components/PageHeader';
import { PageResult } from '../../../components/PageStates';
import { LogoutButton } from '../../../components/LogoutButton';
import { VERIFICATION_STATUS_LABELS, verificationStatusTone } from '../../../components/labels';
import { loadProfilePageData, type LoadResult, type ProfilePageData } from '../../../lib/page-data';
import { FOCUS_RING, TEXT_LINK_CLASS } from '../../../lib/ui';

function ProfileRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-40 shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-text">{value}</dd>
    </div>
  );
}

export function ProfileView({ result }: { result: LoadResult<ProfilePageData> }): React.JSX.Element {
  return (
    <PageResult result={result}>
      {(data) => {
        const { profile } = data;
        return (
          <>
            <PageHeader title="Профиль" />

            <Card className="mb-4">
              <div className="flex items-center gap-4">
                <Avatar initials={profile.avatarInitials} size="lg" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-text">{profile.fullName}</p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {profile.groupName} · {profile.course} курс
                  </p>
                  <div className="mt-2">
                    <Link
                      href="/verification"
                      className={`inline-flex min-h-6 items-center rounded-md ${FOCUS_RING}`}
                    >
                      <StatusBadge tone={verificationStatusTone(profile.verificationStatus)}>
                        {VERIFICATION_STATUS_LABELS[profile.verificationStatus]}
                      </StatusBadge>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <dl>
                <ProfileRow label="Институт" value={profile.faculty} />
                <ProfileRow label="Направление" value={profile.direction} />
                <ProfileRow label="Курс" value={String(profile.course)} />
                <ProfileRow label="Группа" value={profile.groupName} />
                <ProfileRow label="Email" value={profile.email} />
                <ProfileRow label="Номер зачётки" value={profile.studentCardNumber} />
                {profile.phone === null ? null : <ProfileRow label="Телефон" value={profile.phone} />}
                <ProfileRow
                  label="Статус верификации"
                  value={VERIFICATION_STATUS_LABELS[profile.verificationStatus]}
                />
              </dl>
              {profile.verificationStatus === 'VERIFIED' ? null : (
                <p className="mt-3 text-sm text-text-muted">
                  Оценки и переписка откроются после верификации.{' '}
                  <Link href="/verification" className={TEXT_LINK_CLASS}>
                    Верифицировать
                  </Link>
                </p>
              )}
            </Card>

            <div className="mt-4">
              <LogoutButton label="Выйти из кабинета" fullWidth />
            </div>
          </>
        );
      }}
    </PageResult>
  );
}

/** Серверная обёртка: cookie → данные → вид. */
export async function ProfileScreen(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const result = await loadProfilePageData(cookieStore.toString());
  return <ProfileView result={result} />;
}
