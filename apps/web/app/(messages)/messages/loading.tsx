import { PageSkeleton } from '../../../components/PageSkeleton';

/** Состояние загрузки переписки (streaming SSR + переходы). */
export default function Loading(): React.JSX.Element {
  return <PageSkeleton blocks={4} />;
}
