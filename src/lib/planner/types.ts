/** Injectable randomness so plans are reproducible under test. */
export type Rng = () => number;

export type PlannedRecipient = {
  label: string;
  amount: bigint;
  offsetMinutes: number;
};

export type PayoutPlan = {
  recipients: PlannedRecipient[];
  total: bigint;
};
