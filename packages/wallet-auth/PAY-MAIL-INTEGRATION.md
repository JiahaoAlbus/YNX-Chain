# Pay payment result and Mail registration

This source change does not activate production services or expand existing grants.

## Wallet-owned Pay signing

The exported parsePayPaymentIntent, createSignedPayPaymentResult and verifyPayPaymentResult use the existing Pay V1 domains. The controller must first verify an authoritative invoice with an independently pinned operator public key, bind the exact invoice/merchant/payee/amount/fee/quote/session, show explicit payment review, and acquire the existing WalletRepository product-session key-access lease. Do not persist or copy accountSecret into Pay storage. Keep account/approval generation checks before and after async work.

createSignedPayPaymentResult accepts an already signed original native-transfer payload and verifies payer/public key/destination/amount/fee. Its transaction hash is nativeTransferHash of that exact payload. A cryptographic result is not broadcast success, settlement, or a new product session. Keep unknown broadcast/settlement outcome durable and retry the original transaction/idempotency intent; do not silently sign a replacement. The unchanged callback is ynxpay://payment-result.

The original 53eb Pay TypeScript verifier was bundled unchanged against this SDK and accepted the result and identical Chinese merchant intent digest; invoice and transaction substitutions were rejected. This does not validate the original invoice trust chain. The original Pay verifyInvoiceSignature only checks a key supplied in the invoice; the mandatory independently protected signer pin and its production provenance are still required before enabling payment.

Pay V1 requests five scopes; the current Product Session V2 registry authorizes only account:read, pay:case:create and pay:settlement:submit. Never treat the V1 request or payment signature as a V2 grant of route or sponsorship scope. Original /app/pay-product/v1 business/session routes and /app/pay/invoices projections remain separate.

## Mail exact namespace

New registration: mail / ynx-mail-v1 / com.ynxweb4.mail; Web application ID com.ynxweb4.mail.web; origin https://mail.ynxweb4.com; Web callback https://mail.ynxweb4.com/wallet-auth/callback; native callback ynxmail://wallet-auth/callback; native origin app://PLATFORM/com.ynxweb4.mail. Scopes are exactly mail:account and mail:recover; ordinary service limit 240s; native-only identity (evmCompatible false). Legacy com.ynx.mail source identifier is not a V2 application ID.

This registry is not Central browser identity consent, Hosted/WalletConnect transport allowlisting, protected backend key registration, or production service mounting. The shared backend adapter must bind this exact tuple and live session/device generation, and business write proof must bind the exact method/path/canonical body/nonce/time. Introspection proof must never authorize arbitrary mail bodies. Resend provider/webhook credentials are server-only and are unrelated to Wallet user permission. Mail owner controls original handlers and existing message/draft/recovery state; no third-party message is sent by these tests.

## Independently pinned invoice signer policy

createPayInvoiceSignerPolicy(config) snapshots an exact ynx-pay-invoice-signers/v1 configuration with keyId, Ed25519 publicKey and a bounded explicit merchantIds list. The returned resolve checks the invoice signatureKeyId/signingPublicKey/signatureAlgorithm/merchantId against that independent snapshot and returns only its pinned public key. Unknown merchants/keys, substituted algorithm/public key and wildcards fail closed. Later mutation of the source configuration cannot widen it.

This policy must originate in a protected operator configuration or provenance-verified build input, never QR content, an invoice or a merchant response. It does not itself verify the invoice signature. After resolve succeeds the controller must call the original exact invoice signature verifier over all signed fields using the returned pinned key, verify invoice lifetime and fee/amount/invoice binding, and review the payment explicitly. An absent real production signer reference is an unconfigured payment service, not permission to trust an invoice's self-supplied key. This source does not create or register a production signer.
