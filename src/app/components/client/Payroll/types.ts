/** One recipient slot in a generated payroll plan. */
export type PlanRow = {
  label: string;
  amount: bigint;
  offsetMinutes: number;
  /** Generated in the browser, shared off-chain, never transmitted by this app. */
  secret: string;
  /** poseidon(TAG, secret, amount) — the only part that reaches the chain at funding. */
  commitment: string;
};

export type PayrollPlan = {
  rows: PlanRow[];
  total: bigint;
  batchId: string;
};
