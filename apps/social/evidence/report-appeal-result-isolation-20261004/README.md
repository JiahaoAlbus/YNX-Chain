# Report appeal result isolation

Base source: 9c5901c8fd25eca2b54c7ee174284300711e4e0a.

Root's independent review of 5be identified a Go-level result alias: modifying AppealSocialReport's returned EvidenceHashes changed stored report state. The unchanged independent probe SHA256 is 149730118c609a95772ef4e57b06e952c03653cd1e684c480a890c0a309c3052. The retained original red log SHA256 is 3f058f08b7e4d43e47a21b0e6cc26c53ec9beb465a1787cbf0921fbc6e67e082.

The sole production change returns copyReportResult(record) at the existing appeal persistence boundary. Original current actor validation, permissions, correction validation, ownership, saved record, audit and save/rollback behavior remain unchanged. Create/get/replay already use that result-copy contract. The independent probe was copied without formatting or modification.

Actual regression: go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race. Exit 0, 17.005s, including the unchanged independent appeal probe and original Social tests. The overlay is the exact read-only shared productsessionv2 namespace from c5e4178bb548baa05f552e8e1bc0f566ddc6f72d; durable composition inputs remain in ../moment-delete-cold-recovery-20261004/. No shared source was edited or included.

This closes only the reproduced source-level result alias. It is not evidence of an HTTP attack, new permissions, protected backend operation, actual UI/device recovery, public deployment, cryptographic activation or MONSTER acceptance. Complete Social v2 and crypto rebuild goals remain open. No sensitive Wallet operation or deployment occurred. Unrelated untracked paths were preserved and excluded.
