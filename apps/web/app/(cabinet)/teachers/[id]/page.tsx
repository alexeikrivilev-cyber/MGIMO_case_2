import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { TeacherCardView } from './teacher-card-screen';
import { loadTeacherCardData } from '../../../../lib/page-data';

/**
 * /teachers/[id] — карточка преподавателя: расписание на две недели и
 * часы приёма. Неизвестный идентификатор → честный 404 (страница
 * «не найдена» кабинета), а не пустой экран.
 */
export default async function TeacherCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const cookieStore = await cookies();
  const result = await loadTeacherCardData(cookieStore.toString(), id);

  if (!result.ok && result.error.kind === 'not-found') {
    notFound();
  }

  return <TeacherCardView result={result} />;
}
