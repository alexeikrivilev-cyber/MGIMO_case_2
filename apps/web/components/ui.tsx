'use client';

/**
 * Базовые UI-компоненты кабинета (мобильный first, 360 px).
 *
 * Правила (ACCEPTANCE, BRIEF):
 * - touch-targets ≥ 44 px: высота кнопок и полей — h-11 и выше;
 * - доступность: label↔input (htmlFor/id), aria-invalid на поле с ошибкой,
 *   aria-live/role=alert для ошибок и статусов, видимый focus-visible
 *   (outline через токен primary), у статусов — цвет И текст (не только цвет);
 * - цвета — только токены @udgu/ui (классы bg-surface, text-text-muted…):
 *   тёмная тема (P1.5) включится без правок компонентов.
 */
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import Link from 'next/link';

/** Склейка классов (клиентский аналог clsx — сторонних зависимостей нет). */
function cn(...values: readonly (string | undefined | false)[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}

/** Видимый фокус через токен primary — единый вид для всех интерактивных элементов. */
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly children: ReactNode;
  className?: string;
  /** Идентификатор для тестов и автоматизации (пробрасывается в div). */
  readonly 'data-testid'?: string;
}

/** Поверхность-контейнер: единый фон/граница/радиус на все экраны кабинета. */
export function Card({ children, className, 'data-testid': testId }: CardProps): React.JSX.Element {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-4 shadow-sm', className)} data-testid={testId}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Состояние загрузки: кнопка disabled, показывает спиннер и aria-busy. */
  readonly loading?: boolean;
  /** Текст для скринридера во время загрузки. */
  readonly loadingLabel?: string;
  readonly fullWidth?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // text-on-primary — токен контраста на primary/danger (в светлой теме белый,
  // в тёмной — тёмный: контраст сохраняется в обеих).
  primary: 'bg-primary text-on-primary hover:bg-primary-hover disabled:hover:bg-primary',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  danger: 'bg-danger text-on-primary hover:bg-danger/90 disabled:hover:bg-danger',
};

/**
 * Кнопка кабинета. Высота h-11 (44 px) — требование touch-targets;
 * loading делает кнопку недоступной и озвучивает статус (aria-busy).
 */
export function Button({
  variant = 'primary',
  loading = false,
  loadingLabel = 'Выполняется…',
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
        FOCUS_RING,
        BUTTON_VARIANTS[variant],
        fullWidth && 'w-full',
        (disabled === true || loading) && 'cursor-not-allowed opacity-60',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner label={loadingLabel} /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Поля ввода
// ---------------------------------------------------------------------------

const FIELD_BASE = cn(
  'block w-full min-h-11 rounded-md border bg-surface-2 px-3 py-2 text-sm text-text',
  'placeholder:text-text-muted',
  FOCUS_RING,
);

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  /** Пояснение под полем (связывается через aria-describedby). */
  readonly hint?: string;
  /** Сообщение ошибки: поле получает aria-invalid и ссылку на текст. */
  readonly error?: string | null;
  readonly id?: string;
}

/** Текстовое поле с подписью, пояснением и ошибкой (единый контракт формы). */
export function TextInput({ label, hint, error = null, id, className, ...rest }: TextInputProps): React.JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-text">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      <input
        id={inputId}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(FIELD_BASE, error === null ? 'border-border' : 'border-danger', className)}
        {...rest}
      />
      {error === null ? null : (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly id?: string;
}

/** Селект с той же связкой подписи/пояснения/ошибки, что и TextInput. */
export function Select({ label, hint, error = null, id, className, children, ...rest }: SelectProps): React.JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-text">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      <select
        id={inputId}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(FIELD_BASE, error === null ? 'border-border' : 'border-danger', className)}
        {...rest}
      >
        {children}
      </select>
      {error === null ? null : (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Многострочное поле
// ---------------------------------------------------------------------------

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | null;
  readonly id?: string;
}

/** Текстовая область с той же связкой подписи/пояснения/ошибки, что и TextInput. */
export function Textarea({ label, hint, error = null, id, className, ...rest }: TextareaProps): React.JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-text">
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      <textarea
        id={inputId}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(FIELD_BASE, 'min-h-24', error === null ? 'border-border' : 'border-danger', className)}
        {...rest}
      />
      {error === null ? null : (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Аватар-инициалы
// ---------------------------------------------------------------------------

/**
 * Аватар по инициалам («ИА»): своего логотипа/фото у концепта нет,
 * а инициалы не требуют загрузки файлов и одинаково читаемы в обеих темах.
 */
export function Avatar({
  initials,
  size = 'md',
  className,
}: {
  initials: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): React.JSX.Element {
  const sizes = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-11 w-11 text-sm',
    lg: 'h-16 w-16 text-xl',
  } as const;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full border border-border bg-primary-soft font-semibold text-primary',
        sizes[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Переключатель вида (серверный: ссылки, не клиентское состояние)
// ---------------------------------------------------------------------------

export interface SegmentedItem {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
}

/**
 * Сегментированный переключатель на ссылках: работает без JS, ведёт на
 * тот же адрес с другим query — страница перерисовывается на сервере.
 * Активный сегмент отмечен aria-current="page" (не только цветом).
 */
export function SegmentedLinks({
  items,
  label,
  className,
}: {
  items: readonly SegmentedItem[];
  label: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-border bg-surface-2 p-0.5', className)}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 min-w-16 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors',
            FOCUS_RING,
            item.active ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-text',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Состояния загрузки, пустоты и ошибки
// ---------------------------------------------------------------------------

/** Блок-заглушка на время загрузки данных. */
export function Skeleton({ className, label }: { className?: string; label?: string }): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" className={cn('animate-pulse rounded-md bg-surface-2', className)}>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </div>
  );
}

/** Пустое состояние: заголовок + пояснение + необязательное действие. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-2/50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {description === undefined ? null : <p className="mx-auto mt-1 max-w-xs text-sm text-text-muted">{description}</p>}
      {action === undefined ? null : <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Ошибка загрузки/действия: сообщение + «повторить» (role=alert — живая область). */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Повторить',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}): React.JSX.Element {
  return (
    <div role="alert" className="rounded-xl border border-danger bg-danger-soft px-4 py-4">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry === undefined ? null : (
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Статусы
// ---------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONES: Record<StatusTone, string> = {
  neutral: 'border-border bg-surface-2 text-text-muted',
  info: 'border-primary/30 bg-primary-soft text-primary',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
};

/**
 * Статусный бейдж: цвет ВСЕГДА сопровождается текстом (требование
 * доступности — цвет не единственный носитель смысла).
 */
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

/** Спиннер: декор + необязательная подпись для скринридера (role=status). */
export function Spinner({ className, label }: { className?: string; label?: string }): React.JSX.Element {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    >
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}
