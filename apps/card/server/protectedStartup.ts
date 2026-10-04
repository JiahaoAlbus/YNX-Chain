import {CardError, unavailableWallet, type WalletAuthority} from './contracts.ts';

/** Local custody/source fence; not a proof verifier or a grant producer. */
export type CardRuntimeCurrent = () => void;
// No deployed role/custody producer has been observed. Never populate from
// ENV, request headers, standard Wallet or a software fixture.
export const originalCardRuntimeInputs: {current: CardRuntimeCurrent | null} = {current: null};

export function prepareOriginalCardRuntime(privateConfigured:boolean,current:CardRuntimeCurrent|null):{
  assertCurrent:CardRuntimeCurrent;bindWallet(wallet:WalletAuthority):WalletAuthority;
}{
  if(privateConfigured&&typeof current!=='function')throw new CardError('CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE',503);
  const assertCurrent=privateConfigured?current!:()=>{};
  assertCurrent();
  return Object.freeze({assertCurrent,bindWallet(wallet:WalletAuthority):WalletAuthority{
    if(!privateConfigured)return unavailableWallet;
    assertCurrent();
    const authenticateOriginal=wallet.authenticate.bind(wallet),approveOriginal=wallet.approve.bind(wallet);
    return Object.freeze({
      async authenticate(request){assertCurrent();const principal=await authenticateOriginal(request);assertCurrent();return principal},
      async approve(principal,expected,proof,details){assertCurrent();const approval=await approveOriginal(principal,expected,proof,details);assertCurrent();return approval},
    } satisfies WalletAuthority);
  }});
}
