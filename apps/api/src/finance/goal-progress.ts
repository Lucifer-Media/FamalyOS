/**
 * Семейные копилки (Итерация 4) — по образцу Firefly III piggy banks и
 * прогноза «когда достигнем цели» из PariPari. Чистая логика без Prisma.
 *
 * Накоплено = стартовая сумма цели + сумма пополнений (financial_goal_contribution,
 * изъятия — отрицательные), либо — если у цели выбран режим ACCOUNT_BALANCE —
 * текущий баланс привязанного счёта.
 *
 * Прогноз: средний темп пополнений за последние 3 полных+текущий месяц →
 * сколько месяцев до цели и примерная дата; если задан срок — сколько нужно
 * откладывать в месяц, чтобы успеть.
 */

export interface GoalInput {
  id: string;
  name: string;
  targetAmount: number;
  currency?: string;
  deadline?: string;
  startAmount?: number;
  trackingMode?: 'CONTRIBUTIONS' | 'ACCOUNT_BALANCE';
  accountBalance?: number;
  status?: string;
}

export interface ContributionInput {
  date: string;
  amount: number;
}

export interface GoalProgress {
  goalId: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  percent: number;
  averageMonthlyContribution: number;
  monthsToGoal: number | null;
  estimatedDate: string | null;
  requiredMonthlyForDeadline: number | null;
  onTrack: boolean | null;
  isCompleted: boolean;
  contributionsCount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + (td - fd) / 30;
}

function addMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00Z');
  const whole = Math.floor(months);
  d.setUTCMonth(d.getUTCMonth() + whole);
  d.setUTCDate(d.getUTCDate() + Math.round((months - whole) * 30));
  return d.toISOString().slice(0, 10);
}

export function computeGoalProgress(goal: GoalInput, contributions: ContributionInput[], today: string, windowMonths = 3): GoalProgress {
  const contributionsSum = contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const saved =
    goal.trackingMode === 'ACCOUNT_BALANCE' && goal.accountBalance !== undefined
      ? goal.accountBalance
      : (goal.startAmount ?? 0) + contributionsSum;
  const target = Math.max(0, goal.targetAmount);
  const remaining = Math.max(0, target - saved);
  const isCompleted = target > 0 && saved >= target;

  // Темп: пополнения за окно [начало месяца (today - windowMonths), today].
  const t = new Date(today + 'T00:00:00Z');
  const windowStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - windowMonths, 1)).toISOString().slice(0, 10);
  const inWindow = contributions.filter((c) => c.date >= windowStart && c.date <= today);
  // Если копилка моложе окна — делим на её реальный возраст, а не на 3 месяца.
  const firstDate = contributions.map((c) => c.date).sort()[0];
  const effectiveStart = firstDate && firstDate > windowStart ? firstDate : windowStart;
  const spanMonths = Math.max(1, monthsBetween(effectiveStart, today));
  const avg = inWindow.length ? inWindow.reduce((s, c) => s + c.amount, 0) / spanMonths : 0;

  let monthsToGoal: number | null = null;
  let estimatedDate: string | null = null;
  if (isCompleted) {
    monthsToGoal = 0;
    estimatedDate = today;
  } else if (avg > 0) {
    monthsToGoal = Math.ceil((remaining / avg) * 10) / 10;
    estimatedDate = addMonths(today, monthsToGoal);
  }

  let requiredMonthlyForDeadline: number | null = null;
  let onTrack: boolean | null = null;
  if (goal.deadline && !isCompleted) {
    const monthsLeft = monthsBetween(today, goal.deadline.slice(0, 10));
    requiredMonthlyForDeadline = monthsLeft > 0 ? round2(remaining / Math.max(monthsLeft, 1)) : round2(remaining);
    onTrack = estimatedDate !== null && estimatedDate <= goal.deadline.slice(0, 10);
  } else if (isCompleted) {
    onTrack = true;
  }

  return {
    goalId: goal.id,
    name: goal.name,
    targetAmount: round2(target),
    savedAmount: round2(saved),
    remaining: round2(remaining),
    percent: target > 0 ? Math.min(100, Math.round((saved / target) * 1000) / 10) : 0,
    averageMonthlyContribution: round2(avg),
    monthsToGoal,
    estimatedDate,
    requiredMonthlyForDeadline,
    onTrack,
    isCompleted,
    contributionsCount: contributions.length,
  };
}
