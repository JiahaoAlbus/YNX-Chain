const FULL_COMMIT=/^[0-9a-f]{40}$/u;

export class PublicDeploymentError extends Error{
  constructor(code,message){super(message);this.name="PublicDeploymentError";this.code=code;}
}

export function validateWalletPublicRegistry(registry,expectedCommit){
  if(!FULL_COMMIT.test(expectedCommit))throw new PublicDeploymentError("INVALID_EXPECTED_COMMIT","Expected source commit must be a full lowercase Git SHA.");
  if(!registry||registry.schemaVersion!==1||!Array.isArray(registry.products))throw new PublicDeploymentError("INVALID_PUBLIC_REGISTRY","Public release registry is malformed.");
  const walletRecords=registry.products.filter(item=>item?.key==="wallet");
  if(walletRecords.length!==1)throw new PublicDeploymentError("INVALID_PUBLIC_REGISTRY","Public release registry must contain exactly one Wallet record.");
  const wallet=walletRecords[0];
  if(wallet.publicWeb!=="https://www.ynxweb4.com/dapp/wallet")throw new PublicDeploymentError("INVALID_PUBLIC_ROUTE","Wallet public route is not the frozen official route.");
  if(wallet.commit!==expectedCommit)throw new PublicDeploymentError("PUBLIC_SOURCE_DRIFT",`Published Wallet source ${wallet.commit||"missing"} does not equal expected ${expectedCommit}.`);
  return Object.freeze({expectedCommit,publishedCommit:wallet.commit,publicWeb:wallet.publicWeb,state:wallet.state||null,deployedPublic:true});
}
