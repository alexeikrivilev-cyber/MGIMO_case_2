import { StaffDashboardScreen } from './dashboard-screen';

/**
 * /staff — сводка кабинета сотрудника деканата: счётчики очередей его
 * института и быстрые ссылки на разделы. Данные грузит сервер
 * (lib/page-data → packages/core getStaffDashboard): faculty берётся из
 * сессии, поэтому сотрудник не может увидеть чужие очереди.
 */
export default async function StaffDashboardPage(): Promise<React.JSX.Element> {
  return <StaffDashboardScreen />;
}
