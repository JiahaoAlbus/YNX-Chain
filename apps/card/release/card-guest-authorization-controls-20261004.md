# Actual guest authorization control repair

Source b6f052e13119580f2e5eb50d72a698898981e556
Tree a60ce4579a020ed54e85da577c870c0a226be1b0

A direct browser run found that frozen Guest authorization only recorded a prepared workflow. Card now enforces frozen and online-disabled controls at the actual runDemo boundary, stores bounded allowlisted machine decision details, and renders localized safe denial messages for all twelve languages. Existing v1 records remain valid; control changes and prior audit records are retained.

Full frontend 406/406, focused 21/21, frontend/backend typecheck, exact Web build and 21/18 deployment envelope passed. Current local IAB reproduced the frozen rejection, recovered it after reload, reproduced online-disabled rejection, and rendered both in explicit zh before restoring English. Console error read returned no entries. No Wallet account request, signature, transaction, account creation or Card API admission occurred.

Earlier typography validation belongs to source 7cdea49f2 and is preserved separately: keyboard radio state and focus, larger text persistence, guest navigation and distinct Wallet chooser. It is not relabeled as current source or formal runtime.

All full Testnet product gates remain open: protected-runtime current/role/actor integration, formally paired Host deployment, real registration signature and acceptance, actual YNXT transaction/receipt/credit, ledger merchant lifecycle and external Data Fabric reconciliation. Guest capture/refund/reversal remain previews, not completion of these goals. No alias/Host/shared source was changed.
