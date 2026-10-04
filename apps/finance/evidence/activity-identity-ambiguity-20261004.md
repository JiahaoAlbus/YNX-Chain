# Finance activity identity ambiguity

Predecessor: dce7005ccd73c4717c0d0eb1d3d855576adc2bd8. Ordinary consumer changes only; no shared Wallet/Auth/EVM grant, authority service, producer, generated bundle or deployment edits.

New actual Chrome renderer regression initially had a harness strict-locator error (1289.934084 ms); after choosing the two exact checkboxes, original product behavior failed (0 pass/1 fail, 1153.276709 ms): duplicate activity references produced three selectable inputs instead of one unambiguous neighbor. The fixture does not prove production sends such records or that an AI request was authorized/sent.

The existing duplicate-key helper now also serves activity renderers. Recent activity, full ledger table, separate account-session display and AI context checklist mark every duplicate identity unavailable, including a duplicate beyond the five-row summary. Both byte-equivalent and conflicting duplicate observations are rejected as normal rows/selections, without arbitrarily choosing one, deduplicating source data, altering balance observations or claiming empty history. Distinct same-amount records remain distinct; retained unique selection survives ordinary refresh and retired selections are not resurrected.

Validation:

- Initial repaired focused actual Chrome regression: 1 pass, 1549.322834 ms.
- Complete overview/planning/navigation Chrome tests, with separate account display and twelve languages: 15 pass, 0 fail/cancel/skip, 9503.497833 ms. One tab, no HTTP/AI requests; actual product renderers with controlled source inputs, not real approval or private-service evidence.
- Existing owned AI controller: 6 pass, 0 fail/cancel/skip, 54.695333 ms (coalescing, owner fencing, malformed receipt, serialized polling, cancel readback and late delete/decision).
- Syntax and whitespace checks pass.

App SHA256 f2ead2f8098bad28efe546a9c839c4375c7d6ad0100a4e5e8238455f25eda6bc; ordinary app pin updated. Also corrected inherited ordinary styles/locale pins to current bytes: styles 13a3e5f13c8ec7d5ad9cd057f363ebf3754851555c141b06aff30cb7994ca825; finance-locale 9b1f7b66b0dc62657d0816361114f4536f3f14bf97dac70d2df275983837e4d9. These query changes do not constitute formal publication.

Full Finance resource gate remains FAIL, not washed green: combined owned-AI/versioned tests returned 6 pass/3 fail (2387.202167 ms). Two legacy Hosted cache tests expected a mounted #connect-hosted-ynx but observed none. Static gate first failed styles, then locale; after ordinary pin corrections it still fails wallet-auth (208.373542 ms). Fresh read-only inventory also finds evm-read-session pin mismatch and absent ynx-favicon.png. Shared generated bundles/pins are left unchanged for unique release owner A's coherent graph composition. Exact shared mismatches: wallet-auth current 17803bda66618d155d931060c06b32d43e02f49f88f89d83bbe43de2aa53e142 versus HTML 7dbb57de7de4f944e62b78e518583b87a390b990aa853d9f161f2b7ec1a5d01c; evm-read-session current e5473d622a2e0ceb7e478b4f4d43ae53660f58349f6c87e755622abe9d6fbe24 versus HTML d5827e89f3c3ef9b92fe8bfa187b67e2c8f71b26866ca417b9f93cc6ec53e0e3.

Required release action: A compose exact ordinary consumer with authoritative shared graph and required assets, reconcile current chooser/Hosted contract against full actual-page tests, then perform its authorized publication/rollback and source-bound public/installed journey. Source UI repair is not server-side duplicate rejection, formal resource PASS, deployment, account approval, AI output, signing, transaction or user acceptance.
