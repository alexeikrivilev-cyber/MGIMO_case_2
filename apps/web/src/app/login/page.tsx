import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Вход в личный кабинет",
};

export default function LoginPage() {
  return (
    <section className="py-10 sm:py-16">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Вход в личный кабинет</h1>
      <p className="mt-2 text-sm text-slate-600">
        Войдите по логину и паролю, выданным в деканате.
      </p>
      <form className="mt-8 space-y-4" aria-label="Форма входа">
        <div>
          <label htmlFor="login" className="block text-sm font-medium text-slate-700">
            Логин
          </label>
          <input
            id="login"
            name="login"
            type="text"
            autoComplete="username"
            required
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-6 text-base font-semibold text-white"
        >
          Войти
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-500">
        Форма входа подключается на следующем этапе.{" "}
        <Link href="/" className="font-medium text-sky-700 underline">
          На главную
        </Link>
      </p>
    </section>
  );
}
