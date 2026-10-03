# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wallet-visible.spec.mjs >> logout during a mutation never restores private workspace from its late response
- Location: test/browser/wallet-visible.spec.mjs:110:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - navigation "Commerce" [ref=e3]:
    - link "YNX Pay Merchant home" [ref=e4] [cursor=pointer]:
      - /url: /merchant/
      - img "YNX" [ref=e5]
      - generic [ref=e6]: YNX Pay
    - link "Shop" [ref=e7] [cursor=pointer]:
      - /url: https://shop.ynxweb4.com/
    - link "Sell products" [ref=e8] [cursor=pointer]:
      - /url: https://shop.ynxweb4.com/seller/
    - link "Merchant invoices" [ref=e9] [cursor=pointer]:
      - /url: https://pay.ynxweb4.com/merchant/
  - generic [ref=e11]:
    - complementary [ref=e12]:
      - generic [ref=e13]:
        - img "YNX" [ref=e15]
        - generic [ref=e16]:
          - strong [ref=e17]: YNX Pay
          - text: Merchant Console
      - navigation "Merchant Console" [ref=e18]:
        - button "Overview" [ref=e19] [cursor=pointer]
        - button "Transactions" [ref=e20] [cursor=pointer]
        - button "Invoices" [ref=e21] [cursor=pointer]
        - button "Reconciliation" [ref=e22] [cursor=pointer]
        - button "Webhooks" [ref=e23] [cursor=pointer]
        - button "Cases" [ref=e24] [cursor=pointer]
        - button "AI" [ref=e25] [cursor=pointer]
        - button "Settings" [ref=e26] [cursor=pointer]
      - generic [ref=e27]:
        - strong [ref=e28]: Controlled Merchant
        - generic [ref=e29]: owner · ynx1qqqqqq…qqqqqqqq
    - main [ref=e30]:
      - generic [ref=e31]:
        - generic [ref=e32]:
          - heading "Invoices" [level=1] [ref=e33]
          - paragraph [ref=e34]: Real YNX Testnet records · Oct 3, 2026, 2:02 PM
        - generic [ref=e35]:
          - generic [ref=e36]: YNX TESTNET · YNXT
          - button "Refresh" [ref=e37] [cursor=pointer]
          - button "Sign out" [ref=e38] [cursor=pointer]
      - generic [ref=e39]:
        - alert [ref=e40]: The operation could not be completed. Check authorization and network status, then retry.
        - generic [ref=e41]:
          - generic [ref=e42]:
            - heading "Create signed invoice" [level=2] [ref=e43]
            - generic [ref=e44]:
              - generic [ref=e45]:
                - generic [ref=e46]: Description
                - textbox "Description" [ref=e47]: Old account
              - generic [ref=e48]:
                - generic [ref=e49]: Base amount (YNXT)
                - spinbutton "Base amount (YNXT)" [ref=e50]: "8"
              - generic [ref=e51]:
                - generic [ref=e52]: Tip (YNXT)
                - spinbutton "Tip (YNXT)" [ref=e53]: "0"
                - generic [ref=e54]: Optional and capped at the base amount. The signed invoice shows base, tip and total separately.
              - generic [ref=e55]:
                - generic [ref=e56]: Expiry (minutes)
                - spinbutton "Expiry (minutes)" [ref=e57]: "30"
              - button "Create through central Pay API" [ref=e59] [cursor=pointer]
            - generic [ref=e60]: Invoice v3 signature binds merchant identity, base amount, tip, total, YNX network, fee and expiry. It is not a settlement.
          - generic [ref=e61]:
            - heading "Catalog item" [level=2] [ref=e62]
            - generic [ref=e63]:
              - generic [ref=e64]:
                - generic [ref=e65]: Name
                - textbox "Name" [ref=e66]
              - generic [ref=e67]:
                - generic [ref=e68]: Amount (YNXT)
                - spinbutton "Amount (YNXT)" [ref=e69]
              - button "Save item" [ref=e71] [cursor=pointer]
        - generic [ref=e72]:
          - heading "Recurring draft" [level=2] [ref=e73]
          - generic [ref=e74]:
            - generic [ref=e75]:
              - generic [ref=e76]: Payer Wallet account
              - textbox "Payer Wallet account" [ref=e77]
            - generic [ref=e78]:
              - generic [ref=e79]: Description
              - textbox "Description" [ref=e80]
            - generic [ref=e81]:
              - generic [ref=e82]: Amount per occurrence (YNXT)
              - spinbutton "Amount per occurrence (YNXT)" [ref=e83]
            - generic [ref=e84]:
              - generic [ref=e85]: Cadence (days)
              - spinbutton "Cadence (days)" [ref=e86]: "30"
            - generic [ref=e87]:
              - generic [ref=e88]: Maximum occurrences
              - spinbutton "Maximum occurrences" [ref=e89]: "12"
            - generic [ref=e90]:
              - generic [ref=e91]: First occurrence
              - textbox "First occurrence" [ref=e92]: 2026-10-04T14:02
            - button "Save non-executing draft" [ref=e94] [cursor=pointer]
          - generic [ref=e95]: This signed template never charges automatically. Every occurrence requires a separate invoice and explicit Wallet review.
          - generic [ref=e96]: No recurring drafts recorded.
        - generic [ref=e97]:
          - heading "Invoice records" [level=2] [ref=e98]
          - generic [ref=e99]: No signed invoices recorded.
```