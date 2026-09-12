import { loadNativeSnapshot } from './native-snapshot';
export { nativeLedgerAddress, NativeSnapshotError as PortfolioError } from './native-snapshot';
export type NativeAssetBalance={assetId:string;symbol:string;decimals:number;amountAtomic:string};
export type NativeLiquidityPosition={poolId:string;asset0:string;asset1:string;shares:string;totalShares:string;claim0Atomic:string;claim1Atomic:string;blockHeight:string};
export type NativePortfolio={address:string;balanceAtomic:string;stakedAtomic:string;nonce:string;nextNonce:string|null;assets:NativeAssetBalance[];positions:NativeLiquidityPosition[];readAt:string;source:string;version:string;atomicSnapshot:true;consensusFinality:false;snapshotId:string;blockHeight:string;pendingTransactionCount:number};
/** One current ledger observation, including pending state. Not a consensus-finality proof. */
export async function loadNativePortfolio(account:string,signal?:AbortSignal):Promise<NativePortfolio>{
  const snapshot=await loadNativeSnapshot(account,signal),a=snapshot.account!;
  const positions:NativeLiquidityPosition[]=[];
  for(const p of snapshot.pools){
    const owned=BigInt(p.shares.find(s=>s.account===a.address)?.shares??'0');
    if(owned>0n)positions.push({poolId:p.id,asset0:p.asset0,asset1:p.asset1,shares:String(owned),totalShares:p.totalShares,claim0Atomic:String(owned*BigInt(p.reserve0)/BigInt(p.totalShares)),claim1Atomic:String(owned*BigInt(p.reserve1)/BigInt(p.totalShares)),blockHeight:p.blockHeight});
  }
  return {address:a.address,balanceAtomic:a.balance,stakedAtomic:a.staked,nonce:a.nonce,nextNonce:a.nextNonce,assets:snapshot.assets.map(m=>({assetId:m.id,symbol:m.symbol,decimals:m.decimals,amountAtomic:snapshot.balances.get(m.id)!})),positions,readAt:snapshot.asOf,source:snapshot.source,version:snapshot.schemaVersion,atomicSnapshot:true,consensusFinality:false,snapshotId:snapshot.snapshotId,blockHeight:snapshot.blockHeight,pendingTransactionCount:snapshot.pendingTransactionCount};
}
export function formatAtomic(amount:string,decimals:number):string {
  const padded=amount.padStart(decimals+1,'0');
  if(!decimals)return padded;
  const tail=padded.slice(-decimals).replace(/0+$/,'');
  return padded.slice(0,-decimals)+(tail?`.${tail}`:'');
}
