import { StaffAnnouncementsScreen } from './announcements-screen';

/**
 * /staff/announcements — публикация объявлений деканата и список уже
 * опубликованных (свои и те, что видит сотрудник института).
 */
export default async function StaffAnnouncementsPage(): Promise<React.JSX.Element> {
  return <StaffAnnouncementsScreen />;
}
