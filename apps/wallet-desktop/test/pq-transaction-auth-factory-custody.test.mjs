import {registerActualPQAuthFactoryCustodyTests} from '../src/features/pq-transaction/auth-factory-custody.test-runner.mjs';
await registerActualPQAuthFactoryCustodyTests(new URL('../src/original-policy-supplier/transaction-permission.mjs',import.meta.url));
