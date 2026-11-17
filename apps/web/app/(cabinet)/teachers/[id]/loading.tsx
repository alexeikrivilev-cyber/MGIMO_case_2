import { PageSkeleton } from '../../../../components/PageSkeleton';

/** Состояние загрузки экрана (streaming SSR + переходы по ссылкам). */
export default function Loading(): React.JSX.Element {
  return <PageSkeleton />;
}
