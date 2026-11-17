import { DashboardScreen } from './dashboard-screen';

/**
 * «Сегодня» — главный экран кабинета (адрес «/»).
 *
 * Роут существует и на «/dashboard»: на него ведёт ответ входа
 * (redirectTo роли STUDENT), а нижняя навигация указывает на «/» —
 * один экран, два адреса, без дублирования кода.
 */
export default function TodayPage(): React.JSX.Element {
  return <DashboardScreen />;
}
