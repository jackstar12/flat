import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Coins,
  ExternalLink,
  FileText,
  LogOut,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { roommates, roommateIds, findRoommate, household } from "./shared/config";
import { aggregateReceiptSplits } from "./shared/receipt";
import { currentAssigneeId, dateStatus, defaultChoreWeekday } from "./shared/tasks";
import type {
  Chore,
  FinancePayload,
  FinanceSplit,
  FinanceTransaction,
  FrequencyUnit,
  Rotation,
  ReceiptAnalysis,
  ReceiptAssignmentRule,
  Roommate,
  SessionPayload,
  TasksPayload,
  Weekday,
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
  frequencyInterval: number;
  scheduleWeekday: Weekday | null;
  isActive: boolean;
};

type RotationForm = {
  title: string;
  description: string;
  participantIds: string[];
};

type ReceiptImportForm = {
  description: string;
  paidBy: string;
  paidAt: string;
  receiptText: string;
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
  frequencyInterval: 1,
  scheduleWeekday: defaultChoreWeekday,
  isActive: true,
});

const defaultReceiptImportForm = (): ReceiptImportForm => ({
  description: "Spar Rechnung",
  paidBy: roommates[0].id,
  paidAt: today(),
  receiptText: "",
});

const defaultRotationForm = (): RotationForm => ({
  title: "",
  description: "",
  participantIds: roommateIds,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const nextSession = await api<SessionPayload>("/api/login", {
        method: "POST",
        body: JSON.stringify({ roommateId }),
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
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">Person wählen</h1>
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
          {error ? <p className="rounded-md bg-coral/10 px-3 py-2 text-sm text-ink">{error}</p> : null}
          <button className="primary-button w-full" type="submit" disabled={pending}>
            {pending ? "Weiter..." : "Weiter"}
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
  const [receiptOpen, setReceiptOpen] = useState(false);
  const sortedBalances = data?.balances ?? [];
  const transactions = data?.transactions ?? [];
  const totalSpentCents = transactions.reduce(
    (total, transaction) => total + (transaction.type === "expense" ? transaction.amountCents : 0),
    0,
  );

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
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="secondary-button" type="button" onClick={() => setReceiptOpen(true)}>
              <Sparkles size={18} />
              Rechnung analysieren
            </button>
            <button className="primary-button" type="button" onClick={() => openExpense()}>
              <Plus size={18} />
              Ausgabe
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {sortedBalances.map((balance) => (
            <BalanceCard key={balance.roommateId} roommateId={balance.roommateId} cents={balance.balanceCents} />
          ))}
        </div>

        <div className="rounded-md border border-line bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-moss" />
              <h3 className="font-semibold">Ledger</h3>
            </div>
            <div className="min-w-0 text-right" data-testid="total-spent">
              <span className="block text-[10px] font-medium uppercase tracking-[0.08em] text-ink/45">
                Gesamtausgaben
              </span>
              <strong className="block truncate text-sm font-semibold tabular-nums sm:text-base">
                {formatMoney(totalSpentCents)}
              </strong>
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
        <ProductTrackingCard transactions={transactions} />

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

      {receiptOpen ? (
        <ReceiptImportPanel
          onClose={() => setReceiptOpen(false)}
          onSaved={() => {
            setReceiptOpen(false);
            onChanged();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function ReceiptImportPanel({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<ReceiptImportForm>(() => defaultReceiptImportForm());
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ReceiptAnalysis | null>(null);
  const [pending, setPending] = useState(false);
  const [rules, setRules] = useState<ReceiptAssignmentRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);

  useEffect(() => {
    void api<{ rules: ReceiptAssignmentRule[] }>("/api/receipt-rules")
      .then((payload) => setRules(payload.rules))
      .catch((unknownError) => onError(readError(unknownError)))
      .finally(() => setRulesLoading(false));
  }, [onError]);

  async function saveRules(): Promise<void> {
    setRulesSaving(true);
    try {
      const payload = await api<{ rules: ReceiptAssignmentRule[] }>("/api/receipt-rules", {
        method: "PUT",
        body: JSON.stringify({ rules }),
      });
      setRules(payload.rules);
      setRulesDirty(false);
    } finally {
      setRulesSaving(false);
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      if (rulesDirty) {
        await saveRules();
      }
      const formData = new FormData();
      formData.set("receiptText", form.receiptText);
      if (file) {
        formData.set("receipt", file);
      }
      const response = await apiForm<{ analysis: ReceiptAnalysis }>("/api/finance/receipt/analyze", formData);
      setAnalysis(response.analysis);
    } catch (unknownError) {
      onError(readError(unknownError));
    } finally {
      setPending(false);
    }
  }

  async function saveExpense() {
    if (!analysis) {
      return;
    }
    if (!receiptAnalysisIsValid(analysis)) {
      onError("Bitte die Aufteilung jeder Position passend zur Positionssumme korrigieren.");
      return;
    }
    try {
      await createExpenseFromReceipt(form, analysis, file);
      onSaved();
    } catch (unknownError) {
      onError(readError(unknownError));
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid bg-ink/40 p-3 sm:place-items-center">
      <section className="max-h-[calc(100vh-1.5rem)] w-full overflow-y-auto rounded-md border border-line bg-white p-4 shadow-soft sm:max-w-4xl sm:p-5">
        <FormHeader title="Rechnung analysieren" onClose={onClose} />
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form className="space-y-4" onSubmit={(event) => void analyze(event)}>
            <label className="block">
              <span className="label">Rechnung (Bild oder PDF)</span>
              <div className="rounded-md border border-dashed border-line bg-cloud p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/75">
                  <Upload size={17} />
                  {file?.name ?? "Bild oder PDF auswahlen"}
                </div>
                <input
                  className="block w-full text-sm"
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
            </label>
            <label className="block">
              <span className="label">Rechnungstext</span>
              <textarea
                className="input min-h-24"
                value={form.receiptText}
                onChange={(event) => setForm((current) => ({ ...current, receiptText: event.target.value }))}
                placeholder="Optional: OCR-Text oder abgetippte Positionen"
              />
            </label>
            <ReceiptRulesEditor
              rules={rules}
              loading={rulesLoading}
              saving={rulesSaving}
              dirty={rulesDirty}
              onChange={(nextRules) => {
                setRules(nextRules);
                setRulesDirty(true);
              }}
              onSave={() => void saveRules().catch((unknownError) => onError(readError(unknownError)))}
              onError={onError}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <RoommateSelect
                label="Bezahlt von"
                value={form.paidBy}
                onChange={(value) => setForm((current) => ({ ...current, paidBy: value }))}
              />
              <DateInput
                label="Datum"
                value={form.paidAt}
                onChange={(value) => setForm((current) => ({ ...current, paidAt: value }))}
              />
            </div>
            <label className="block">
              <span className="label">Beschreibung</span>
              <input
                className="input"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <button className="primary-button w-full" type="submit" disabled={pending}>
              <Sparkles size={18} />
              {pending ? "Analysiere..." : "Analysieren"}
            </button>
          </form>

          <div className="rounded-md border border-line bg-cloud">
            <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-moss" />
                <h3 className="font-semibold">Vorschlag</h3>
              </div>
              {analysis ? <span className="text-sm font-semibold">{formatMoney(analysis.totalCents)}</span> : null}
            </div>
            {analysis ? (
              <div className="space-y-4 p-4">
                {analysis.warnings.length ? (
                  <div className="rounded-md bg-lemon/30 px-3 py-2 text-sm text-ink">
                    {analysis.warnings.join(" ")}
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-3">
                  {analysis.roommateTotals.map((split) => (
                    <div key={split.roommateId} className="rounded-md bg-white px-3 py-2">
                      <p className="text-sm text-ink/65">{nameFor(split.roommateId)}</p>
                      <p className="font-semibold">{formatMoney(split.amountCents)}</p>
                    </div>
                  ))}
                </div>
                {!receiptAnalysisIsValid(analysis) ? (
                  <div className="rounded-md bg-coral/10 px-3 py-2 text-sm text-ink">
                    Mindestens eine Position ist noch nicht exakt aufgeteilt.
                  </div>
                ) : null}
                <div className="max-h-80 overflow-y-auto rounded-md border border-line bg-white">
                  <div className="divide-y divide-line">
                    {analysis.items.map((item, index) => (
                      <article key={`${item.name}-${index}`} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-semibold">{item.name}</h4>
                            <p className="mt-1 text-xs text-ink/60">{item.assignmentReason}</p>
                          </div>
                          <span className="shrink-0 font-semibold">{formatMoney(item.amountCents)}</span>
                        </div>
                        <p className="mt-2 text-xs text-ink/65">
                          {item.splits
                            .map((split) => `${nameFor(split.roommateId)} ${formatMoney(split.amountCents)}`)
                            .join(" · ")}
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {roommateIds.map((roommateId) => (
                            <label key={roommateId} className="block">
                              <span className="mb-1 block text-xs font-semibold text-ink/65">
                                {nameFor(roommateId)}
                              </span>
                              <input
                                className="input py-1 text-sm"
                                step="0.01"
                                type="number"
                                value={euroInputFromCents(
                                  item.splits.find((split) => split.roommateId === roommateId)?.amountCents ?? 0,
                                )}
                                onChange={(event) =>
                                  setAnalysis((current) =>
                                    current
                                      ? updateReceiptItemSplit(
                                          current,
                                          index,
                                          roommateId,
                                          centsFromNumberInput(event.target.value),
                                        )
                                      : current,
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <p className={`mt-2 text-xs ${receiptItemIsValid(item) ? "text-ink/55" : "text-coral"}`}>
                          Aufgeteilt: {formatMoney(item.splits.reduce((sum, split) => sum + split.amountCents, 0))}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
                <button
                  className="primary-button w-full"
                  type="button"
                  disabled={!receiptAnalysisIsValid(analysis)}
                  onClick={() => void saveExpense()}
                >
                  Als Ausgabe speichern
                </button>
              </div>
            ) : (
              <EmptyState label="Noch keine Analyse." />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReceiptRulesEditor({
  rules,
  loading,
  saving,
  dirty,
  onChange,
  onSave,
  onError,
}: {
  rules: ReceiptAssignmentRule[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  onChange: (rules: ReceiptAssignmentRule[]) => void;
  onSave: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ReceiptAssignmentRule | null>(null);

  function applyDraft() {
    if (!draft) return;
    if (!draft.match.trim()) {
      onError("Bitte einen Begriff fur die Regel angeben.");
      return;
    }
    const total = Object.values(draft.shares).reduce((sum, percentage) => sum + percentage, 0);
    if (total !== 100) {
      onError(`Die Regel muss 100% ergeben (aktuell ${total}%).`);
      return;
    }
    const duplicate = rules.some(
      (rule) =>
        rule.id !== draft.id &&
        rule.target === draft.target &&
        rule.match.trim().toLocaleLowerCase("de") === draft.match.trim().toLocaleLowerCase("de"),
    );
    if (duplicate) {
      onError("Diese Regel existiert bereits.");
      return;
    }

    const next = { ...draft, match: draft.match.trim(), extraDescription: draft.extraDescription?.trim() || null };
    onChange(rules.some((rule) => rule.id === draft.id) ? rules.map((rule) => (rule.id === draft.id ? next : rule)) : [...rules, next]);
    setDraft(null);
  }

  return (
    <section aria-labelledby="receipt-rules-title" className="rounded-md border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <h3 id="receipt-rules-title" className="font-semibold">Regeln</h3>
        <div className="flex gap-2">
          <button
            className="secondary-button min-h-9 px-3 py-1.5 text-sm"
            type="button"
            onClick={() => setDraft(newReceiptAssignmentRule())}
          >
            <Plus size={16} />
            Regel
          </button>
          <button
            className="secondary-button min-h-9 px-3 py-1.5 text-sm"
            type="button"
            disabled={loading || saving || !dirty}
            onClick={onSave}
          >
            {saving ? "Speichert..." : "Speichern"}
          </button>
        </div>
      </div>

      {draft ? (
        <div className="space-y-3 border-b border-line bg-cloud/70 p-3">
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <label>
              <span className="mb-1 block text-xs font-semibold text-ink/65">Ziel</span>
              <select
                aria-label="Regelziel"
                className="input py-2 text-sm"
                value={draft.target}
                onChange={(event) => setDraft({ ...draft, target: event.target.value as "category" | "item" })}
              >
                <option value="category">Kategorie</option>
                <option value="item">Artikel</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-semibold text-ink/65">Treffer</span>
              <input
                aria-label="Regelbegriff"
                className="input py-2 text-sm"
                value={draft.match}
                onChange={(event) => setDraft({ ...draft, match: event.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {roommates.map((roommate) => (
              <label key={roommate.id}>
                <span className="mb-1 block truncate text-xs font-semibold text-ink/65">{roommate.name} %</span>
                <input
                  aria-label={`${roommate.name} Prozent`}
                  className="input py-2 text-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.shares[roommate.id] ?? 0}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      shares: { ...draft.shares, [roommate.id]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink/65">Zusatzbeschreibung</span>
            <input
              aria-label="Zusatzbeschreibung"
              className="input py-2 text-sm"
              value={draft.extraDescription ?? ""}
              onChange={(event) => setDraft({ ...draft, extraDescription: event.target.value })}
              placeholder="Optional"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button className="secondary-button min-h-9 px-3 py-1.5 text-sm" type="button" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
            <button className="primary-button min-h-9 px-3 py-1.5 text-sm" type="button" onClick={applyDraft}>
              Ubernehmen
            </button>
          </div>
        </div>
      ) : null}

      <div className="max-h-72 divide-y divide-line overflow-y-auto">
        {loading ? <EmptyState label="Regeln werden geladen..." compact /> : null}
        {!loading && rules.length === 0 ? <EmptyState label="Noch keine Regeln." compact /> : null}
        {!loading
          ? rules.map((rule) => (
              <article key={rule.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cloud px-2 py-0.5 text-xs font-semibold text-ink/60">
                      {rule.target === "category" ? "Kategorie" : "Artikel"}
                    </span>
                    <strong className="truncate">{rule.match}</strong>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink/60">
                    {roommates
                      .filter((roommate) => (rule.shares[roommate.id] ?? 0) > 0)
                      .map((roommate) => `${roommate.name} ${rule.shares[roommate.id]}%`)
                      .join(" · ")}
                    {rule.extraDescription ? ` · ${rule.extraDescription}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="icon-button h-9 w-9" type="button" title="Regel bearbeiten" onClick={() => setDraft(rule)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button h-9 w-9"
                    type="button"
                    title="Regel loschen"
                    onClick={() => onChange(rules.filter((candidate) => candidate.id !== rule.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))
          : null}
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-ink/55">
        Artikelregeln haben Vorrang vor Kategorien. Einzelne Betrage konnen im Analysevorschlag immer angepasst werden.
      </p>
    </section>
  );
}

function newReceiptAssignmentRule(): ReceiptAssignmentRule {
  return {
    id: crypto.randomUUID(),
    target: "item",
    match: "",
    shares: Object.fromEntries(roommateIds.map((roommateId, index) => [roommateId, index === 0 ? 100 : 0])),
    extraDescription: null,
  };
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
  const [rotationFormOpen, setRotationFormOpen] = useState(false);
  const [editingRotation, setEditingRotation] = useState<Rotation | null>(null);
  const chores = data?.chores ?? [];
  const rotations = data?.rotations ?? [];

  function openChore(chore?: Chore) {
    setEditingChore(chore ?? null);
    setFormOpen(true);
  }

  function openRotation(rotation?: Rotation) {
    setEditingRotation(rotation ?? null);
    setRotationFormOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">Aufgaben</h2>
          <p className="section-subtitle">Wiederkehrende Aufgaben und einfache Rotationen.</p>
        </div>
        <div className="flex gap-2">
          <button className="secondary-button" type="button" onClick={() => openRotation()}>
            <Repeat size={18} />
            Rad
          </button>
          <button className="primary-button" type="button" onClick={() => openChore()}>
            <Plus size={18} />
            Aufgabe
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Rotationen">
        {rotations.map((rotation) => (
          <RotationCard
            key={rotation.id}
            rotation={rotation}
            onEdit={() => openRotation(rotation)}
            onComplete={async () => {
              try {
                await api(`/api/tasks/rotations/${rotation.id}/complete`, { method: "POST" });
                onChanged();
              } catch (unknownError) {
                onError(readError(unknownError));
              }
            }}
            onDelete={async () => {
              try {
                await api(`/api/tasks/rotations/${rotation.id}`, { method: "DELETE" });
                onChanged();
              } catch (unknownError) {
                onError(readError(unknownError));
              }
            }}
          />
        ))}
      </section>

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

      {rotationFormOpen ? (
        <RotationPanel
          rotation={editingRotation}
          onClose={() => setRotationFormOpen(false)}
          onSaved={() => {
            setRotationFormOpen(false);
            setEditingRotation(null);
            onChanged();
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function RotationCard({
  rotation,
  onEdit,
  onComplete,
  onDelete,
}: {
  rotation: Rotation;
  onEdit: () => void;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const assignee = findRoommate(currentAssigneeId(rotation));
  const lastCompletedBy = rotation.lastCompletedBy ? findRoommate(rotation.lastCompletedBy) : null;

  return (
    <article className="overflow-hidden rounded-md border border-line bg-white" data-testid="rotation-card">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-mint/25 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{rotation.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs text-ink/55">
            {rotation.description || "Keine feste Fälligkeit"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button className="icon-button h-8 w-8" type="button" title={`${rotation.title} bearbeiten`} onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button
            className="icon-button h-8 w-8"
            type="button"
            title={`${rotation.title} löschen`}
            onClick={() => void onDelete()}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="relative mx-auto grid h-24 w-24 shrink-0 place-items-center rounded-full border border-moss/25 bg-cloud sm:mx-0">
          <span className="absolute inset-2 rounded-full border border-dashed border-moss/35" />
          <span className="relative grid h-14 w-14 place-items-center rounded-full bg-moss text-sm font-semibold text-white shadow-soft">
            {assignee?.initials ?? "?"}
          </span>
          <Repeat className="absolute -bottom-1 -right-1 rounded-full border border-line bg-white p-1.5 text-moss" size={28} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/45">Jetzt dran</p>
          <p className="mt-0.5 text-xl font-semibold" data-testid="rotation-current">{assignee?.name ?? "Unbekannt"}</p>
          <p className="mt-2 truncate text-xs text-ink/55" title={rotation.participantIds.map(nameFor).join(" → ")}>
            {rotation.participantIds.map(nameFor).join(" → ")}
          </p>
          {rotation.lastCompletedAt ? (
            <p className="mt-1 text-xs text-ink/45">
              Zuletzt {formatDate(rotation.lastCompletedAt.slice(0, 10))} · {lastCompletedBy?.name ?? "Unbekannt"}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <button className="primary-button w-full" type="button" onClick={() => void onComplete()}>
          <CheckCircle2 size={17} />
          {rotation.title} erledigt
        </button>
      </div>
    </article>
  );
}

function RotationPanel({
  rotation,
  onClose,
  onSaved,
  onError,
}: {
  rotation: Rotation | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<RotationForm>(() =>
    rotation
      ? { title: rotation.title, description: rotation.description, participantIds: rotation.participantIds }
      : defaultRotationForm(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(rotation ? `/api/tasks/rotations/${rotation.id}` : "/api/tasks/rotations", {
        method: rotation ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (unknownError) {
      onError(readError(unknownError));
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid bg-ink/40 p-3 sm:place-items-center">
      <section className="w-full rounded-md border border-line bg-white p-4 shadow-soft sm:max-w-lg sm:p-5">
        <FormHeader title={rotation ? "Rad bearbeiten" : "Neues Rad"} onClose={onClose} />
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="label">Name</span>
            <input
              className="input"
              required
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label className="block">
            <span className="label">Notiz</span>
            <textarea
              className="input min-h-20"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <RoommateChecks
            selected={form.participantIds}
            onChange={(participantIds) => setForm((current) => ({ ...current, participantIds }))}
          />
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button className="secondary-button" type="button" onClick={onClose}>Abbrechen</button>
            <button className="primary-button" type="submit">Speichern</button>
          </div>
        </form>
      </section>
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
          {form.scheduleWeekday ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Alle (Wochen)</span>
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
                <span className="label">Wochentag</span>
                <select
                  className="input"
                  value={form.scheduleWeekday}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduleWeekday: event.target.value as Weekday,
                    }))
                  }
                >
                  {weekdayOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="rounded bg-cloud px-3 py-2 text-sm text-ink/70">
              Bestehender {frequencyLabel(form.frequencyInterval, chore?.frequencyUnit ?? "month")}-Rhythmus bleibt unverändert.
            </p>
          )}
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
          {chore.scheduleWeekday ? weekdayLabel(chore.scheduleWeekday) : formatDate(chore.nextDueDate)}
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
  const receiptItems = transaction.receiptItems ?? [];
  const hasReceiptDetails = receiptItems.length > 0 || Boolean(transaction.receiptUpload);

  return (
    <article className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
      </div>

      {isExpense && hasReceiptDetails ? (
        <details className="group mt-2 border-t border-line/70 pt-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1.5 text-xs font-medium text-ink/55 transition-colors hover:text-ink/75 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <FileText size={14} className="text-moss/70" />
              Rechnungsdetails
              {receiptItems.length ? (
                <span className="text-ink/40">· {receiptItems.length} Positionen</span>
              ) : null}
            </span>
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="pt-2">
            {transaction.receiptUpload ? (
              <a
                className="mb-2 flex items-center justify-between gap-3 rounded bg-cloud/70 px-2.5 py-2 transition-colors hover:bg-mint/40"
                href={transaction.receiptUpload.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={16} className="shrink-0 text-moss/80" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{transaction.receiptUpload.fileName}</span>
                    <span className="block text-xs text-ink/55">
                      Original · {formatFileSize(transaction.receiptUpload.sizeBytes)}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-moss">
                  Öffnen <ExternalLink size={14} />
                </span>
              </a>
            ) : (
              <p className="mb-2 border-l-2 border-line px-2 py-1 text-xs text-ink/45">
                Keine Originaldatei gespeichert.
              </p>
            )}

            {receiptItems.length ? (
              <div className="divide-y divide-line/70">
                {receiptItems.map((item, index) => (
                  <div className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto]" key={`${item.name}-${index}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-semibold">{item.normalizedName}</p>
                        <span className="rounded border border-moss/15 px-1.5 py-0.5 text-[10px] font-medium text-moss/80">
                          {item.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink/50">
                        {item.name}
                        {item.quantity ? <span className="ml-2 font-normal text-ink/50">{item.quantity}</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/55">{item.assignmentReason}</p>
                      <p className="mt-1 text-xs text-ink/70">
                        {item.splits.map((split) => `${nameFor(split.roommateId)} ${formatMoney(split.amountCents)}`).join(" · ")}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${item.amountCents < 0 ? "text-moss" : "text-ink"}`}>
                      {formatMoney(item.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function ProductTrackingCard({ transactions }: { transactions: FinanceTransaction[] }) {
  const { categories, products, positionCount } = summarizeProductTracking(transactions);
  const largestCategory = Math.max(...categories.map((entry) => Math.abs(entry.amountCents)), 1);

  return (
    <section className="overflow-hidden rounded-md border border-line bg-white" aria-labelledby="product-tracking-title">
      <div className="border-b border-line bg-mint/35 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tags size={18} className="text-moss" />
            <h3 id="product-tracking-title" className="font-semibold">Warengruppen</h3>
          </div>
          <span className="text-xs font-semibold text-ink/55">{positionCount} Positionen</span>
        </div>
        <p className="mt-1 text-xs text-ink/60">Generalisiert über alle importierten Rechnungen.</p>
      </div>

      {categories.length ? (
        <div className="space-y-3 p-4">
          {categories.map((entry) => (
            <div key={entry.name}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{entry.name}</span>
                <span className={entry.amountCents < 0 ? "font-semibold text-moss" : "font-semibold"}>
                  {formatMoney(entry.amountCents)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-cloud">
                <div
                  className={`h-full rounded-full ${entry.amountCents < 0 ? "bg-coral" : "bg-moss"}`}
                  style={{ width: `${Math.max(3, (Math.abs(entry.amountCents) / largestCategory) * 100)}%` }}
                />
              </div>
            </div>
          ))}

          <details className="group border-t border-line pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-moss [&::-webkit-details-marker]:hidden">
              Generalisierte Produkte
              <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 divide-y divide-line rounded-md border border-line">
              {products.map((entry) => (
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs" key={entry.name}>
                  <span className="min-w-0 truncate">
                    <strong>{entry.name}</strong>
                    <span className="ml-1 text-ink/45">× {entry.count}</span>
                  </span>
                  <span className="shrink-0 font-semibold">{formatMoney(entry.amountCents)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : (
        <EmptyState label="Noch keine Produktdaten." compact />
      )}
    </section>
  );
}

function summarizeProductTracking(transactions: FinanceTransaction[]) {
  const categoryTotals = new Map<string, number>();
  const productTotals = new Map<string, { amountCents: number; count: number }>();
  let positionCount = 0;

  for (const transaction of transactions) {
    for (const item of transaction.receiptItems ?? []) {
      positionCount += 1;
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.amountCents);
      const current = productTotals.get(item.normalizedName) ?? { amountCents: 0, count: 0 };
      current.amountCents += item.amountCents;
      current.count += 1;
      productTotals.set(item.normalizedName, current);
    }
  }

  return {
    positionCount,
    categories: [...categoryTotals.entries()]
      .map(([name, amountCents]) => ({ name, amountCents }))
      .sort((left, right) => Math.abs(right.amountCents) - Math.abs(left.amountCents)),
    products: [...productTotals.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((left, right) => right.amountCents - left.amountCents || left.name.localeCompare(right.name, "de")),
  };
}

function BalanceCard({ roommateId, cents }: { roommateId: string; cents: number }) {
  const roommate = findRoommate(roommateId);
  const label = cents > 0 ? "bekommt" : cents < 0 ? "zahlt" : "ausgeglichen";

  return (
    <article data-testid="balance-card" className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-white p-3 sm:p-4">
      <div className="min-w-0">
        <PersonBadge roommate={roommate ?? null} />
      </div>
      <div className="shrink-0 text-right">
        <span className={`block text-xs ${cents > 0 ? "text-moss" : cents < 0 ? "text-coral" : "text-ink/50"}`}>
          {label}
        </span>
        <p className="mt-0.5 text-lg font-semibold tracking-normal sm:text-xl">{formatMoney(Math.abs(cents))}</p>
      </div>
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

async function apiForm<T = unknown>(path: string, body: FormData, method = "POST"): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    body,
  });

  if (!response.ok) {
    let message = "Anfrage fehlgeschlagen.";
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
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

async function createExpenseFromReceipt(
  form: ReceiptImportForm,
  analysis: ReceiptAnalysis,
  originalFile: File | null,
): Promise<void> {
  if (analysis.totalCents <= 0 || analysis.roommateTotals.length === 0) {
    throw new Error("Die Analyse enthalt keine speicherbare Aufteilung.");
  }
  if (!receiptAnalysisIsValid(analysis)) {
    throw new Error("Die Positionsaufteilungen passen nicht zur Rechnung.");
  }

  const { transaction } = await api<{ transaction: FinanceTransaction }>("/api/finance/expenses", {
    method: "POST",
    body: JSON.stringify({
      description: form.description.trim() || analysis.merchant || "Rechnung",
      amountCents: analysis.totalCents,
      paidBy: form.paidBy,
      paidAt: form.paidAt,
      splitMode: "custom",
      participantIds: [],
      splits: analysis.roommateTotals.map((split) => ({
        roommateId: split.roommateId,
        owedCents: split.amountCents,
      })),
      receiptItems: analysis.items,
    }),
  });

  if (originalFile) {
    const upload = new FormData();
    upload.set("receipt", originalFile);
    await apiForm(`/api/finance/expenses/${transaction.id}/receipt-file`, upload, "PUT");
  }
}

function updateReceiptItemSplit(
  analysis: ReceiptAnalysis,
  itemIndex: number,
  roommateId: string,
  amountCents: number,
): ReceiptAnalysis {
  const items = analysis.items.map((item, index) => {
    if (index !== itemIndex) {
      return item;
    }

    const splitByRoommate = new Map(item.splits.map((split) => [split.roommateId, split.amountCents]));
    splitByRoommate.set(roommateId, amountCents);

    return {
      ...item,
      splits: roommateIds
        .map((id) => ({
          roommateId: id,
          amountCents: splitByRoommate.get(id) ?? 0,
        }))
        .filter((split) => split.amountCents !== 0),
    };
  });

  return {
    ...analysis,
    items,
    totalCents: items.reduce((total, item) => total + item.amountCents, 0),
    roommateTotals: aggregateReceiptSplits(items, roommateIds),
  };
}

function receiptAnalysisIsValid(analysis: ReceiptAnalysis): boolean {
  return analysis.items.length > 0 && analysis.items.every(receiptItemIsValid);
}

function receiptItemIsValid(item: ReceiptAnalysis["items"][number]): boolean {
  return item.splits.reduce((sum, split) => sum + split.amountCents, 0) === item.amountCents;
}

function centsFromNumberInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
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
    frequencyInterval: chore.frequencyInterval,
    scheduleWeekday: chore.scheduleWeekday,
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB`;
}

function frequencyLabel(interval: number, unit: FrequencyUnit): string {
  const label = unit === "day" ? "Tag" : unit === "week" ? "Woche" : "Monat";
  const plural = interval === 1 ? label : `${label}e`;
  return `${interval} ${plural}`;
}

const weekdayOptions: [Weekday, string][] = [
  ["monday", "Montag"],
  ["tuesday", "Dienstag"],
  ["wednesday", "Mittwoch"],
  ["thursday", "Donnerstag"],
  ["friday", "Freitag"],
  ["saturday", "Samstag"],
  ["sunday", "Sonntag"],
];

function weekdayLabel(weekday: Weekday): string {
  return weekdayOptions.find(([value]) => value === weekday)?.[1] ?? weekday;
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
