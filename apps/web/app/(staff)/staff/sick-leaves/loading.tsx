import { PageSkeleton } from '../../../../components/PageSkeleton';

/** Состояние загрузки списка болезней (streaming SSR + переходы). */
export default function Loading(): React.JSX.Element {
  return <PageSkeleton blocks={3} />;
}
