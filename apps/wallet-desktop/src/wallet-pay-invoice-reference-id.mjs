// Browser-safe original Native reference syntax only. No fetch or navigation.
export class WalletPayError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "WalletPayError";
    }
}
export function walletPayInvoiceID(value) {
    const s = referenceText(value);
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(s))
        return s;
    const deep = /^ynxpay:\/\/invoice\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})$/.exec(s);
    if (deep)
        return deep[1];
    const web = /^(?:https:\/\/pay\.ynxweb4\.com)?\/(?:invoices|pay\/checkout)\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})$/.exec(s);
    if (web)
        return web[1];
    return fail("PAY_INVALID_REFERENCE");
}

function referenceText(value){if(typeof value!=="string"||!value||value.trim()!==value||value.length>512||/[\x00-\x1f\x7f]/.test(value))fail("PAY_INVALID_RESPONSE");return value}
function fail(code){throw new WalletPayError(code)}
