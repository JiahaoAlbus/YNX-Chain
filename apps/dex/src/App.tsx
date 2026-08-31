import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { catalogs, locales } from "./i18n";
import {
  appendRiskAudit,
  buildRiskRequest,
  requestDigest,
  streamRiskExplanation,
  verifyRiskAudit,
} from "./riskAssistant";
import type { AuditAction, RiskContext } from "./riskAssistant";
import { useDexData } from "./useDexData";
import { aggregateCandles, type Candle } from "./candles";
import type { ChainEvent, Locale, Pool, Token } from "./types";
import {
  quoteNativeExactInput,
  quoteNativeExactOutput,
  type NativeQuote,
} from "./routing";
import { broadcastDexAction, loadAccountNonce } from "./api";
import {
  beginDexAction,
  beginWalletAuthorization,
  completeWalletCallback,
  connectStandardWallet,
  connectMetaMask,
  consumeDexActionCallback,
  restoreWalletSession,
  restoreStandardWallet,
  disconnectStandardWallet,
  observeStandardWallet,
  standardWalletDetails,
  WALLET_INSTALL_URL,
  WALLET_PRODUCT_URL,
  type DexWalletSession,
} from "./wallet";
import type {
  DexActionName,
  DexActionPayload,
  DexQuote,
} from "@ynx-chain/wallet-auth";

type Page =
  | "swap"
  | "pools"
  | "positions"
  | "explore"
  | "analytics"
  | "governance"
  | "docs";
const pages: Page[] = [
  "swap",
  "pools",
  "positions",
  "explore",
  "analytics",
  "governance",
  "docs",
];
const CPMM_VERSION = "ynx-native-dex-cpmm-v1";
const short = (value: string) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
const poolProtocol = (version: string) =>
  version === CPMM_VERSION ||
  version === "ynx-cpmm-v1" ||
  version === "ynx-consensus-cpmm-v13"
    ? "Chain-native constant product"
    : "Unsupported pool";
const parseUnits = (value: string, decimals: number) => {
  const [whole = "0", fraction = ""] = value.split(".");
  if (
    !/^\d+$/.test(whole) ||
    !/^[0-9]*$/.test(fraction) ||
    fraction.length > decimals
  )
    throw new Error(`Use at most ${decimals} decimal places.`);
  return BigInt(whole + fraction.padEnd(decimals, "0"));
};
const formatUnits = (value: bigint, decimals: number) => {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals) || "0";
  if (decimals === 0) return whole;
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return fraction ? `${whole}.${fraction}` : whole;
};

const minimumOutput = (amount: bigint, slippageBps: number) =>
  (amount * BigInt(10_000 - slippageBps)) / 10_000n;
