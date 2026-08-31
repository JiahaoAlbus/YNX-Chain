import { parseStrategyMandate } from "@ynx-chain/wallet-auth";

export type StrategyMandateAcknowledgements = Readonly<{
  risk: boolean;
  fees: boolean;
}>;

export type StrategyMandateReviewRow = Readonly<{
  label: string;
  value: string;
  tone?: "default" | "safe" | "warning";
}>;

export type StrategyMandateReviewSection = Readonly<{
  id: string;
  title: string;
  rows: readonly StrategyMandateReviewRow[];
}>;

export type StrategyMandateReviewView = Readonly<{
  valid: boolean;
  canApprove: boolean;
  rejectAlwaysAvailable: true;
  error: string | null;
  acknowledgements: StrategyMandateAcknowledgements;
  sections: readonly StrategyMandateReviewSection[];
  effects: Readonly<{
    providerRequest: false;
    callback: false;
    signing: false;
    accountAccess: false;
    network: false;
  }>;
}>;

type StrategyTarget = Readonly<{
  address: string;
  role: "vault" | "pool" | "router";
  methods: readonly string[];
}>;

type ParsedStrategyMandate = Readonly<{
  schemaVersion: number;
  mandateId: string;
  account: string;
  productClientId: string;
  sessionBinding: string;
  strategyName: string;
  strategyHash: string;
  strategyVersion: string;
  engineCommit: string;
  engineRelease: string;
  executionKind: "exchange-subaccount" | "dex-strategy-vault";
  executionAccount: string;
  nonceDomain: string;
  allowedVenues: readonly string[];
  allowedAssets: readonly string[];
  allowedMarkets: readonly string[];
  allowedMethods: readonly string[];
  allowedContracts: readonly string[];
  allowedTargets: readonly StrategyTarget[];
  maxCapital: number;
  maxPosition: number;
  maxLeverageBps: number;
  maxOrder: number;
  maxSlippageBps: number;
  maxGas: number;
  maxFrequencyPerHour: number;
  dailyLossLimit: number;
  drawdownLimit: number;
  noWithdraw: true;
  ownerChangeAllowed: false;
  arbitraryTransferAllowed: false;
  unlimitedApprovalAllowed: false;
  computeDataFee: number;
  subscriptionFee: number;
  managementFeeBps: number;
  performanceFeeBps: number;
  highWaterMark: boolean;
  lossCarryForward: boolean;
  killSwitch: string;
  revoke: string;
  emergencyExit: string;
  userRiskAccepted: true;
  testnetNoValue: true;
  issuedAt: string;
  expiresAt: string;
  source: string;
  asOf: string;
  version: string;
}>;

const NO_EFFECTS = Object.freeze({
  providerRequest: false,
  callback: false,
  signing: false,
  accountAccess: false,
  network: false,
} as const);

