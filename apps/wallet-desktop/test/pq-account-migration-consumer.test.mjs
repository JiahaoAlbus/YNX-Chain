// Normal npm test / original CI entry. Public original fixtures and controlled
// boundary peers only: no key generation, live grant, network send or GUI.
import '../src/features/pq-transaction/migration-consumer.test.mjs';
import '../src/features/pq-transaction/migration-node.test.mjs';
import '../src/features/pq-transaction/migration-submission.test.mjs';
import '../src/features/pq-transaction/migration-finality-consumer.test.mjs';
import '../src/features/pq-transaction/migration-authority-consumer.test.mjs';
import '../src/features/pq-transaction/migration-finality-protocol.test.mjs';
import '../src/features/pq-transaction/migration-auth-factory-consumer.test.mjs';
import '../src/features/pq-transaction/migration-declarations.test.mjs';
