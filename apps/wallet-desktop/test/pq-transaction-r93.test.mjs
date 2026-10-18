import {TransactionPermissionKernel} from '../src/original-policy-supplier/transaction-permission-kernel.mjs';
import {registerPQAuthPermissionCompatibilityTests} from '../src/features/pq-transaction/auth-permission-compatibility.test-body.mjs';
registerPQAuthPermissionCompatibilityTests(TransactionPermissionKernel);
