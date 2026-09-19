// Read only the route to the approved origin. Never retain addresses/PAC URLs or change routing.
export async function clientPathSnapshot(exec,platform=process.platform){
  const read=async(command,args)=>{const r=await exec(command,args,{timeout:3000,maxBuffer:131072});return r.exitCode===0?r.stdout:null;};
  const out={schema:"ynx-client-path-projection/v1",platform:["darwin","linux"].includes(platform)?platform:"unsupported",
    checkedAt:new Date().toISOString(),routeReadable:false,interfaceFamily:null,interfaceMTU:null,routeUsesKnownTunnelInterface:null,
    systemProxyReadable:false,systemProxyFlags:null,environmentProxyPresent:["HTTPS_PROXY","https_proxy","ALL_PROXY","all_proxy"].some(k=>!!process.env[k]),
    rawRouteRetained:false,interfaceAddressesRetained:false,proxyServersOrPACURLsRetained:false,independentVantageProven:false,tunnelAbsenceProven:false};
  let iface=null;
  if(platform==="darwin"){
    const route=await read("/sbin/route",["-n","get","43.153.202.237"]);out.routeReadable=route!==null;
    iface=route?.match(/interface:\s*([A-Za-z0-9]+)/)?.[1]??null;
    if(iface&&/^(?:en|utun|bridge|lo|ipsec|ppp)\d+$/.test(iface)){
      const link=await read("/sbin/ifconfig",[iface]);out.interfaceMTU=Number(link?.match(/mtu\s+(\d+)/)?.[1])||null;
    }
    const proxy=await read("/usr/sbin/scutil",["--proxy"]);out.systemProxyReadable=proxy!==null;
    if(proxy!==null)out.systemProxyFlags=Object.fromEntries(["HTTPEnable","HTTPSEnable","SOCKSEnable","ProxyAutoConfigEnable","ProxyAutoDiscoveryEnable"].map(k=>[k,new RegExp("\\b"+k+"\\s*:\\s*1\\b").test(proxy)]));
  }else if(platform==="linux"){
    const route=await read("ip",["-j","route","get","43.153.202.237"]);
    try{iface=JSON.parse(route)?.[0]?.dev??null;out.routeReadable=typeof iface==="string";}catch{/* unknown, not direct */}
    if(typeof iface==="string"&&/^[A-Za-z0-9_.:-]{1,32}$/.test(iface)){
      try{const link=JSON.parse(await read("ip",["-j","link","show","dev",iface]));out.interfaceMTU=Number.isInteger(link?.[0]?.mtu)?link[0].mtu:null;}catch{/* unknown */}
    }
  }
  if(typeof iface==="string"){
    const family=iface.match(/^(utun|tun|tap|wg|ipsec|ppp|bridge|en|eth|lo)/)?.[1];out.interfaceFamily=family??"other";
    out.routeUsesKnownTunnelInterface=["utun","tun","tap","wg","ipsec","ppp"].includes(family);
  }
  return out;
}
