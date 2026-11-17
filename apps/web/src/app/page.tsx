import Link from "next/link";

const modules = [
  {
    title: "Расписание",
    description: "Пары на сегодня и неделю, аудитории, переносы и отмены",
  },
  {
    title: "Успеваемость",
    description: "Оценки, зачёты, семестры и сводка «как у меня дела»",
  },
  {
    title: "Заявки и справки",
    description: "Подача заявок в деканат и отслеживание статусов",
  },
  {
    title: "Уведомления",
    description: "Объявления деканата, дедлайны и изменения расписания",
  },
];

export default function HomePage() {
  return (
    <section className="py-10 sm:py-16">
      <p className="text-sm font-medium tracking-wide text-sky-700 uppercase">
        Университет «Горизонт»
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        Цифровой деканат будущего
      </h1>
      <p className="mt-4 text-base text-slate-600">
        Личный кабинет студента: расписание, успеваемость, заявки и уведомления — в одном месте.
      </p>
      <div className="mt-8">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-6 text-base font-semibold text-white"
        >
          Войти в кабинет
        </Link>
      </div>
      <h2 className="mt-14 text-sm font-medium tracking-wide text-slate-500 uppercase">
        Что будет в кабинете
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {modules.map((item) => (
          <li key={item.title} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
