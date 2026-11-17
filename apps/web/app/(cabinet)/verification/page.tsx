import { VerificationScreen } from './verification-screen';

/**
 * /verification — заявка на верификацию студбилета: фото в приватное
 * хранилище, мок-распознавание и сверка с реестром университета
 * (packages/core). Гейт доступа к оценкам живёт на сервере.
 */
export default function VerificationPage(): React.JSX.Element {
  return <VerificationScreen />;
}
