// Presentation of the existing Main probe only; this cannot select a network,
// change RPC, grant signing, or establish chain/Source authority.
export function desktopNetworkDisplay(status,zh=false){
 const known=status?.available===true&&status.chainId==='0x1917';
 const name=zh?'YNX 测试网':'YNX Testnet';
 return Object.freeze({known,label:known?name:status?.available===true?(zh?'网络未识别':'Unrecognized network'):name+(zh?' · 暂不可用':' · unavailable'),id:known?status.chainId:null,detail:known?`${name} · ${status.chainId}`:zh?'尚未确认当前测试网络':'Current test network is not confirmed'});
}
