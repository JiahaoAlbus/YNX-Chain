import {canonicalInputs} from './package-identity-admission-source.mjs';
import {registerNativeWalletTransportRecipeTests} from './native-wallet-transport-recipe-test-contract.mjs';
const inputs=await canonicalInputs();
registerNativeWalletTransportRecipeTests({inputs,root:process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT});
