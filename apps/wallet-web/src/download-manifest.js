import {WALLET_DOWNLOAD_MATRIX, YNX_CHAIN, isPinnedAndroidRelease} from "./provider.js";

const SHA256=/^[0-9a-f]{64}$/u;
const SOURCE_COMMIT=/^[0-9a-f]{40}$/u;

export function createWalletDownloadManifest({sourceCommit}) {
  if(!SOURCE_COMMIT.test(sourceCommit||""))throw new Error("Wallet download manifest requires an exact source commit");
  const packages=Object.entries(WALLET_DOWNLOAD_MATRIX).map(([id,item])=>{
    if(item.hosted!==true||!item.url||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!SHA256.test(item.sha256||"")){
      throw new Error(`Wallet download entry is not publishable: ${id}`);
    }
    const url=new URL(item.url);
    if(url.protocol!=="https:"||(!url.pathname.includes(`/sha256-${item.sha256}/`)&&!(id==="android"&&isPinnedAndroidRelease(item)))){
      throw new Error(`Wallet download entry is not content addressed: ${id}`);
    }
    const fallbackUrl=item.fallbackUrl?new URL(item.fallbackUrl):null;
    if(fallbackUrl&&(fallbackUrl.protocol!=="https:"||fallbackUrl.hostname!=="github.com"||fallbackUrl.pathname.split("/").pop()!==url.pathname.split("/").pop())){
      throw new Error(`Wallet fallback download is not release-bound: ${id}`);
    }
    return Object.freeze({
      id,
      label:item.label,
      url:item.url,
      bytes:item.bytes,
      sha256:item.sha256,
      contentType:item.contentType,
      signingClass:item.signingClass,
      productionSigned:item.productionSigned===true,
      ...(id==="android"?{
        filename:item.filename,assetPath:item.assetPath,releaseTag:item.releaseTag,
        releaseImmutable:item.releaseImmutable,publisherCanReplaceAssets:item.publisherCanReplaceAssets,
        downloadTimeSha256Verified:item.downloadTimeSha256Verified,releaseMetadataObservedAt:item.releaseMetadataObservedAt,
        downloadNotice:item.downloadNotice,
      }:{}),
      ...(fallbackUrl?{fallbackUrl:item.fallbackUrl}:{}),
    });
  });
  return Object.freeze({
    schema:"ynx.wallet.downloads.v1",
    product:"YNX Wallet",
    channel:"testnet-preview",
    sourceCommit,
    chain:Object.freeze({name:YNX_CHAIN.chainName,evmChainId:6423,evmChainHex:YNX_CHAIN.chainId,nativeSymbol:YNX_CHAIN.nativeCurrency.symbol}),
    packages:Object.freeze(packages),
    productionSigned:packages.every(item=>item.productionSigned),
    storeReleased:false,
  });
}
