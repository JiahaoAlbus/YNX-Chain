# Mounted filter in the actual Matrix UI caller

Product source: f18375615869582aee88707d81f9515770543c2f. Comparison: frozen original 9c04bed6866130665754bf3e5da821db29887fd5 session-ui.mjs.

The new five tests execute actual session-ui source with the existing bounded Matrix/permission fixture, augmenting its document capability so the actual production mountLocalContentFilter is invoked. The filter is not stubbed and no classifier is supplied. Appearance is separately stubbed and Matrix/identity/DOM remain controlled fixtures, NOT actual SDK, server, browser or device authority. Fixture extraction is checked at exact original boundaries; old assertions are not removed or weakened.

The same tests against original session-ui exit 1 because the original does not mount this feature. This demonstrates the missing hook, not an earlier real-model/private-server exploit. Current source: 5 PASS, 0 FAIL. Covered: normal off/on/off with fresh permission check; enabling during delayed message decryption; enabling during attachment decryption prevents object URL; preference disabled after private permission expiry cannot unlock old content; actual room summaries are masked.

This closes the prior test-harness branch gap only for the five controlled message caller transitions. The existing broader test suite is not repeatedly rerun here. No whole-tree copy, large build, SDK installation, real permission, model activation, public/private business UAT or dot MONSTER acceptance is claimed. Restricted feed actual caller and a real reviewed local engine remain separate work.