export function buildStrategyMandateReview(
  input: unknown,
  acknowledgements: StrategyMandateAcknowledgements = { risk: false, fees: false },
  now = new Date(),
): StrategyMandateReviewView {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return invalid("Review time is invalid", acknowledgements);
  }

  let mandate: ParsedStrategyMandate;
  try {
    mandate = parseStrategyMandate(input) as ParsedStrategyMandate;
  } catch (caught) {
    return invalid(errorMessage(caught), acknowledgements);
  }

  const nowText = now.toISOString();
  if (mandate.issuedAt > nowText) return invalid("Mandate issuance is in the future", acknowledgements);
  if (mandate.expiresAt <= nowText) return invalid("Mandate has expired", acknowledgements);

  const boundaryRows = mandate.executionKind === "exchange-subaccount"
    ? exchangeBoundaryRows(mandate)
    : dexBoundaryRows(mandate);

  const sections: readonly StrategyMandateReviewSection[] = Object.freeze([
    section("identity", "Identity and source", [
      row("Mandate", `${mandate.mandateId} · schema v${mandate.schemaVersion}`),
      row("Wallet account", mandate.account),
      row("Product client", mandate.productClientId),
      row("Product Session binding", mandate.sessionBinding),
      row("Independent nonce domain", mandate.nonceDomain),
      row("Source", `${mandate.source}\n${mandate.version} · as of ${mandate.asOf}`),
    ]),
    section("engine", "Strategy and engine", [
      row("Strategy", `${mandate.strategyName}\n${mandate.strategyHash} · ${mandate.strategyVersion}`),
      row("Quant engine", `${mandate.engineCommit}\n${mandate.engineRelease}`),
      row("Execution boundary", `${mandate.executionKind}\n${mandate.executionAccount}`),
    ]),
    section("scope", "Exact execution scope", [
      row("Allowed venues", list(mandate.allowedVenues)),
      row("Allowed assets", list(mandate.allowedAssets)),
      row("Allowed markets", list(mandate.allowedMarkets)),
      row("Allowed methods", list(mandate.allowedMethods)),
      ...boundaryRows,
    ]),
    section("limits", "Capital and risk limits", [
      row("Maximum capital", amount(mandate.maxCapital)),
      row("Maximum position", amount(mandate.maxPosition)),
      row("Maximum leverage", `${bpsMultiplier(mandate.maxLeverageBps)}× (${mandate.maxLeverageBps} bps)`),
      row("Maximum order", amount(mandate.maxOrder)),
      row("Maximum slippage", `${mandate.maxSlippageBps} bps`),
      row("Maximum gas", amount(mandate.maxGas)),
      row("Maximum frequency", `${mandate.maxFrequencyPerHour} executions/hour`),
      row("Daily loss limit", amount(mandate.dailyLossLimit), "warning"),
      row("Drawdown limit", amount(mandate.drawdownLimit), "warning"),
      row("Validity", `${mandate.issuedAt}\nexpires ${mandate.expiresAt}`),
    ]),
    section("asset-safety", "Asset authority boundaries", [
      row("Withdrawals", "PROHIBITED — mandate cannot withdraw", "safe"),
      row("Owner changes", "PROHIBITED", "safe"),
      row("Arbitrary transfers", "PROHIBITED", "safe"),
      row("Unlimited approvals", "PROHIBITED", "safe"),
    ]),
    section("fees", "Explicit fees", [
      row("Compute / data fee", amount(mandate.computeDataFee)),
      row("Subscription fee", amount(mandate.subscriptionFee)),
      row("Management fee", `${mandate.managementFeeBps} bps`),
      row("Performance fee", `${mandate.performanceFeeBps} bps`),
      row("High-water mark", yesNo(mandate.highWaterMark), mandate.highWaterMark ? "safe" : "warning"),
      row("Loss carry-forward", yesNo(mandate.lossCarryForward), mandate.lossCarryForward ? "safe" : "warning"),
      row("Fee consent", "Managed-vault fees require a separate explicit approval. No hidden spread or unrealized-profit fee is authorized.", "warning"),
    ]),
    section("controls", "Immediate safety controls", [
      row("Kill switch", mandate.killSwitch),
      row("Revoke", mandate.revoke),
      row("Emergency exit", mandate.emergencyExit),
    ]),
    section("ownership", "Profit, loss and Testnet truth", [
      row("Real profit and loss", "The user bears real strategy gains and losses; performance is not guaranteed.", "warning"),
      row("Net assets", mandate.executionKind === "exchange-subaccount"
        ? "Net assets and realized net PnL remain in the user's exact Exchange subaccount."
        : "Net assets and realized net PnL remain in the user's exact DEX Strategy Vault."),
      row("Self-managed strategy", "Net assets and net PnL belong to the user. No performance fee applies unless explicitly listed and separately acknowledged."),
      row("Network disclaimer", "YNX Testnet assets have no real-world value.", "warning"),
    ]),
  ]);

  return Object.freeze({
    valid: true,
    canApprove: acknowledgements.risk === true && acknowledgements.fees === true,
    rejectAlwaysAvailable: true,
    error: null,
    acknowledgements: frozenAcknowledgements(acknowledgements),
    sections,
    effects: NO_EFFECTS,
  });
}

function exchangeBoundaryRows(mandate: ParsedStrategyMandate): readonly StrategyMandateReviewRow[] {
  return Object.freeze([
    row("Exchange subaccount", mandate.executionAccount),
    row("Subaccount only", "YES — no master-account or withdrawal authority", "safe"),
    row("No-withdraw API Wallet", "ENFORCED", "safe"),
    row("DEX contracts", "NONE"),
  ]);
}

function dexBoundaryRows(mandate: ParsedStrategyMandate): readonly StrategyMandateReviewRow[] {
  return Object.freeze([
    row("DEX Strategy Vault", mandate.executionAccount),
    row("Allowed contracts", list(mandate.allowedContracts)),
    row("Typed Vault / Pool / Router targets", mandate.allowedTargets.map(target => `${target.role.toUpperCase()} · ${target.address}\n${target.methods.join(", ")}`).join("\n\n")),
    row("No transfer / owner / unlimited approval", "ENFORCED — dangerous selectors are rejected before review", "safe"),
  ]);
}

function invalid(error: string, acknowledgements: StrategyMandateAcknowledgements): StrategyMandateReviewView {
  return Object.freeze({
    valid: false,
    canApprove: false,
    rejectAlwaysAvailable: true,
    error,
    acknowledgements: frozenAcknowledgements(acknowledgements),
    sections: Object.freeze([]),
    effects: NO_EFFECTS,
  });
}

function frozenAcknowledgements(value: StrategyMandateAcknowledgements): StrategyMandateAcknowledgements {
  return Object.freeze({ risk: value.risk === true, fees: value.fees === true });
}

function section(id: string, title: string, rows: readonly StrategyMandateReviewRow[]): StrategyMandateReviewSection {
  return Object.freeze({ id, title, rows: Object.freeze(rows) });
}

function row(label: string, value: string, tone: StrategyMandateReviewRow["tone"] = "default"): StrategyMandateReviewRow {
  return Object.freeze({ label, value, tone });
}

function list(values: readonly string[]): string { return values.length === 0 ? "NONE" : values.join("\n"); }
function amount(value: number): string { return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value); }
function bpsMultiplier(value: number): string { return (value / 10_000).toLocaleString("en", { maximumFractionDigits: 4 }); }
function yesNo(value: boolean): string { return value ? "REQUIRED / ENABLED" : "NOT ENABLED"; }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : "Mandate is invalid"; }
