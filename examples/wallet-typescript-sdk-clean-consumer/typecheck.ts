import {proveYNXTestnetRPC, type FetchOptions} from "@ynx-chain/sdk";
import {createProductDeviceIdentity} from "@ynx-chain/wallet-auth";

const options: FetchOptions = {timeoutMs: 15_000};
const identity = createProductDeviceIdentity();
const result = await proveYNXTestnetRPC(undefined, options);
const chainId: "0x1917" = result.chainId;
const secret: string = identity.productDeviceSecret;
void [chainId, secret];
