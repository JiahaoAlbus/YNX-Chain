export function assertDeepLinkForeground(state:string|null):void{
  if(state!=="active")throw new Error("Wallet authorization links require the active foreground");
}
