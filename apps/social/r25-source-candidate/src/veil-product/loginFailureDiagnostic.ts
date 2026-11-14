export const loginFailureReasons = ['BUSY', 'CLOSED', 'ASSOCIATION_REQUIRED', 'ORIGINAL_START_UNKNOWN', 'INVALID_RESPONSE', 'HTTP_REFUSED', 'REDIRECT_REFUSED', 'NO_RESPONSE', 'TLS_FAILED', 'TIMEOUT', 'CANCELLED', 'CALLBACK_REFUSED', 'PERSISTENCE_REFUSED'] as const;
const operations = ['START', 'CALLBACK', 'REDEEM', 'ACCOUNT_OBSERVE', 'CANCEL', 'LOGIN_WORKER'] as const;
const exceptions = ['TLS_EXCEPTION', 'TIMEOUT_EXCEPTION', 'IO_EXCEPTION', 'EXECUTOR_REJECTED', 'SECURITY_EXCEPTION', 'ARGUMENT_EXCEPTION', 'STATE_EXCEPTION', 'OTHER_EXCEPTION'] as const;
export type LoginFailureDiagnostic = Readonly<{state: 'NOT_RECORDED' | 'CLIENT_REFUSED' | 'EXCEPTION'; operation: typeof operations[number] | 'NONE'; reason: typeof loginFailureReasons[number] | 'NONE'; httpStatus: number; remoteOutcomeUnknown: boolean; exception: typeof exceptions[number] | 'NONE'}>;
export function decodeLoginFailureDiagnostic(raw: unknown): LoginFailureDiagnostic {
  const fail = () => { throw Error('INVALID_LOGIN_FAILURE_DIAGNOSTIC'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return fail();
  const f = Object.getOwnPropertyDescriptors(raw), keys = ['state','operation','reason','httpStatus','remoteOutcomeUnknown','exception'];
  if (Reflect.ownKeys(f).length !== keys.length || !keys.every(k => f[k]?.enumerable && Object.hasOwn(f[k], 'value'))) return fail();
  const state = f.state?.value, operation = f.operation?.value, reason = f.reason?.value, httpStatus = f.httpStatus?.value, remoteOutcomeUnknown = f.remoteOutcomeUnknown?.value, exception = f.exception?.value;
  if (!Number.isInteger(httpStatus) || (httpStatus !== 0 && (httpStatus < 100 || httpStatus > 599)) || typeof remoteOutcomeUnknown !== 'boolean') return fail();
  if (state === 'NOT_RECORDED') { if (operation !== 'NONE' || reason !== 'NONE' || httpStatus !== 0 || remoteOutcomeUnknown || exception !== 'NONE') return fail(); }
  else if (state === 'CLIENT_REFUSED') { if (!operations.includes(operation) || !loginFailureReasons.includes(reason) || exception !== 'NONE') return fail(); }
  else if (state === 'EXCEPTION') { if (operation !== 'LOGIN_WORKER' || reason !== 'NONE' || httpStatus !== 0 || !remoteOutcomeUnknown || !exceptions.includes(exception)) return fail(); }
  else return fail();
  return Object.freeze({state, operation, reason, httpStatus, remoteOutcomeUnknown, exception});
}
