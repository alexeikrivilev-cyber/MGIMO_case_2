import { DashboardScreen } from '../dashboard-screen';

/**
 * «Сегодня» по адресу /dashboard — цель редиректа после входа
 * (POST /api/auth/login возвращает redirectTo по роли). Экран тот же,
 * что и на «/»: один компонент, два адреса.
 */
export default function DashboardPage(): React.JSX.Element {
  return <DashboardScreen />;
}