const maximumInput = (amount: bigint, slippageBps: number) =>
  (amount * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
const safeNumber = (value: bigint, label: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error(`${label} exceeds the safe Testnet transaction range.`);
  return result;
};
const canonicalAsset = (value: string) =>
  value.toLowerCase() === "ynxt" ? "YNXT" : value.toLowerCase();

export default function App() {
  const [locale, setLocale] = useState<Locale>(
    () => (localStorage.getItem("ynx-dex-locale") as Locale) || "en",
  );
  const [page, setPage] = useState<Page>(() => {
    const value = location.hash.slice(1) as Page;
    return pages.includes(value) ? value : "swap";
  });
  const [theme, setTheme] = useState<"system" | "light" | "dark">(
    () =>
      (localStorage.getItem("ynx-dex-theme") as "system" | "light" | "dark") ||
      "system",
  );
  const [settings, setSettings] = useState(false);
  const [wallet, setWallet] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [walletAccount, setWalletAccount] = useState("");
  const [walletSession, setWalletSession] = useState<DexWalletSession | null>(
    null,
  );
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [metamaskAccount, setMetamaskAccount] = useState("");
  const standardWalletCleanup = useRef<(() => void) | null>(null);
  const [transactionState, setTransactionState] = useState<{
    busy: boolean;
    error: string;
    receipt: string;
  }>({ busy: false, error: "", receipt: "" });
  const { data, retry } = useDexData();
  const t = catalogs[locale];
  const rtl = locale === "ar";
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    localStorage.setItem("ynx-dex-locale", locale);
  }, [locale, rtl]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ynx-dex-theme", theme);
  }, [theme]);
  useEffect(() => {
    const onHash = () => {
      const value = location.hash.slice(1) as Page;
      if (pages.includes(value)) setPage(value);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (
          location.pathname ===
          new URL("https://dex.ynxweb4.com/wallet-auth/callback").pathname
        ) {
          const current = await completeWalletCallback(location.href);
          if (current && active) {
            setWalletSession(current);
            setWalletAccount(current.session.account);
            setWallet(true);
            history.replaceState({}, "", location.origin + "/");
          }
        } else if (
          location.pathname ===
          new URL("https://dex.ynxweb4.com/wallet-action/callback").pathname
        ) {
          const signed = consumeDexActionCallback(location.href);
          if (!signed)
            throw new Error(
              "DEX Wallet action callback is missing its signed response.",
            );
          const receipt = await broadcastDexAction(signed);
          if (active) {
            const current = await restoreWalletSession();
            setWalletSession(current);
            setWalletAccount(current?.session.account || signed.account);
            setTransactionState({
              busy: false,
              error: "",
              receipt: `Committed ${receipt.transactionHash} at block ${receipt.event.blockNumber}`,
            });
            history.replaceState({}, "", location.origin + "/");
            retry();
          }
        } else {
          const current = await restoreWalletSession();
          if (current && active) {
            setWalletSession(current);
            setWalletAccount(current.session.account);
          }
        }
      } catch (reason) {
        if (active) {
          setWalletError(
            reason instanceof Error
              ? reason.message
              : "Wallet return failed verification.",
          );
          setTransactionState({
            busy: false,
            error:
              reason instanceof Error
                ? reason.message
                : "DEX transaction failed closed.",
            receipt: "",
          });
          setWallet(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => () => standardWalletCleanup.current?.(), []);
  const bindStandardWallet = (provider: Parameters<typeof observeStandardWallet>[0]) => {
    standardWalletCleanup.current?.();
    standardWalletCleanup.current = observeStandardWallet(provider, (state) => {
      setWalletAccount(state.account || "");
      if (state.status !== "connected") setMetamaskAccount("");
      setWalletError(state.status === "connected" ? "" : "Standard Wallet disconnected. Read-only DEX remains available.");
    });
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      const launch = await beginWalletAuthorization();
      const provider = launch.providers.ynxWallet || launch.providers.metaMask;
      const providerKind = launch.providers.ynxWallet ? "ynx-wallet" : launch.providers.metaMask ? "metamask" : undefined;
      if (!provider || !providerKind) return;
      const account = await restoreStandardWallet(provider, providerKind);
      if (!active || !account) return;
      bindStandardWallet(provider);
      setWalletAccount(account);
      if (providerKind === "metamask") setMetamaskAccount(account);
    })().catch(() => undefined);
    return () => { active = false; };
  }, []);
  const connectWallet = async () => {
    setWalletBusy(true);
    setWalletError("");
    try {
      const launch = await beginWalletAuthorization();
      const provider=launch.providers.ynxWallet;
      if (launch.status === "provider-ready" && provider) {
        const account=await connectStandardWallet(provider,"ynx-wallet");
        bindStandardWallet(provider);
        setWalletAccount(account);
        setWalletError("Standard Wallet connected on YNX Testnet. Product Session, approval, swap, liquidity and token approval remain separate.");
        setWallet(false);
      } else
        setWalletError("YNX Wallet is unavailable in this browser. DEX remains open; use the official download or MetaMask options below.");
    } catch (reason) {
      setWalletError(
        reason instanceof Error ? reason.message : "Unable to open YNX Wallet.",
      );
    } finally {
      setWalletBusy(false);
    }
  };
  const connectEvm = async () => {
    setWalletBusy(true);
    setWalletError("");
    try {
      const launch=await beginWalletAuthorization();
      const provider=launch.providers.metaMask;
      if(!provider)throw new Error("MetaMask is unavailable in this browser. Install or unlock MetaMask, then retry.");
      const account=await connectMetaMask(provider);
      bindStandardWallet(provider);
      setMetamaskAccount(account);
      setWalletAccount(account);
      setWallet(false);
    } catch (reason) {
      setWalletError(
        reason instanceof Error
          ? reason.message
          : "Unable to connect MetaMask.",
      );
    } finally {
      setWalletBusy(false);
    }
  };
  const requestAction = async (
    action: DexActionName,
    payload: DexActionPayload,
    quote: DexQuote,
  ) => {
    if (!walletSession) {
      setWallet(true);
      setWalletError(
        "Connect YNX Wallet to review and sign this exact transaction. The quote remains available without login.",
      );
      return;
    }
    setTransactionState({ busy: true, error: "", receipt: "" });
    try {
      const accountNonce = await loadAccountNonce(walletSession.session.account);
      await beginDexAction({ action, payload, quote, accountNonce });
    } catch (reason) {
      setTransactionState({
        busy: false,
        error:
          reason instanceof Error
            ? reason.message
            : "DEX transaction request failed closed.",
        receipt: "",
      });
    }
  };
  const navigate = (next: Page) => {
    location.hash = next;
    setPage(next);
    setMobileMenu(false);
  };
  const pools = data.state === "ready" ? data.data.pools : [];
  const tokens = data.state === "ready" ? data.data.tokens : [];
  const events = data.state === "ready" ? data.data.events : [];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="brand-row">
          <Mark />
          <div>
            <strong>YNX DEX</strong>
            <span>{t.testnet}</span>
          </div>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobileMenu(false)}
            aria-label={t.close}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav>
          {pages.map((item) => (
            <button
              key={item}
              aria-current={page === item ? "page" : undefined}
              onClick={() => navigate(item)}
            >
              <Icon name={item} />
              <span>{t[item]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="network-dot" aria-hidden="true" />
          <div>
            <strong>{t.network}</strong>
            <span>
              {data.state === "ready"
                ? `${t.latestBlock} ${data.data.analytics.latestBlock || "—"}`
                : t.unavailable}
            </span>
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileMenu(true)}
            aria-label={t.menu}
          >
            <Icon name="menu" />
          </button>
          <div className="mobile-brand">
            <Mark />
            <strong>DEX</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label={t.settings}
            >
              <Icon name="settings" />
            </button>
            <button className="wallet-button" onClick={() => setWallet(true)}>
              <Icon name="wallet" />
              {walletAccount ? short(walletAccount) : t.connect}
            </button>
          </div>
        </header>
        {!navigator.onLine && (
          <div className="offline-banner" role="status">
            <Icon name="offline" />
            {t.offline}
          </div>
        )}
        <div className="runtime-banner" role="status">
          <Icon name="warning" />
          <div>
            <strong>{t.runtimeTitle}</strong>
            <span>{t.runtimeDetail}</span>
          </div>
        </div>
        {transactionState.receipt && (
          <div className="offline-banner" role="status">
            <Icon name="security" />
            {transactionState.receipt}
          </div>
        )}
        {transactionState.error && (
          <div className="offline-banner" role="alert">
            <Icon name="warning" />
            {transactionState.error}
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {page === "swap" && (
            <SwapPage
              pools={pools}
              tokens={tokens}
              loading={data.state === "loading"}
              error={data.state === "error" ? data.message : ""}
              retry={retry}
              t={t}
              walletAccount={walletAccount}
              actionBusy={transactionState.busy}
              action={requestAction}
            />
          )}
          {page === "pools" && (
            <PoolsPage
              pools={pools}
              tokens={tokens}
              state={data}
              retry={retry}
              t={t}
              walletAccount={walletAccount}
              actionBusy={transactionState.busy}
              action={requestAction}
            />
          )}
          {page === "positions" && (
            <EmptyPage
              icon="positions"
              title={t.emptyPositions}
              detail={t.centralPending}
              action={t.connect}
              onAction={() => setWallet(true)}
            />
          )}
          {page === "explore" && (
            <ExplorePage
              events={events}
              tokens={tokens}
              state={data}
              retry={retry}
              t={t}
            />
          )}
          {page === "analytics" && <AnalyticsPage data={data} t={t} />}
          {page === "governance" && (
            <InfoPage
              title={t.governance}
              text={t.governanceText}
              rows={[
                ["Pool model", CPMM_VERSION],
                ["State version", "native-dex-schema-v1"],
                [t.status, "Authoritative public Testnet state"],
                [t.security, "Wallet-signed action + chain transaction evidence"],
              ]}
            />
          )}
          {page === "docs" && (
            <InfoPage
              title={t.docs}
              text={t.docsText}
              rows={[
                [t.network, "6423 / ynx_6423-1"],
                ["Read route", "/v1/native-snapshot"],
                ["Action routes", "/dex/pools/{id}/…"],
                [t.source, "authoritative chain-native YNX Testnet state"],
              ]}
            />
          )}
        </main>
      </section>
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {(["swap", "pools", "positions", "explore"] as Page[]).map((item) => (
          <button
            key={item}
            aria-current={page === item ? "page" : undefined}
            onClick={() => navigate(item)}
          >
            <Icon name={item} />
            <span>{t[item]}</span>
          </button>
        ))}
      </nav>
      {settings && (
        <Modal title={t.settings} close={() => setSettings(false)}>
          <div className="settings-list">
            <label>
              <span>{t.language}</span>
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
              >
                {locales.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t.appearance}</legend>
              {(["system", "light", "dark"] as const).map((item) => (
                <label key={item}>
                  <input
                    type="radio"
                    checked={theme === item}
                    onChange={() => setTheme(item)}
                  />
                  <span>{t[item]}</span>
                </label>
              ))}
            </fieldset>
            <div className="settings-note">
              <Icon name="security" />
              <div>
                <strong>{t.security}</strong>
                <p>{t.liveOnly}</p>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {wallet && (
        <Modal title={t.connect} close={() => setWallet(false)}>
          <div className="wallet-state">
            <span
              className={`state-icon ${walletSession ? "success" : "warning"}`}
            >
              <Icon name="wallet" />
            </span>
            <h3>
              {walletSession
                ? "Central Wallet Product Session active"
                : metamaskAccount
                  ? `MetaMask ${short(metamaskAccount)}`
                  : "Choose a wallet"}
            </h3>
            <p>
              {walletSession
                ? "The Wallet approval, protected browser device and central Product Session are bound to this DEX identity. Every transaction still requires a separate exact Wallet review."
                : metamaskAccount
                  ? "MetaMask is connected for the EVM compatibility surface. Private DEX positions and every chain-native trade still require a proof-bound YNX Wallet session."
                  : "YNX Wallet will show the exact DEX identity and permissions before you approve. DEX never receives your recovery key or signing key. MetaMask can connect only to the EVM compatibility surface."}
            </p>
            <dl>
              <div>
                <dt>{t.network}</dt>
                <dd>ynx_6423-1</dd>
              </div>
              <div>
                <dt>Client</dt>
                <dd>ynx-dex-web-v1</dd>
              </div>
              <div>
                <dt>Scopes</dt>
                <dd>
                  account:read · dex:positions:read · dex:transaction:request
                </dd>
              </div>
              {walletAccount && (
                <div>
                  <dt>Account</dt>
                  <dd>{walletAccount}</dd>
                </div>
              )}
              {walletAccount && (
                <>
                  <div><dt>Provider</dt><dd>{standardWalletDetails().providerKind === "metamask" ? "MetaMask" : "YNX Wallet"}</dd></div>
                  <div><dt>Standard connection</dt><dd>{standardWalletDetails().chainId || "not connected"}</dd></div>
                </>
              )}
              {walletSession && (
                <div>
                  <dt>Session expires</dt>
                  <dd>{walletSession.session.expiresAt}</dd>
                </div>
              )}
            </dl>
            {walletError && (
              <p className="review-blocker" role="alert">
                {walletError}
              </p>
            )}
            <div className="wallet-options">
              <button
                className="primary"
                disabled={walletBusy}
                onClick={() => void connectWallet()}
              >
                {walletBusy
                  ? "Preparing protected device…"
                  : walletSession
                    ? "Reconnect YNX Wallet"
                    : t.confirmWallet}
              </button>
              <a className="secondary" href={WALLET_INSTALL_URL}>
                Download YNX Wallet
              </a>
              <button
                className="secondary"
                disabled={walletBusy}
                onClick={() => void connectEvm()}
              >
                Connect MetaMask
              </button>
              {walletAccount && (
                <button className="secondary" onClick={() => {standardWalletCleanup.current?.();standardWalletCleanup.current=null;disconnectStandardWallet();setWalletAccount("");setMetamaskAccount("");setWalletError("Standard Wallet disconnected. Read-only DEX remains available.");}}>
                  Disconnect wallet
                </button>
              )}
              {walletAccount && (
                <button className="secondary" onClick={() => {standardWalletCleanup.current?.();standardWalletCleanup.current=null;disconnectStandardWallet();setWalletAccount("");setMetamaskAccount("");setWalletError("Choose YNX Wallet or MetaMask to switch providers. No account request was sent.");}}>
                  Switch wallet
                </button>
              )}
            </div>
            <a className="wallet-product-link" href={WALLET_PRODUCT_URL}>
              Version, signature and installation details
            </a>
          </div>
        </Modal>
      )}
      {mobileMenu && (
        <button
          className="scrim"
          aria-label={t.close}
          onClick={() => setMobileMenu(false)}
        />
      )}
    </div>
  );
}

function SwapPage({
  pools,
  tokens,
  loading,
  error,
  retry,
  t,
  walletAccount,
  actionBusy,
  action,
}: {
  pools: Pool[];
  tokens: Token[];
  loading: boolean;
  error: string;
  retry: () => void;
  t: typeof catalogs.en;
  walletAccount: string;
  actionBusy: boolean;
  action: (
    name: DexActionName,
    payload: DexActionPayload,
    quote: DexQuote,
  ) => Promise<void>;
}) {
  const [review, setReview] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const tokenMap = useMemo(
    () => new Map(tokens.map((token) => [token.address.toLowerCase(), token])),
    [tokens],
  );
  const choices = useMemo(
    () => tokens.map((token) => token.address.toLowerCase()),
    [tokens],
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [swapMode, setSwapMode] = useState<"exact-input" | "exact-output">(
    "exact-input",
  );
  useEffect(() => {
    if (choices.length > 1) {
      setFrom((value) => value || choices[0]);
      setTo((value) => value || choices[1]);
    }
  }, [choices]);
  const quoteState = useMemo(() => {
    if (!from || !to || !amount)
      return { quote: null as NativeQuote | null, error: "" };
    const source = tokenMap.get(swapMode === "exact-input" ? from : to);
    try {
      if (!source) throw new Error("Token metadata is unavailable.");
      const raw = parseUnits(amount, source.decimals);
      if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
      return {
        quote:
          swapMode === "exact-input"
            ? quoteNativeExactInput(raw, from, to, pools)
            : quoteNativeExactOutput(raw, from, to, pools),
        error: "",
      };
    } catch (reason) {
      return {
        quote: null,
        error: reason instanceof Error ? reason.message : "Quote unavailable.",
      };
    }
  }, [amount, from, to, pools, swapMode, tokenMap]);
  const inputToken = tokenMap.get(from);
  const outputToken = tokenMap.get(to);
  const input =
    swapMode === "exact-input"
      ? amount
      : quoteState.quote && inputToken
        ? formatUnits(quoteState.quote.amountIn, inputToken.decimals)
        : "";
  const output =
    swapMode === "exact-output"
      ? amount
      : quoteState.quote && outputToken
        ? formatUnits(quoteState.quote.amountOut, outputToken.decimals)
        : "";
  const boundedAmount =
    quoteState.quote && (swapMode === "exact-input" ? outputToken : inputToken)
      ? formatUnits(
          swapMode === "exact-input"
            ? minimumOutput(quoteState.quote.amountOut, 50)
            : maximumInput(quoteState.quote.amountIn, 50),
          (swapMode === "exact-input" ? outputToken : inputToken)!.decimals,
        )
      : "";
  const impact = quoteState.quote ? quoteState.quote.priceImpactBps : null;
  const stale = Boolean(
    quoteState.quote && clock - Date.parse(quoteState.quote.quotedAt) > 15_000,
  );
  const highImpact = impact !== null && impact >= 500;
  useEffect(() => {
    if (!quoteState.quote) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quoteState.quote]);
  useEffect(() => {
    if (stale) {
      setReview(false);
      setAssistant(false);
    }
  }, [stale]);
  const continueInWallet = async () => {
    if (!quoteState.quote) return;
    if (quoteState.quote.execution !== "direct" || quoteState.quote.route.length !== 1)
      throw new Error(
        "This is a multi-hop quote only. Chain-native multi-hop execution is not yet attested, so no Wallet transaction can be requested.",
      );
    const pool = pools.find((item) => item.address === quoteState.quote?.route[0]?.pool),
      source = tokenMap.get(from);
    if (!pool || !source)
      throw new Error("Committed pool or token metadata is unavailable.");
    const deadlineUnix = Math.floor(Date.now() / 1000) + 240;
    setReview(false);
    await action(
      swapMode === "exact-input"
        ? "dex_swap_exact_input"
        : "dex_swap_exact_output",
      swapMode === "exact-input"
        ? {
            poolId: pool.address,
            assetIn: canonicalAsset(from),
            amountIn: safeNumber(quoteState.quote.amountIn, "Input amount"),
            minAmountOut: safeNumber(
              minimumOutput(quoteState.quote.amountOut, 50),
              "Minimum output",
            ),
            deadlineUnix,
          }
        : {
            poolId: pool.address,
            assetOut: canonicalAsset(to),
            amountOut: safeNumber(quoteState.quote.amountOut, "Output amount"),
            maxAmountIn: safeNumber(
              maximumInput(quoteState.quote.amountIn, 50),
              "Maximum input",
            ),
            deadlineUnix,
          },
      {
        poolId: pool.address,
        poolBlockHeight: pool.updatedBlock,
        poolUpdatedAt: new Date(pool.updatedAt).toISOString(),
        asset0: canonicalAsset(pool.token0),
        asset1: canonicalAsset(pool.token1),
        reserve0: safeNumber(BigInt(pool.reserve0), "Pool reserve 0"),
        reserve1: safeNumber(BigInt(pool.reserve1), "Pool reserve 1"),
        feeBps: pool.feeBps,
        expectedAmount: safeNumber(
          quoteState.quote.amountOut,
          "Expected output",
        ),
      },
    );
  };
  return (
    <div className="swap-layout">
      <section className="composer-column">
        <div className="page-kicker">
          <span>{t.testnet}</span>
          <span>•</span>
          <span>{t.protocol}</span>
        </div>
        <h1>{t.swap}</h1>
        <p className="lede">{t.liveOnly}</p>
        <div className="swap-composer">
          <div
            className="segmented"
            role="tablist"
            aria-label="Swap amount mode"
          >
            <button
              role="tab"
              aria-selected={swapMode === "exact-input"}
              onClick={() => {
                setSwapMode("exact-input");
                setAmount("");
                setReview(false);
              }}
            >
              Exact input
            </button>
            <button
              role="tab"
              aria-selected={swapMode === "exact-output"}
              onClick={() => {
                setSwapMode("exact-output");
                setAmount("");
                setReview(false);
              }}
            >
              Exact output
            </button>
          </div>
          <TokenAmount
            label={t.from}
            value={input}
            onChange={swapMode === "exact-input" ? setAmount : () => undefined}
            token={from}
            onToken={setFrom}
            tokens={tokens}
            readonly={swapMode === "exact-output"}
          />
          <button
            className="swap-direction"
            aria-label="Reverse tokens"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <Icon name="down" />
          </button>
          <TokenAmount
            label={t.to}
            value={output}
            onChange={swapMode === "exact-output" ? setAmount : () => undefined}
            token={to}
            onToken={setTo}
            tokens={tokens}
            readonly={swapMode === "exact-input"}
          />
          {loading ? (
            <Skeleton rows={2} />
          ) : error ? (
            <InlineError message={error} retry={retry} label={t.retry} />
          ) : (
            <div
              className={`quote-empty ${stale || highImpact ? "quote-warning" : ""}`}
            >
              <Icon name={stale || highImpact ? "warning" : "route"} />
              <div>
                <strong>
                  {stale
                    ? "Quote expired"
                    : quoteState.quote?.execution === "multi_hop_quote_only"
                      ? `${quoteState.quote.route.length}-hop chain-native quote`
                    : highImpact
                      ? t.highImpact
                    : quoteState.quote
                      ? quoteState.quote.execution === "direct"
                          ? "Direct chain-native pool route"
                          : "Chain-native route"
                        : t.noRoute}
                </strong>
                <span>
                  {stale
                    ? "Refresh the amount or token selection before review."
                    : quoteState.quote?.execution === "multi_hop_quote_only"
                      ? "Each hop is quoted from committed reserves. Execution stays disabled until the chain-native router is attested."
                    : highImpact
                      ? "Price impact is 5% or higher. Review size and route."
                    : quoteState.quote
                      ? quoteState.quote.execution === "direct"
                          ? "Deterministic quote from authoritative chain-native reserves."
                          : "Deterministic quote from authoritative chain-native reserves."
                        : quoteState.error || t.routeHint}
                </span>
              </div>
            </div>
          )}
          <button
            className="primary review-button"
            disabled={!quoteState.quote}
            onClick={() => (stale ? retry() : setReview(true))}
          >
            {stale ? "Refresh quote" : t.review}
          </button>
        </div>
      </section>
      <aside className="inspector" aria-label={t.details}>
        <h2>{t.details}</h2>
        <InspectorRow
          label="Route"
          value={
            quoteState.quote
              ? `${tokenMap.get(from)?.symbol || short(from)} → ${tokenMap.get(to)?.symbol || short(to)}`
              : "—"
          }
        />
        <InspectorRow
          label="Consensus route"
          value={
            quoteState.quote
              ? quoteState.quote.route.map((hop) => hop.pool).join(" → ")
              : "—"
          }
        />
        <InspectorRow
          label="Route state"
          value={
            quoteState.quote
              ? `Blocks ${quoteState.quote.stateAnchor.earliestBlock}–${quoteState.quote.stateAnchor.latestBlock}`
              : "—"
          }
        />
        <InspectorRow
          label={t.fees}
          value={
            quoteState.quote
              ? `${(quoteState.quote.feeBps / 100).toFixed(2)}%`
              : "—"
          }
        />
        <InspectorRow
          label={swapMode === "exact-input" ? t.minimum : "Maximum paid"}
          value={boundedAmount || "—"}
        />
        <InspectorRow
          label="Price impact"
          value={
            impact === null
              ? "—"
              : `${(impact / 100).toFixed(2)}%${highImpact ? " · high" : ""}`
          }
        />
        <InspectorRow label={t.slippage} value="0.50%" />
        <InspectorRow label={t.deadline} value="10 min" />
        <InspectorRow label={t.gas} value="Wallet estimate required" />
        <div className="risk-note">
          <Icon name="security" />
          <p>
            Quote math mirrors the chain-native constant-product pool. Wallet
            must independently rebuild and sign the exact action.
          </p>
        </div>
        <button
          className="assistant-button"
          disabled={!quoteState.quote || stale}
          onClick={() => setAssistant(true)}
        >
          <Icon name="info" />
          Explain risk with AI
        </button>
      </aside>
      {review && quoteState.quote && (
        <Modal title={t.review} close={() => setReview(false)}>
          <div className="review-sheet">
            <div className="review-amount">
              <span>{t.from}</span>
              <strong>
                {input} {tokenMap.get(from)?.symbol}
              </strong>
            </div>
            <div className="review-amount">
              <span>{t.to}</span>
              <strong>
                {output} {tokenMap.get(to)?.symbol}
              </strong>
            </div>
            <dl>
              <div>
                <dt>Input chain-native asset</dt>
                <dd>{from}</dd>
              </div>
              <div>
                <dt>Output chain-native asset</dt>
                <dd>{to}</dd>
              </div>
              <div>
                <dt>Consensus route</dt>
                <dd>{quoteState.quote.route.map((hop) => hop.pool).join(" → ")}</dd>
              </div>
              <div>
                <dt>Route state anchors</dt>
                <dd>
                  {quoteState.quote.route
                    .map(
                      (hop) =>
                        `${hop.pool}@${hop.state.blockHeight} · ${hop.state.auditHash}`,
                    )
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>Signed action</dt>
                <dd>
                  {swapMode === "exact-input"
                    ? "dex_swap_exact_input"
                    : "dex_swap_exact_output"}
                </dd>
              </div>
              <div>
                <dt>{t.fees}</dt>
                <dd>{(quoteState.quote.feeBps / 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Route fee breakdown</dt>
                <dd>
                  {quoteState.quote.route
                    .map((hop) => `${hop.pool}: ${(hop.feeBps / 100).toFixed(2)}%`)
                    .join(" · ")}
                </dd>
              </div>
              <div>
                <dt>
                  {swapMode === "exact-input" ? t.minimum : "Maximum paid"}
                </dt>
                <dd>
                  {boundedAmount}{" "}
                  {tokenMap.get(swapMode === "exact-input" ? to : from)?.symbol}
                </dd>
              </div>
              <div>
                <dt>Price impact</dt>
                <dd>{(quoteState.quote.priceImpactBps / 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>{t.slippage}</dt>
                <dd>0.50%</dd>
              </div>
              <div>
                <dt>{t.deadline}</dt>
                <dd>4 min</dd>
              </div>
              <div>
                <dt>{t.network}</dt>
                <dd>Chain 6423 · native-dex-schema-v1</dd>
              </div>
            </dl>
            <div className="review-warning">
              <Icon name="warning" />
              <p>
                The canonical Wallet independently shows the exact asset IDs,
                pool ID, amount, minimum output, account nonce and deadline
                before signing.
              </p>
            </div>
            {quoteState.quote.execution !== "direct" && (
              <p className="review-blocker">
                This multi-hop result is a read-only quote from committed reserves.
                DEX will not request a Wallet signature until a chain-native router
                binds the complete route and minimum output.
              </p>
            )}
            <button
              className="primary"
              disabled={actionBusy || stale || quoteState.quote.execution !== "direct"}
              onClick={() => void continueInWallet()}
            >
              {actionBusy
                ? "Checking Product Session…"
                : quoteState.quote.execution !== "direct"
                  ? "Multi-hop execution unavailable"
                : walletAccount
                  ? t.confirmWallet
                  : "Connect Wallet to continue"}
            </button>
            <p className="review-blocker">
              Wallet returns a signed transaction only. DEX broadcasts unchanged
              bytes and reports matching pool and chain-event evidence; any mismatch
              fails closed.
            </p>
          </div>
        </Modal>
      )}
      {assistant && quoteState.quote && (
        <RiskAssistantModal
          close={() => setAssistant(false)}
          context={{
            pair: `${tokenMap.get(from)?.symbol || short(from)} / ${tokenMap.get(to)?.symbol || short(to)}`,
            amount: `${input} ${tokenMap.get(from)?.symbol || "token"}`,
            routePools: quoteState.quote.route.map((hop) => hop.pool),
            minimumReceived:
              swapMode === "exact-input"
                ? `${boundedAmount} ${tokenMap.get(to)?.symbol || "token"}`
                : `exact output ${output} ${tokenMap.get(to)?.symbol || "token"}; maximum ${boundedAmount} ${tokenMap.get(from)?.symbol || "token"}`,
            priceImpactBps: quoteState.quote.priceImpactBps,
            slippageBps: 50,
            deadlineSeconds: 600,
          }}
        />
      )}
    </div>
  );
}

function RiskAssistantModal({
  close,
  context,
}: {
  close: () => void;
  context: RiskContext;
}) {
  const keys = Object.keys(context) as (keyof RiskContext)[];
  const [selected, setSelected] = useState(keys);
  const [permission, setPermission] = useState(false);
  const [stage, setStage] = useState<
    "preview" | "streaming" | "review" | "applied" | "rejected" | "error"
  >("preview");
  const [output, setOutput] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [auditValid, setAuditValid] = useState<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);
  const endpoint = String(import.meta.env.VITE_DEX_AI_GATEWAY_URL || "");
  const provider = String(
    import.meta.env.VITE_DEX_AI_PROVIDER || "canonical YNX AI Gateway",
  );
  const model = String(
    import.meta.env.VITE_DEX_AI_MODEL || "risk-explainer-v1",
  );
  const status = endpoint ? ("available" as const) : ("unavailable" as const);
  const request = useMemo(() => {
    try {
      return buildRiskRequest({
        context,
        selectedContext: selected,
        provider,
        model,
      });
    } catch {
      return null;
    }
  }, [context, selected, provider, model]);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!request) return;
      const digest = await requestDigest(request);
      await appendRiskAudit(localStorage, "ynx-dex-risk-audit", {
        action: "previewed",
        requestDigest: digest,
        detail: `context:${request.selectedContext.join(",")}`,
      });
      if (active)
        setAuditValid(
          await verifyRiskAudit(localStorage, "ynx-dex-risk-audit"),
        );
    })();
    return () => {
      active = false;
    };
  }, [request]);
  useEffect(() => () => controller.current?.abort(), []);
  const audit = async (action: AuditAction, detail: string) => {
    if (!request) return;
    await appendRiskAudit(localStorage, "ynx-dex-risk-audit", {
      action,
      requestDigest: await requestDigest(request),
      detail,
    });
    setAuditValid(await verifyRiskAudit(localStorage, "ynx-dex-risk-audit"));
  };
  const run = async () => {
    if (!request) return;
    setError("");
    setOutput("");
    const next = new AbortController();
    controller.current = next;
    try {
      await audit("permission-granted", "scope:dex:risk-explanation");
      await audit("started", `${provider}/${model}`);
      setStage("streaming");
      const result = await streamRiskExplanation({
        endpoint,
        request,
        providerStatus: status,
        permission: { granted: permission, scope: "dex:risk-explanation" },
        signal: next.signal,
        onDelta: (text) => setOutput((value) => value + text),
      });
      setOutput(result.text);
      setCost(result.costMicros);
      setStage("review");
      await audit(
        "reviewed",
        `costMicros:${result.costMicros ?? "unreported"}`,
      );
    } catch (reason) {
      const code =
        reason && typeof reason === "object" && "code" in reason
          ? String(reason.code)
          : "FAILED";
      setError(reason instanceof Error ? reason.message : "AI request failed.");
      setStage(code === "CANCELLED" ? "preview" : "error");
      await audit(code === "CANCELLED" ? "cancelled" : "failed", code);
    } finally {
      controller.current = null;
    }
  };
  const decide = async (action: "applied" | "rejected") => {
    setStage(action);
    await audit(
      action,
      action === "applied"
        ? "explanation attached to local review only"
        : "explanation rejected",
    );
  };
  return (
    <Modal title="AI risk explanation" close={close}>
      <div className="assistant-flow">
        <ol className="flow-steps">
          <li className="active">Preview</li>
          <li className={stage !== "preview" ? "active" : ""}>Stream</li>
          <li
            className={
              ["review", "applied", "rejected"].includes(stage) ? "active" : ""
            }
          >
            Review
          </li>
          <li
            className={["applied", "rejected"].includes(stage) ? "active" : ""}
          >
            Decision
          </li>
        </ol>
        <section>
          <h3>1. Select context</h3>
          <p>
            Only the checked quote facts will be sent. No account, session, or
            signing data is included.
          </p>
          <div className="context-grid">
            {keys.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={() =>
                    setSelected((value) =>
                      value.includes(key)
                        ? value.filter((item) => item !== key)
                        : [...value, key],
                    )
                  }
                />
                <span>{key}</span>
              </label>
            ))}
          </div>
        </section>
        <section>
          <h3>2. Provider, status & cost</h3>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>{provider}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{model}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>
                {cost === null
                  ? "Not incurred / unreported"
                  : `${cost} provider µ-cost units`}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>3. Permission</h3>
          <label className="permission">
            <input
              type="checkbox"
              checked={permission}
              disabled={status !== "available"}
              onChange={(event) => setPermission(event.target.checked)}
            />
            <span>
              Allow one risk-explanation request with the selected context.
            </span>
          </label>
          {status !== "available" && (
            <p className="assistant-unavailable">
              Provider unavailable. Configure the canonical AI Gateway; no
              canned explanation will be shown.
            </p>
          )}
        </section>
        {output && (
          <section aria-live="polite">
            <h3>4. Stream & review</h3>
            <div className="assistant-output">{output}</div>
          </section>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <Icon name="warning" />
            <div>
              <strong>AI explanation failed</strong>
              <span>{error}</span>
            </div>
          </div>
        )}
        <div className="assistant-actions">
          {stage === "streaming" ? (
            <button
              className="secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancel stream
            </button>
          ) : stage === "review" ? (
            <>
              <button className="secondary" onClick={() => decide("rejected")}>
                Reject
              </button>
              <button className="primary" onClick={() => decide("applied")}>
                Apply to local review
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={
                !permission ||
                !request ||
                status !== "available" ||
                stage === "applied" ||
                stage === "rejected"
              }
              onClick={run}
            >
              Request explanation
            </button>
          )}
        </div>
        {stage === "applied" && (
          <p className="assistant-decision">
            Applied only to this local risk review. No transaction was created
            or changed.
          </p>
        )}
        {stage === "rejected" && (
          <p className="assistant-decision">
            Explanation rejected. Quote and transaction state were not changed.
          </p>
        )}
        <p className="audit-status">
          Audit chain:{" "}
          {auditValid === null
            ? "checking"
            : auditValid
              ? "verified"
              : "corrupt — fail closed"}
        </p>
      </div>
    </Modal>
  );
}
function TokenAmount({
  label,
  value,
  onChange,
  token,
  onToken,
  tokens,
  readonly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  token: string;
  onToken: (v: string) => void;
  tokens: Token[];
  readonly?: boolean;
}) {
  return (
    <label className="token-field">
      <span>{label}</span>
      <div>
        <input
          inputMode="decimal"
          placeholder="0"
          value={value}
          readOnly={readonly}
          onChange={(event) => {
            if (/^\d*(\.\d*)?$/.test(event.target.value))
              onChange(event.target.value);
          }}
          aria-label={`${label} amount`}
        />
        <select
          value={token}
          onChange={(event) => onToken(event.target.value)}
          aria-label={`${label} token`}
        >
          <option value="">Token</option>
          {tokens.map((item) => (
            <option value={item.address.toLowerCase()} key={item.address}>
              {item.symbol}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
function PoolsPage({
  pools,
  tokens,
  state,
  retry,
  t,
  walletAccount,
  actionBusy,
  action,
}: {
  pools: Pool[];
  tokens: Token[];
  state: { state: string; message?: string };
  retry: () => void;
  t: typeof catalogs.en;
  walletAccount: string;
  actionBusy: boolean;
  action: (
    name: DexActionName,
    payload: DexActionPayload,
    quote: DexQuote,
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Pool | null>(null);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [formError, setFormError] = useState("");
  const lookup = (address: string) =>
    tokens.find(
      (token) => token.address.toLowerCase() === address.toLowerCase(),
    );
  const token0 = selected && lookup(selected.token0);
  const token1 = selected && lookup(selected.token1);
  const quote = (pool: Pool, expected: bigint): DexQuote => ({
    poolId: pool.address,
    poolBlockHeight: pool.updatedBlock,
    poolUpdatedAt: new Date(pool.updatedAt).toISOString(),
    asset0: canonicalAsset(pool.token0),
    asset1: canonicalAsset(pool.token1),
    reserve0: safeNumber(BigInt(pool.reserve0), "Pool reserve 0"),
    reserve1: safeNumber(BigInt(pool.reserve1), "Pool reserve 1"),
    feeBps: pool.feeBps,
    expectedAmount: safeNumber(expected, "Expected liquidity amount"),
  });
  const submitAdd = async () => {
    try {
      setFormError("");
      if (!selected || !token0 || !token1)
        throw new Error("Committed token metadata is unavailable.");
      const amount0 = parseUnits(amountA, token0.decimals),
        amount1 = parseUnits(amountB, token1.decimals),
        reserve0 = BigInt(selected.reserve0),
        reserve1 = BigInt(selected.reserve1),
        totalShares = BigInt(selected.totalShares);
      if (
        amount0 <= 0n ||
        amount1 <= 0n ||
        reserve0 <= 0n ||
        reserve1 <= 0n ||
        totalShares <= 0n
      )
        throw new Error(
          "Enter positive amounts for an initialized committed pool.",
        );
      const expected =
          (amount0 * totalShares) / reserve0 <
          (amount1 * totalShares) / reserve1
            ? (amount0 * totalShares) / reserve0
            : (amount1 * totalShares) / reserve1,
        minShares = (expected * 9950n) / 10000n;
      await action(
        "dex_liquidity_add",
        {
          poolId: selected.address,
          amount0: safeNumber(amount0, "Token 0 amount"),
          amount1: safeNumber(amount1, "Token 1 amount"),
          minShares: safeNumber(minShares, "Minimum shares"),
          deadlineUnix: Math.floor(Date.now() / 1000) + 240,
        },
        quote(selected, expected),
      );
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : "Liquidity request failed closed.",
      );
    }
  };
  const submitRemove = async () => {
    try {
      setFormError("");
      if (!selected) throw new Error("Committed pool metadata is unavailable.");
      const shares = parseUnits(amountA, 0),
        reserve0 = BigInt(selected.reserve0),
        reserve1 = BigInt(selected.reserve1),
        totalShares = BigInt(selected.totalShares);
      if (shares <= 0n || shares > totalShares)
        throw new Error(
          "Enter a positive share amount no greater than total pool shares.",
        );
      const expected0 = (reserve0 * shares) / totalShares,
        expected1 = (reserve1 * shares) / totalShares,
        min0 = (expected0 * 9950n) / 10000n,
        min1 = (expected1 * 9950n) / 10000n;
      await action(
        "dex_liquidity_remove",
        {
          poolId: selected.address,
          shares: safeNumber(shares, "Share amount"),
          minAmount0: safeNumber(min0, "Minimum token 0"),
          minAmount1: safeNumber(min1, "Minimum token 1"),
          deadlineUnix: Math.floor(Date.now() / 1000) + 240,
        },
        quote(selected, expected0),
      );
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : "Liquidity request failed closed.",
      );
    }
  };
  return (
    <PageFrame title={t.pools} subtitle={t.liveOnly}>
      {state.state === "loading" ? (
        <Skeleton rows={6} />
      ) : state.state === "error" ? (
        <InlineError
          message={state.message || t.unavailable}
          retry={retry}
          label={t.retry}
        />
      ) : pools.length === 0 ? (
        <EmptyPage icon="pools" title={t.emptyPools} detail={t.liveOnly} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.pool}</th>
                <th>{t.poolType}</th>
                <th>{t.reserves}</th>
                <th>{t.updated}</th>
                <th>{t.status}</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={pool.address}>
                  <td>
                    <button
                      className="pool-link"
                      onClick={() => setSelected(pool)}
                    >
                      <strong>
                        {lookup(pool.token0)?.symbol || short(pool.token0)} /{" "}
                        {lookup(pool.token1)?.symbol || short(pool.token1)}
                      </strong>
                      <span>{short(pool.address)}</span>
                    </button>
                  </td>
                  <td>{poolProtocol(pool.contractVersion)}</td>
                  <td>
                    <code>{pool.reserve0}</code>
                    <span>
                      <code>{pool.reserve1}</code>
                    </span>
                  </td>
                  <td>
                    #{pool.updatedBlock}
                    <span>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(pool.updatedAt))}
                    </span>
                  </td>
                  <td>
                    <span className="status-pill">
                      <i />
                      Committed
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <Modal
          title={`${token0?.symbol || short(selected.token0)} / ${token1?.symbol || short(selected.token1)}`}
          close={() => setSelected(null)}
        >
          <div className="pool-detail">
            <dl>
              <div>
                <dt>Consensus pool ID</dt>
                <dd>{selected.address}</dd>
              </div>
              <div>
                <dt>{t.poolType}</dt>
                <dd>
                  {poolProtocol(selected.contractVersion)} ·{" "}
                  {selected.contractVersion}
                </dd>
              </div>
              <div>
                <dt>Fee tier</dt>
                <dd>{(selected.feeBps / 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Total LP shares</dt>
                <dd>{selected.totalShares}</dd>
              </div>
              <div>
                <dt>{t.updated}</dt>
                <dd>#{selected.updatedBlock}</dd>
              </div>
              <div>
                <dt>{token0?.symbol || short(selected.token0)} reserve</dt>
                <dd>
                  {token0
                    ? formatUnits(BigInt(selected.reserve0), token0.decimals)
                    : selected.reserve0}
                </dd>
              </div>
              <div>
                <dt>{token1?.symbol || short(selected.token1)} reserve</dt>
                <dd>
                  {token1
                    ? formatUnits(BigInt(selected.reserve1), token1.decimals)
                    : selected.reserve1}
                </dd>
              </div>
              <div>
                <dt>Committed tx</dt>
                <dd>{selected.txHash}</dd>
              </div>
            </dl>
            <div className="segmented" role="tablist">
              <button
                role="tab"
                aria-selected={mode === "add"}
                onClick={() => {
                  setMode("add");
                  setFormError("");
                }}
              >
                Add liquidity
              </button>
              <button
                role="tab"
                aria-selected={mode === "remove"}
                onClick={() => {
                  setMode("remove");
                  setFormError("");
                }}
              >
                Remove liquidity
              </button>
            </div>
            {mode === "add" ? (
              <div className="liquidity-form">
                <label>
                  {token0?.symbol || "Token 0"}
                  <input
                    inputMode="decimal"
                    value={amountA}
                    onChange={(event) => {
                      if (/^\d*(\.\d*)?$/.test(event.target.value))
                        setAmountA(event.target.value);
                    }}
                    placeholder="0"
                  />
                </label>
                <label>
                  {token1?.symbol || "Token 1"}
                  <input
                    inputMode="decimal"
                    value={amountB}
                    onChange={(event) => {
                      if (/^\d*(\.\d*)?$/.test(event.target.value))
                        setAmountB(event.target.value);
                    }}
                    placeholder="0"
                  />
                </label>
                <p>
                  Wallet reviews the exact token ratio, minimum shares,
                  committed pool snapshot, nonce and deadline before signing.
                </p>
                <button
                  className="primary"
                  disabled={actionBusy}
                  onClick={() => void submitAdd()}
                >
                  {actionBusy
                    ? "Checking Product Session…"
                    : walletAccount
                      ? "Review add liquidity"
                      : "Connect Wallet to add"}
                </button>
              </div>
            ) : (
              <div className="liquidity-form">
                <label>
                  LP share amount
                  <input
                    inputMode="decimal"
                    value={amountA}
                    onChange={(event) => {
                      if (/^\d*$/.test(event.target.value))
                        setAmountA(event.target.value);
                    }}
                    placeholder="0"
                  />
                </label>
                <p>
                  Wallet reviews exact owned shares and minimum token outputs
                  against committed pool state.
                </p>
                <button
                  className="primary"
                  disabled={actionBusy}
                  onClick={() => void submitRemove()}
                >
                  {actionBusy
                    ? "Checking Product Session…"
                    : walletAccount
                      ? "Review remove liquidity"
                      : "Connect Wallet to remove"}
                </button>
              </div>
            )}
            {formError && (
              <p className="review-blocker" role="alert">
                {formError}
              </p>
            )}
            <p className="review-blocker">
              Each signature authorizes one exact chain-native action only; DEX must
              return matching committed pool and event evidence.
            </p>
          </div>
        </Modal>
      )}
    </PageFrame>
  );
}
function ExplorePage({
  events,
  tokens,
  state,
  retry,
  t,
}: {
  events: ChainEvent[];
  tokens: Token[];
  state: { state: string; message?: string };
  retry: () => void;
  t: typeof catalogs.en;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"transactions" | "tokens">("transactions");
  const filtered = events.filter((event) =>
    `${event.txHash} ${event.pool} ${event.type}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleTokens = tokens.filter((token) =>
    `${token.symbol} ${token.name} ${token.address}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <PageFrame
      title={t.explore}
      subtitle={t.liveOnly}
      action={
        <label className="search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
          />
        </label>
      }
    >
      <div className="segmented explore-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "transactions"}
          onClick={() => setTab("transactions")}
        >
          Transactions
        </button>
        <button
          role="tab"
          aria-selected={tab === "tokens"}
          onClick={() => setTab("tokens")}
        >
          Tokens
        </button>
      </div>
      {state.state === "loading" ? (
        <Skeleton rows={6} />
      ) : state.state === "error" ? (
        <InlineError
          message={state.message || t.unavailable}
          retry={retry}
          label={t.retry}
        />
      ) : tab === "tokens" ? (
        visibleTokens.length === 0 ? (
          <EmptyPage
            icon="explore"
            title="No owner-reviewed Testnet tokens"
            detail="Tokens appear only after owner review and strict API validation."
          />
        ) : (
          <div className="token-list">
            {visibleTokens.map((token) => (
              <article key={token.address}>
                <div>
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                </div>
                <code>{token.address}</code>
                <span className="status-pill">
                  <i />
                  Owner reviewed
                </span>
              </article>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyPage icon="explore" title={t.emptyEvents} detail={t.liveOnly} />
      ) : (
        <div className="timeline">
          {filtered.map((event) => (
            <article key={event.id}>
              <span className="timeline-icon">
                <Icon name={event.type === "swap" ? "swap" : "pools"} />
              </span>
              <div>
                <strong>{event.type.replaceAll("-", " ")}</strong>
                <p>
                  {short(event.txHash)} · {short(event.pool)}
                </p>
              </div>
              <div className="timeline-meta">
                <strong>#{event.blockNumber}</strong>
                <span>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.timestamp))}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageFrame>
  );
}
function AnalyticsPage({
  data,
  t,
}: {
  data: ReturnType<typeof useDexData>["data"];
  t: typeof catalogs.en;
}) {
  const [interval, setInterval] = useState(60);
  const [selectedPool, setSelectedPool] = useState("");
  if (data.state === "loading")
    return (
      <PageFrame title={t.analytics}>
        <Skeleton rows={5} />
      </PageFrame>
    );
  if (data.state === "error")
    return (
      <PageFrame title={t.analytics}>
        <EmptyPage
          icon="analytics"
          title={t.unavailable}
          detail={data.message}
        />
      </PageFrame>
    );
  const pool =
    data.data.pools.find((item) => item.address === selectedPool) ||
    data.data.pools[0];
  const candles = pool
    ? aggregateCandles(data.data.events, pool, data.data.tokens, interval)
    : [];
  const metrics = [
    [t.indexed, data.data.analytics.indexedEvents],
    [t.pools, data.data.analytics.pools],
    ["TWAP intervals", data.data.twap.length],
    [t.latestBlock, data.data.analytics.latestBlock || "—"],
  ];
  return (
    <PageFrame title={t.analytics} subtitle={t.liveOnly}>
      <div className="metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{new Intl.NumberFormat().format(value as number)}</strong>
          </div>
        ))}
      </div>
      <div className="chart-toolbar">
        <label>
          Market
          <select
            aria-label="Chart market"
            value={pool?.address || ""}
            onChange={(event) => setSelectedPool(event.target.value)}
          >
            {data.data.pools.map((item) => (
              <option key={item.address} value={item.address}>
                {item.token0}/{item.token1}
              </option>
            ))}
          </select>
        </label>
        <div className="chart-intervals" role="group" aria-label="Candle interval">
          {[
            [60, "1m"],
            [300, "5m"],
            [900, "15m"],
            [3600, "1h"],
          ].map(([seconds, label]) => (
            <button
              key={seconds}
              aria-pressed={interval === seconds}
              onClick={() => setInterval(seconds as number)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {pool && candles.length ? (
        <CandleChart candles={candles} pair={`${pool.token0}/${pool.token1}`} />
      ) : (
        <div className="chart-empty">
          <div className="axis-lines" />
          <Icon name="analytics" />
          <strong>Confirmed swap history unavailable</strong>
          <p>
            Candles appear only after real swaps are committed for this pool.
            No synthetic prices or volume are inserted.
          </p>
        </div>
      )}
      <p className="source-line">
        <Icon name="info" />
        {t.source}: {data.data.provenance.source}; {data.data.provenance.classification}
        · {data.data.provenance.status} · schema {data.data.provenance.version}
        · as of {data.data.provenance.asOf} · coverage {data.data.provenance.coverage}
        · confirmed cumulative-price deltas and raw token amounts only.
      </p>
    </PageFrame>
  );
}
function CandleChart({ candles, pair }: { candles: Candle[]; pair: string }) {
  const width = 960;
  const height = 300;
  const padding = { top: 22, right: 72, bottom: 38, left: 14 };
  const plotHeight = height - padding.top - padding.bottom;
  const values = candles.flatMap((item) => [item.high, item.low]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.max(maximum * 0.02, 1);
  const low = minimum - span * 0.08;
  const high = maximum + span * 0.08;
  const y = (value: number) =>
    padding.top + ((high - value) / (high - low)) * plotHeight;
  const step = (width - padding.left - padding.right) / candles.length;
  const bodyWidth = Math.max(5, Math.min(18, step * 0.55));
  const latest = candles[candles.length - 1];
  return (
    <figure className="candle-chart" aria-label={`${pair} confirmed swap candles`}>
      <figcaption>
        <div>
          <strong>{pair}</strong>
          <span>Token 1 per Token 0 · confirmed chain swaps</span>
        </div>
        <div>
          <strong>{latest.close.toLocaleString(undefined, { maximumFractionDigits: 9 })}</strong>
          <span>{latest.trades} trade{latest.trades === 1 ? "" : "s"} in latest candle</span>
        </div>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>{`${pair} OHLC candlestick chart from confirmed swaps`}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = high - (high - low) * ratio;
          const lineY = padding.top + plotHeight * ratio;
          return (
            <g key={ratio}>
              <line className="chart-grid" x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} />
              <text className="chart-label" x={width - padding.right + 8} y={lineY + 4}>
                {value.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </text>
            </g>
          );
        })}
        {candles.map((item, index) => {
          const x = padding.left + step * index + step / 2;
          const rising = item.close >= item.open;
          const top = y(Math.max(item.open, item.close));
          const bodyHeight = Math.max(2, Math.abs(y(item.open) - y(item.close)));
          return (
            <g key={item.openedAt} className={rising ? "candle-up" : "candle-down"}>
              <title>{`${new Date(item.openedAt).toLocaleString()} O ${item.open} H ${item.high} L ${item.low} C ${item.close} · ${item.trades} trades`}</title>
              <line x1={x} x2={x} y1={y(item.high)} y2={y(item.low)} />
              <rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={bodyHeight} rx="1" />
            </g>
          );
        })}
      </svg>
      <div className="chart-foot">
        <span>{new Date(candles[0].openedAt).toLocaleString()}</span>
        <span>{new Date(latest.openedAt).toLocaleString()}</span>
      </div>
    </figure>
  );
}
function PageFrame({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
function InfoPage({
  title,
  text,
  rows,
}: {
  title: string;
  text: string;
  rows: string[][];
}) {
  return (
    <PageFrame title={title} subtitle={text}>
      <div className="info-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <Icon name="chevron" />
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
function EmptyPage({
  icon,
  title,
  detail,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="state-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action && (
        <button className="secondary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
function InlineError({
  message,
  retry,
  label,
}: {
  message: string;
  retry: () => void;
  label: string;
}) {
  return (
    <div className="inline-error" role="alert">
      <Icon name="warning" />
      <div>
        <strong>Unable to load live data</strong>
        <span>{message}</span>
      </div>
      <button onClick={retry}>{label}</button>
    </div>
  );
}
function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="skeleton" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}
function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Mark() {
  return <img className="mark" src="/ynx-logo.png" alt="YNX" />;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    swap: "M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3",
    pools: "M4 8h16M6 4h12l2 16H4L6 4Zm2 8h8",
    positions: "M6 5h12v14H6zM9 9h6m-6 4h6",
    explore: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3-12-2 4-4 2 2-4 4-2Z",
    analytics: "M4 19V9m5 10V5m5 14v-7m5 7V3",
    governance: "M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 4H3l9-4Z",
    docs: "M6 3h9l3 3v15H6V3Zm9 0v4h4M9 11h6m-6 4h6",
    settings:
      "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm8-3.5 2-1-2-4-2 .5-1.5-1L16 4h-4l-.5 2.5-1.5 1-2-.5-2 4 2 1v2l-2 1 2 4 2-.5 1.5 1L12 22h4l.5-2.5 1.5-1 2 .5 2-4-2-1v-2Z",
    wallet: "M4 6h14v12H4V6Zm14 4h3v4h-3",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "m6 6 12 12M18 6 6 18",
    down: "m8 10 4 4 4-4",
    route: "M6 5h5a3 3 0 0 1 3 3v8m-3-3 3 3 3-3M6 5l3-3M6 5l3 3",
    offline:
      "M3 3l18 18M8 8a7 7 0 0 1 10 1m-13 3a10 10 0 0 1 2-2m3 5a3 3 0 0 1 4 0m-2 4h.01",
    security: "M12 3 5 6v5c0 4.6 3 8 7 10 4-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5",
    warning: "M12 3 2 21h20L12 3Zm0 6v5m0 3h.01",
    search: "m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    chevron: "m9 18 6-6-6-6",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.info} />
    </svg>
  );
}
