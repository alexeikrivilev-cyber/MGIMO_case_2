import { SickLeaveScreen } from './sick-leave-screen';

/**
 * /sick-leave — статус «болею»: период, причина, необязательное фото
 * справки; история отметок. Преподаватели и деканат видят статус
 * (синтетический реестр прототипа).
 */
export default function SickLeavePage(): React.JSX.Element {
  return <SickLeaveScreen />;
}
