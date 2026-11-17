import { ConceptMark } from '../../components/ConceptMark';
import { Card, LinkButton } from '../../components/ui';

/**
 * 404 внутри кабинета: например, преподаватель по неизвестному
 * идентификатору. Объясняем, что случилось, и даём путь назад —
 * требование кейса к пустым состояниям и ошибкам.
 */
export default function CabinetNotFound(): React.JSX.Element {
  return (
    <Card className="mt-6 text-center">
      <ConceptMark className="mx-auto h-10 w-10 text-primary" />
      <h1 className="mt-3 text-lg font-semibold text-text">Страница не найдена</h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
        Возможно, ссылка устарела или запись удалена. Вернитесь на главный экран — оттуда есть путь в
        любой раздел кабинета.
      </p>
      <div className="mt-4 flex justify-center">
        <LinkButton href="/" variant="primary">
          На главный экран
        </LinkButton>
      </div>
    </Card>
  );
}
