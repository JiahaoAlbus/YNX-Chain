import {sdk39RegressionInputs as inputs,sdk39RegressionRecordRoot} from './sdk39-regression-inputs.mjs';
import {registerNativeWalletTransportRecipeTests} from './native-wallet-transport-recipe-test-contract.mjs';
// Exact historical inputs; never selects these components for the current App.
registerNativeWalletTransportRecipeTests({inputs,root:sdk39RegressionRecordRoot});
