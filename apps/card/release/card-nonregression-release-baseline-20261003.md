# Card non-regression release baseline, 2026-10-03

This is a direct public readback and release constraint, not a deployment or business acceptance.

## Source and public boundary

Owner branch: codex/card-test-service-recovery-20261002. Before this evidence: b079b2b55f7250591e009727c9a38cebf8b0e680/tree baddbb1e89e538e851d411ed0ea9ce7ba6a2b875; clean status. Product source: a392d7cc8ccea0f678fb77c5b3c181c2340c807c/tree 7af9cdb03b9c6eb5edaf1e27ab2b4b3f0dca4ce5.

Direct https://card.ynxweb4.com/runtime-identity.json HTTP200 advertises source 7f9ea9af369c61fcb358c9e80500fdd30c66cbbb/tree c3dde69331a8b0e87fd91ee80415ec4b83ecb3bb. That source is an ancestor of product source a392 (git merge-base exit0), not a newer source that this branch would overwrite. Advertised identity is NOT independent proof that the bundle was built from that source; A must bind exact deployment artifact/source. Both baseline and current package/app configs say1.0.0; no arbitrary version bump made. Installed/native formal version, source and capabilities were NOT inspected or inferred from this Web identity.

Root: HTTP200,1717B,SHA256 e47a3539452dbd7991f79ea5eea3256d6f8b0b4ddc7446e88e5d39d022ea6ba5,request hnd1::4qfx4-1791018504756-46d3c8ed7577.
Asset /_expo/static/js/web/index-ad5868816fd7a4dfcab6df15c5f9e90d.js: HTTP200,4267594B,SHA25617276cbae9dd86eefe4b2a1f97edb3f8b0c85c04eed65a4a111f3775a970b05f,request hnd1::ktjdz-1791018527093-c568295a2673.
Runtime identity: HTTP200,349B,SHA2562b72d4a1d0991a9a5790ad5934a1e83ba9a55937d537988e366c7e79ed10f853,request hnd1::djnw5-1791018549187-6ebd91952969.
/version and /version.json return404; the existing authoritative endpoint is /runtime-identity.json. Do not describe the two missing aliases as missing source identity.
Raw readback headers/root/identity saved in apps/card/evidence/20261003-public-nonregression.

## Current-session real public browser observation

Existing IAB tab1 at https://card.ynxweb4.com/?verify=card-inventory-20260831 was opened read-only. AX snapshot showed English, Guest entry, Overview/Virtual Card/Top up/Activity/Controls/Help, Testnet/non-spendable boundaries, no balance, separate Connect YNX Wallet and Use MetaMask, actual download/install links, optional private-service degradation copy and Start application. No account request, approval, signature, transaction or storage mutation was performed. No installed extension acceptance, application acceptance, cold recovery or ACTIVE is established by this snapshot.

Public YNX Wallet choice is labelled with image/container accessible name 'YNX Card logo'; MetaMask has 'MetaMask fox logo'. Record this old-runtime brand-semantic difference for A's final artifact review, rather than claiming both are already final. Public About/version UI was not verified. A default runner cover is not accepted as a release merely because this page says YNX Card.

## Required non-regression integration, not replacement

Retain the formal Guest dashboard/navigation/local controls/activity/demo and wallet separation; preserve original account/key/application data and journal storage namespaces. Retain old unknown requests and original idempotency keys, never automatically resend. Do not replace this formal product with a helper, QA shell or standalone demo, do not change account authority or downgrade grants to stored hints. Current owned source adds typography settings/accessibility, original brand assets, private V1/V2 TEST application review, exact callback/session/account binding, explicit Submit and durable unknown-result recovery; tests and local witnesses are separately frozen in the previous handoff. Those additions have NOT appeared in this formal Web release simply by pushing source.

A is sole formal build/Host executor. Executable intake: build the integrated a392 source with admitted9555 Wallet and matching TEST backend under current authority; inspect current native/installed release metadata before replacing any native artifact; preserve working features/data; bind package/app/About version, source/tree, canonical URL, exact bundle and undistorted YNX logo to the same artifact. QA must visibly say QA and actual source, use isolated test state, and cannot become the canonical product by accident. Validate existing Guest features and application/unknown-retry/private-degradation recovery on the candidate before any alias switch. Keep exact prior formal deployment for rollback. Do not run this branch's rmSync-based build/deployment scripts against protected existing dist-web; A must use clean isolated input. No settings mutation or new Card project is authorized here.

Remaining executable release dependency: A provides the current formal installed artifact source/version/capability manifest and the source-bound integrated Card/Wallet/backend candidate before final release approval. Local source tests442/typechecks and local desktop/mobile witnesses are not public or installed business proof. Real user account/signature/transaction requires immediate confirmation. ACTIVE/top-up/real card/PAN/CVV/fiat/merchant settlement/migration/ComputerControl/full completion remain false. No deployment made in this audit.
