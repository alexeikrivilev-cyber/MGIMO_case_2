import type { ReactNode } from 'react';
import { ConceptBanner } from '../../components/ConceptBanner';
import { ConceptMark } from '../../components/ConceptMark';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Atlas } from './Atlas';
import styles from './access.module.css';

export default function AuthLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <div className={styles.notice}><ConceptBanner /></div>
      <header className={styles.masthead}>
        <div className={styles.signature}><ConceptMark className={styles.mark} /><span>УдГУ</span></div>
        <ThemeToggle />
      </header>
      <div className={styles.spread}>
        <aside className={styles.poster} aria-label="Цифровой деканат УдГУ">
          <div className={styles.posterTitle}>Цифровой<br />деканат<span>.</span></div>
          <Atlas />
          <div className={styles.imprint}>Удмуртский государственный университет</div>
        </aside>
        <main id="main-content" className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
