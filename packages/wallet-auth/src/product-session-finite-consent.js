import { exactFields, WalletAuthError } from './canonical.js';

export const FINANCE_FINITE_CONSENT_PROFILE = 'finance-private-finite-v1';
export const FINANCE_FINITE_CONSENT_DEFAULT_SECONDS = 7200;
export const FINANCE_FINITE_CONSENT_MAX_SECONDS = 7200;
const FIELDS = ['profile', 'issuedAt', 'expiresAt', 'durationSeconds'];
const SCOPES = new Set(['finance.ai.draft', 'finance.pay.read', 'finance.portfolio.read', 'finance.profile.write']);
const PLATFORMS = new Set(['android', 'ios', 'linux', 'macos', 'web', 'windows']);

// This separate opt-in consent never changes a legacy request's short lifetime.
export function createFinanceFiniteServiceConsent(context, durationSeconds = FINANCE_FINITE_CONSENT_DEFAULT_SECONDS) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 300 || durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS) fail('INVALID_SERVICE_CONSENT_TIME');
  const issued = iso(context.issuedAt);
  return parseFinanceFiniteServiceConsent(context, {
    profile: FINANCE_FINITE_CONSENT_PROFILE, issuedAt: issued,
    expiresAt: new Date(Date.parse(issued) + durationSeconds * 1000).toISOString(), durationSeconds,
  }, { requestIssuedAt: issued });
}

export function parseFinanceFiniteServiceConsent(context, input, { requestIssuedAt } = {}) {
  exactFields(input, FIELDS, 'Finite Product Session service consent');
  if (input.profile !== FINANCE_FINITE_CONSENT_PROFILE) fail('UNKNOWN_SERVICE_CONSENT_PROFILE');
  const web = context.platform === 'web';
  if (context.chainId !== 'ynx_6423-1' || context.productId !== 'finance' || context.clientId !== 'ynx-finance-v1'
    || !PLATFORMS.has(context.platform) || context.applicationId !== (web ? 'com.ynxweb4.finance.web' : 'com.ynxweb4.finance')
    || context.origin !== (web ? 'https://finance.ynxweb4.com' : `app://${context.platform}/com.ynxweb4.finance`)
    || context.callback !== (web ? 'https://finance.ynxweb4.com/wallet-auth/callback' : 'ynxfinance://wallet-auth/callback')
    || !Array.isArray(context.scopes) || !context.scopes.length || context.scopes.some(scope => !SCOPES.has(scope))) fail('SERVICE_CONSENT_BINDING_MISMATCH');
  const issuedAt = iso(input.issuedAt), expiresAt = iso(input.expiresAt);
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 300 || input.durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS
    || Date.parse(expiresAt) - Date.parse(issuedAt) !== input.durationSeconds * 1000
    || (requestIssuedAt !== undefined && issuedAt !== requestIssuedAt)) fail('INVALID_SERVICE_CONSENT_TIME');
  return Object.freeze({ profile: input.profile, issuedAt, expiresAt, durationSeconds: input.durationSeconds });
}

function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_SERVICE_CONSENT_TIME');
  return value;
}
function fail(code) { throw new WalletAuthError(code, 'Finite private service consent is outside the reviewed Finance policy'); }
