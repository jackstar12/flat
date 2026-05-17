import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coins,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Trash2,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { roommates, roommateIds, findRoommate, household } from "./shared/config";
import { currentAssigneeId, dateStatus } from "./shared/tasks";
import type {
  Chore,
  FinancePayload,
  FinanceSplit,
  FinanceTransaction,
  FrequencyUnit,
  Roommate,
  SessionPayload,
  TasksPayload,
} from "./shared/types";
import { centsFromEuroInput, euroInputFromCents, formatDate, formatMoney } from "./shared/format";

type View = "finanzen" | "aufgaben";

type ExpenseForm = {
  description: string;
  amount: string;
  paidBy: string;
  paidAt: string;
  splitMode: "equal" | "custom";
  participantIds: string[];
  customSplits: Record<string, string>;
};

type SettlementForm = {
  fromRoommateId: string;
  toRoommateId: string;
  amount: string;
  paidAt: string;
};

type ChoreForm = {
  title: string;
  description: string;
  participantIds: string[];
  frequencyUnit: FrequencyUnit;
  frequencyInterval: number;
  nextDueDate: string;
  isActive: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

const defaultExpenseForm = (): ExpenseForm => ({
  description: "",
  amount: "",
  paidBy: roommates[0].id,
  paidAt: today(),
  splitMode: "equal",
  participantIds: roommateIds,
  customSplits: Object.fromEntries(roommateIds.map((id) => [id, ""])) as Record<string, string>,
});

const defaultSettlementForm = (): SettlementForm => ({
  fromRoommateId: roommates[1]?.id ?? roommates[0].id,
  toRoommateId: roommates[0].id,
  amount: "",
  paidAt: today(),
});

const defaultChoreForm = (): ChoreForm => ({
  title: "",
  description: "",
  participantIds: roommateIds,
  frequencyUnit: "week",
  frequencyInterval: 1,
  nextDueDate: today(),
  isActive: true,
});

export default function App() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [activeView, setActiveView] = useState<View>("finanzen");
  const [finance, setFinance] = useState<FinancePayload | null>(null);
  const [tasks, setTasks] = useState<TasksPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    try {
      const nextSession = await api<SessionPayload>("/api/session");
      setSession(nextSession);
      if (nextSession.authenticated) {
        await Promise.all([loadFinance(), loadTasks()]);
      }
    } catch (unknownError) {
      setError(readError(unknownError));
    } finally {
      setLoading(false);
    }
  }

  async function loadFinance() {
    setFinance(await api<FinancePayload>("/api/finance"));
  }

  async function loadTasks() {
    setTasks(await api<TasksPayload>("/api/tasks"));
  }

  async function logout() {
    await api("/api/logout", { method: "POST" });
    setSession({
      authenticated: false,
      roommate: null,
      roommates,
      household,
    });
    setFinance(null);
    setTasks(null);
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!session?.authenticated) {
    return (
      <LoginScreen
        onLogin={async (nextSession) => {
          setSession(nextSession);
          await Promise.all([loadFinance(), loadTasks()]);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-cloud text-ink">
      <header className="border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-moss">{household.name}</p>
            <h1 className="text-2xl font-semibold tracking-normal">WG Cockpit</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <nav className="grid grid-cols-2 rounded-md border border-line bg-cloud p-1">
              <NavButton
                active={activeView === "finanzen"}
                icon={<Banknote size={18} />}
                label="Finanzen"
                onClick={() => setActiveView("finanzen")}
              />
              <NavButton
                active={activeView === "aufgaben"}
                icon={<ClipboardList size={18} />}
                label="Aufgaben"
                onClick={() => setActiveView("aufgaben")}
              />
            </nav>
            <div className="flex items-center justify-between gap-3">
              <PersonBadge roommate={session.roommate} />
              <button className="icon-button" type="button" title="Abmelden" onClick={() => void logout()}>
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error ? (
          <div className="mb-4 flex items-center justify-between rounded-md border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-ink">
            <span>{error}</span>
            <button className="icon-button h-8 w-8" type="button" title="Schliessen" onClick={() => setError(null)}>
              <X size={16} />
            </button>
          </div>
        ) : null}

        {activeView === "finanzen" ? (
          <FinanceView
            data={finance}
            onChanged={() => void loadFinance().catch((unknownError) => setError(readError(unknownError)))}
            onError={setError}
          />
        ) : (
          <TasksView
            data={tasks}
            onChanged={() => void loadTasks().catch((unknownError) => setError(readError(unknownError)))}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: SessionPayload) => Promise<void> }) {
  const [roommateId, setRoommateId] = useState(roommates[0].id);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const nextSession = await api<SessionPayload>("/api/login", {
        method: "POST",
        body: JSON.stringify({ roommateId, password }),
      });
      await onLogin(nextSession);
    } catch (unknownError) {
      setError(readError(unknownError));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-cloud px-4 py-8 text-ink sm:place-items-center">
      <section className="w-full max-w-md rounded-md border border-line bg-white p-6 shadow-soft">
        <div className="mb-6">
          <p className="text-sm font-medium text-moss">{household.name}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">Einloggen</h1>
        </div>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="label">Person</span>
            <select className="input" value={roommateId} onChange={(event) => setRoommateId(event.target.value)}>
              {roommates.map((roommate) => (
                <option key={roommate.id} value={roommate.id}>
                  {roommate.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">WG-Passwort</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="rounded-md bg-coral/10 px-3 py-2 text-sm text-ink">{error}</p> : null}
          <button className="primary-button w-full" type="submit" disabled={pending}>
            {pending ? "Anmelden..." : "Anmelden"}
          </button>
        </form>
      </section>
    </main>
  );
}

function FinanceView({
  data,
  onChanged,
  onError,
}: {
  data: FinancePayload | null;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FinanceTransaction | null>(null);
  const [settlementForm, setSettlementForm] = useState(defaultSettlementForm);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const sortedBalances = data?.balances ?? [];
  const transactions = data?.transactions ?? [];

  function openExpense(transaction?: FinanceTransaction) {
    if (transaction) {
      setEditingExpense(transaction);
    } else {
      setEditingExpense(null);
    }
    setExpenseOpen(true);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Finanzen</h2>
            <p className="section-subtitle">Ausgaben, Ausgleichszahlungen und aktuelle Salden.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => openExpense()}>
            <Plus size={18} />
            Ausgabe
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sortedBalances.map((balance) => (
            <BalanceCard key={balance.roommateId} roommateId={balance.roommateId} cents={balance.balanceCents} />
          ))}
        </div>

        <div className="rounded-md border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-moss" />
              <h3 className="font-semibold">Ledger</h3>
            </div>
          </div>
          <div className="divide-y divide-line">
            {transactions.length === 0 ? (
              <EmptyState label="Noch keine Eintrage." />
            ) : (
              transactions.map((transaction) => (
                <LedgerRow
                  key={transaction.id}
                  transaction={transaction}
                  onEdit={() => openExpense(transaction)}
                  onDelete={async () => {
                    try {
                      await api(`/api/finance/expenses/${transaction.id}`, { method: "DELETE" });
                      onChanged();
                    } catch (unknownError) {
                      onError(readError(unknownError));
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-md border border-line bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins size={18} className="text-moss" />
              <h3 className="font-semibold">Ausgleichen</h3>
            </div>
            <button className="secondary-button px-3 py-2 text-sm" type="button" onClick={() => setSettlementOpen(true)}>
              Manuell
            </button>
          </div>
          <div className="space-y-3">
            {data?.suggestedSettlements.length ? (
              data.suggestedSettlements.map((settlement) => (
                <div key={`${settlement.fromRoommateId}-${settlement.toRoommateId}`} className="rounded-md bg-cloud p-3">
                  <p className="text-sm">
                    <strong>{nameFor(settlement.fromRoommateId)}</strong> zahlt{" "}
                    <strong>{nameFor(settlement.toRoommateId)}</strong>
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-lg font-semibold">{formatMoney(settlement.amountCents)}</span>
                    <button
                      className="primary-button px-3 py-2 text-sm"
                      type="button"
                      onClick={async () => {
                        try {
                          await createSettlement({
                            ...settlement,
                            paidAt: today(),
                            description: "",
                          });
                          onChanged();
                        } catch (unknownError) {
                          onError(readError(unknownError));
                        }
                      }}
                    >
                      Buchen
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState label="Alle Salden sind ausgeglichen." compact />
            )}
          </div>
        </div>

        {settlementOpen ? (
          <div className="rounded-md border border-line bg-white p-4">
            <FormHeader title="Ausgleichszahlung" onClose={() => setSettlementOpen(false)} />
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await submitSettlement(settlementForm);
                  setSettlementForm(defaultSettlementForm());
                  setSettlementOpen(false);
                  onChanged();
                } catch (unknownError) {
                  onError(readError(unknownError));
                }
              }}
            >
              <RoommateSelect
                label="Von"
                value={settlementForm.fromRoommateId}
                onChange={(value) => setSettlementForm((current) => ({ ...current, fromRoommateId: value }))}
              />
              <RoommateSelect
                label="An"
                value={settlementForm.toRoommateId}
                onChange={(value) => setSettlementForm((current) => ({ ...current, toRoommateId: value }))}
              />
              <MoneyInput
                label="Betrag"
                value={settlementForm.amount}
                onChange={(value) => setSettlementForm((current) => ({ ...current, amount: value }))}
              />
              <DateInput
                label="Datum"
                value={settlementForm.paidAt}
                onChange={(value) => setSettlementForm((current) => ({ ...current, paidAt: value }))}
              />
              <button className="primary-button w-full" type="submit">
                Zahlung buchen
              </button>
            </form>
          </div>
        ) : null}
      </aside>

      {expenseOpen ? (
        <ExpensePanel
          transaction={editingExpense}
          onClose={() => setExpenseOpen(false)}
          onSaved={() => {
            setExpenseOpen(false);
            setEditingExpense(null);
            onChanged();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function ExpensePanel({
  transaction,
  onClose,
  onSaved,
  onError,
}: {
  transaction: FinanceTransaction | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<ExpenseForm>(() =>
    transaction ? expenseFormFromTransaction(transaction) : defaultExpenseForm(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await submitExpense(form, transaction?.id);
      onSaved();
    } catch (unknownError) {
      onError(readError(unknownError));
    }
  }

  const amountCents = centsFromEuroInput(form.amount);

  return (
    <div className="fixed inset-0 z-20 grid bg-ink/40 p-3 sm:place-items-center">
      <section className="max-h-[calc(100vh-1.5rem)] w-full overflow-y-auto rounded-md border border-line bg-white p-4 shadow-soft sm:max-w-xl sm:p-5">
        <FormHeader title={transaction ? "Ausgabe bearbeiten" : "Neue Ausgabe"} onClose={onClose} />
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="label">Beschreibung</span>
            <input
              className="input"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput
              label="Betrag"
              value={form.amount}
              onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
            />
            <DateInput
              label="Datum"
              value={form.paidAt}
              onChange={(value) => setForm((current) => ({ ...current, paidAt: value }))}
            />
          </div>
          <RoommateSelect
            label="Bezahlt von"
            value={form.paidBy}
            onChange={(value) => setForm((current) => ({ ...current, paidBy: value }))}
          />
          <div>
            <span className="label">Aufteilung</span>
            <div className="segmented">
              <button
                type="button"
                className={segmentClass(form.splitMode === "equal")}
                onClick={() => setForm((current) => ({ ...current, splitMode: "equal" }))}
              >
                Gleich
              </button>
              <button
                type="button"
                className={segmentClass(form.splitMode === "custom")}
                onClick={() => setForm((current) => ({ ...current, splitMode: "custom" }))}
              >
                Individuell
              </button>
            </div>
          </div>

          {form.splitMode === "equal" ? (
            <RoommateChecks
              selected={form.participantIds}
              onChange={(participantIds) => setForm((current) => ({ ...current, participantIds }))}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roommates.map((roommate) => (
                <MoneyInput
                  key={roommate.id}
                  label={roommate.name}
                  value={form.customSplits[roommate.id] ?? ""}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      customSplits: { ...current.customSplits, [roommate.id]: value },
                    }))
                  }
                />
              ))}
              <p className="sm:col-span-2 text-sm text-ink/70">
                Summe: {Number.isNaN(amountCents) ? "-" : formatMoney(customSplitTotal(form.customSplits))}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit">
              Speichern
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TasksView({
  data,
  onChanged,
  onError,
}: {
  data: TasksPayload | null;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingChore, setEditingChore] = useState<Chore | null>(null);
  const chores = data?.chores ?? [];

  function openChore(chore?: Chore) {
    setEditingChore(chore ?? null);
    setFormOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">Aufgaben</h2>
          <p className="section-subtitle">Wiederkehrende Aufgaben mit Rotation und Falligkeit.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => openChore()}>
          <Plus size={18} />
          Aufgabe
        </button>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        {(["overdue", "today", "upcoming"] as const).map((status) => (
          <TaskColumn
            key={status}
            status={status}
            chores={chores.filter((chore) => dateStatus(chore.nextDueDate, today()) === status && chore.isActive)}
            onEdit={openChore}
            onComplete={async (chore) => {
              try {
                await api(`/api/tasks/${chore.id}/complete`, { method: "POST" });
                onChanged();
              } catch (unknownError) {
                onError(readError(unknownError));
              }
            }}
            onDelete={async (chore) => {
              try {
                await api(`/api/tasks/${chore.id}`, { method: "DELETE" });
                onChanged();
              } catch (unknownError) {
                onError(readError(unknownError));
              }
            }}
          />
        ))}
      </section>

      {chores.some((chore) => !chore.isActive) ? (
        <section className="rounded-md border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h3 className="font-semibold">Deaktiviert</h3>
          </div>
          <div className="divide-y divide-line">
            {chores
              .filter((chore) => !chore.isActive)
              .map((chore) => (
                <ChoreRow
                  key={chore.id}
                  chore={chore}
                  onEdit={() => openChore(chore)}
                  onComplete={null}
                  onDelete={async () => {
                    try {
                      await api(`/api/tasks/${chore.id}`, { method: "DELETE" });
                      onChanged();
                    } catch (unknownError) {
                      onError(readError(unknownError));
                    }
                  }}
                />
              ))}
          </div>
        </section>
      ) : null}

      {formOpen ? (
        <ChorePanel
          chore={editingChore}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            setEditingChore(null);
            onChanged();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function ChorePanel({
  chore,
  onClose,
  onSaved,
  onError,
}: {
  chore: Chore | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<ChoreForm>(() => (chore ? choreFormFromChore(chore) : defaultChoreForm()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await submitChore(form, chore?.id);
      onSaved();
    } catch (unknownError) {
      onError(readError(unknownError));
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid bg-ink/40 p-3 sm:place-items-center">
      <section className="max-h-[calc(100vh-1.5rem)] w-full overflow-y-auto rounded-md border border-line bg-white p-4 shadow-soft sm:max-w-xl sm:p-5">
        <FormHeader title={chore ? "Aufgabe bearbeiten" : "Neue Aufgabe"} onClose={onClose} />
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="label">Titel</span>
            <input
              className="input"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="block">
            <span className="label">Notiz</span>
            <textarea
              className="input min-h-24"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <RoommateChecks
            selected={form.participantIds}
            onChange={(participantIds) => setForm((current) => ({ ...current, participantIds }))}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px]">
            <label className="block">
              <span className="label">Alle</span>
              <input
                className="input"
                type="number"
                min={1}
                value={form.frequencyInterval}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    frequencyInterval: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="block">
              <span className="label">Einheit</span>
              <select
                className="input"
                value={form.frequencyUnit}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    frequencyUnit: event.target.value as FrequencyUnit,
                  }))
                }
              >
                <option value="day">Tage</option>
                <option value="week">Wochen</option>
                <option value="month">Monate</option>
              </select>
            </label>
            <DateInput
              label="Fallig am"
              value={form.nextDueDate}
              onChange={(value) => setForm((current) => ({ ...current, nextDueDate: value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              className="rounded border-line text-moss focus:ring-moss"
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Aktiv
          </label>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit">
              Speichern
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TaskColumn({
  status,
  chores,
  onEdit,
  onComplete,
  onDelete,
}: {
  status: "overdue" | "today" | "upcoming";
  chores: Chore[];
  onEdit: (chore: Chore) => void;
  onComplete: (chore: Chore) => Promise<void>;
  onDelete: (chore: Chore) => Promise<void>;
}) {
  const title = status === "overdue" ? "Uberfallig" : status === "today" ? "Heute" : "Demnachst";
  const tone = status === "overdue" ? "text-coral" : status === "today" ? "text-moss" : "text-ink";

  return (
    <section className="rounded-md border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className={`font-semibold ${tone}`}>{title}</h3>
        <span className="rounded-full bg-cloud px-2 py-1 text-xs font-semibold">{chores.length}</span>
      </div>
      <div className="divide-y divide-line">
        {chores.length === 0 ? (
          <EmptyState label="Keine Aufgaben." compact />
        ) : (
          chores.map((chore) => (
            <ChoreRow
              key={chore.id}
              chore={chore}
              onEdit={() => onEdit(chore)}
              onComplete={() => onComplete(chore)}
              onDelete={() => onDelete(chore)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ChoreRow({
  chore,
  onEdit,
  onComplete,
  onDelete,
}: {
  chore: Chore;
  onEdit: () => void;
  onComplete: (() => Promise<void>) | null;
  onDelete: () => Promise<void>;
}) {
  const assignee = findRoommate(currentAssigneeId(chore));

  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold">{chore.title}</h4>
          {chore.description ? <p className="mt-1 text-sm text-ink/70">{chore.description}</p> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="icon-button h-8 w-8" type="button" title="Bearbeiten" onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button
            className="icon-button h-8 w-8"
            type="button"
            title="Loschen"
            onClick={() => void onDelete()}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink/75">
        <span className="inline-flex items-center gap-1 rounded-full bg-cloud px-2 py-1">
          <CalendarDays size={14} />
          {formatDate(chore.nextDueDate)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-cloud px-2 py-1">
          <Repeat size={14} />
          {frequencyLabel(chore.frequencyInterval, chore.frequencyUnit)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-cloud px-2 py-1">
          <Users size={14} />
          {assignee?.name ?? "Unbekannt"}
        </span>
      </div>
      {onComplete ? (
        <button className="mt-4 secondary-button w-full" type="button" onClick={() => void onComplete()}>
          <CheckCircle2 size={17} />
          Erledigt
        </button>
      ) : null}
    </article>
  );
}

function LedgerRow({
  transaction,
  onEdit,
  onDelete,
}: {
  transaction: FinanceTransaction;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const isExpense = transaction.type === "expense";

  return (
    <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-mint text-moss">
            {isExpense ? <Receipt size={17} /> : <WalletCards size={17} />}
          </span>
          <h4 className="font-semibold">{transaction.description}</h4>
        </div>
        <p className="mt-1 text-sm text-ink/70">
          {formatDate(transaction.paidAt)} ·{" "}
          {isExpense
            ? `bezahlt von ${nameFor(transaction.paidBy)}`
            : `${nameFor(transaction.fromRoommateId)} an ${nameFor(transaction.toRoommateId)}`}
        </p>
        {isExpense ? (
          <p className="mt-1 text-xs text-ink/60">
            {transaction.splits.map((split) => `${nameFor(split.roommateId)} ${formatMoney(split.owedCents)}`).join(" · ")}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-lg font-semibold">{formatMoney(transaction.amountCents)}</span>
        {isExpense ? (
          <div className="flex gap-1">
            <button className="icon-button h-8 w-8" type="button" title="Bearbeiten" onClick={onEdit}>
              <Pencil size={15} />
            </button>
            <button className="icon-button h-8 w-8" type="button" title="Loschen" onClick={() => void onDelete()}>
              <Trash2 size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BalanceCard({ roommateId, cents }: { roommateId: string; cents: number }) {
  const roommate = findRoommate(roommateId);
  const label = cents > 0 ? "bekommt" : cents < 0 ? "zahlt" : "ausgeglichen";

  return (
    <article className="rounded-md border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <PersonBadge roommate={roommate ?? null} />
        <span className={cents > 0 ? "text-moss" : cents < 0 ? "text-coral" : "text-ink/60"}>{label}</span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-normal">{formatMoney(Math.abs(cents))}</p>
    </article>
  );
}

function RoommateChecks({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="label">Personen</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roommates.map((roommate) => {
          const checked = selected.includes(roommate.id);
          return (
            <label key={roommate.id} className="flex items-center gap-2 rounded-md border border-line bg-cloud px-3 py-2 text-sm">
              <input
                className="rounded border-line text-moss focus:ring-moss"
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange([...selected, roommate.id]);
                  } else {
                    onChange(selected.filter((id) => id !== roommate.id));
                  }
                }}
              />
              {roommate.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoommateSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {roommates.map((roommate) => (
          <option key={roommate.id} value={roommate.id}>
            {roommate.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        placeholder="0,00"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FormHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      <button className="icon-button" type="button" title="Schliessen" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={navClass(active)} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PersonBadge({ roommate }: { roommate: Roommate | null }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: roommate?.color ?? "#2f5d50" }}
      >
        {roommate?.initials ?? "WG"}
      </span>
      <span className="font-medium">{roommate?.name ?? "WG"}</span>
    </div>
  );
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <p className={compact ? "px-3 py-5 text-center text-sm text-ink/60" : "p-6 text-center text-sm text-ink/60"}>{label}</p>;
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-cloud text-ink">
      <div className="rounded-md border border-line bg-white px-5 py-4 shadow-soft">Laden...</div>
    </main>
  );
}

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = "Anfrage fehlgeschlagen.";
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function submitExpense(form: ExpenseForm, id?: string): Promise<void> {
  const amountCents = centsFromEuroInput(form.amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Bitte einen gultigen Betrag eingeben.");
  }

  const splits: FinanceSplit[] =
    form.splitMode === "custom"
      ? roommateIds
          .map((roommateId) => ({
            roommateId,
            owedCents: centsFromEuroInput(form.customSplits[roommateId] ?? "0"),
          }))
          .filter((split) => Number.isInteger(split.owedCents) && split.owedCents > 0)
      : [];

  await api(id ? `/api/finance/expenses/${id}` : "/api/finance/expenses", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify({
      description: form.description,
      amountCents,
      paidBy: form.paidBy,
      paidAt: form.paidAt,
      splitMode: form.splitMode,
      participantIds: form.participantIds,
      splits,
    }),
  });
}

async function submitSettlement(form: SettlementForm): Promise<void> {
  const amountCents = centsFromEuroInput(form.amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Bitte einen gultigen Betrag eingeben.");
  }
  await createSettlement({
    fromRoommateId: form.fromRoommateId,
    toRoommateId: form.toRoommateId,
    amountCents,
    paidAt: form.paidAt,
    description: "",
  });
}

async function createSettlement(input: {
  fromRoommateId: string;
  toRoommateId: string;
  amountCents: number;
  paidAt: string;
  description: string;
}) {
  await api("/api/finance/settlements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function submitChore(form: ChoreForm, id?: string): Promise<void> {
  await api(id ? `/api/tasks/${id}` : "/api/tasks", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(form),
  });
}

function expenseFormFromTransaction(transaction: FinanceTransaction): ExpenseForm {
  return {
    description: transaction.description,
    amount: euroInputFromCents(transaction.amountCents),
    paidBy: transaction.paidBy ?? roommates[0].id,
    paidAt: transaction.paidAt,
    splitMode: "custom",
    participantIds: transaction.splits.map((split) => split.roommateId),
    customSplits: Object.fromEntries(
      roommateIds.map((roommateId) => [
        roommateId,
        euroInputFromCents(transaction.splits.find((split) => split.roommateId === roommateId)?.owedCents ?? 0),
      ]),
    ) as Record<string, string>,
  };
}

function choreFormFromChore(chore: Chore): ChoreForm {
  return {
    title: chore.title,
    description: chore.description,
    participantIds: chore.participantIds,
    frequencyUnit: chore.frequencyUnit,
    frequencyInterval: chore.frequencyInterval,
    nextDueDate: chore.nextDueDate,
    isActive: chore.isActive,
  };
}

function customSplitTotal(splits: Record<string, string>): number {
  return Object.values(splits).reduce((total, value) => {
    const cents = centsFromEuroInput(value || "0");
    return total + (Number.isInteger(cents) ? cents : 0);
  }, 0);
}

function nameFor(roommateId?: string): string {
  if (!roommateId) {
    return "Unbekannt";
  }
  return findRoommate(roommateId)?.name ?? roommateId;
}

function frequencyLabel(interval: number, unit: FrequencyUnit): string {
  const label = unit === "day" ? "Tag" : unit === "week" ? "Woche" : "Monat";
  const plural = interval === 1 ? label : `${label}e`;
  return `${interval} ${plural}`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function navClass(active: boolean): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-semibold transition",
    active ? "bg-white text-ink shadow-sm" : "text-ink/70 hover:text-ink",
  ].join(" ");
}

function segmentClass(active: boolean): string {
  return [
    "flex-1 rounded px-3 py-2 text-sm font-semibold transition",
    active ? "bg-white text-ink shadow-sm" : "text-ink/70 hover:text-ink",
  ].join(" ");
}
