import path from 'node:path';

export function lightCommand(root, stoppedWindow) {
  const env={GOMAXPROCS:'1',GOGC:'50',GOMEMLIMIT:'160MiB'};
  if(stoppedWindow===undefined)return {mode:'focused_go',command:'nice',args:['-n','10','/opt/homebrew/bin/go','test','-p','1','./cmd/ynx-consensus-perf-client','-run','TestTerminalStream|TestReadySender','-count=1','-timeout=45s'],env};
  const window=path.resolve(stoppedWindow);
  const relative=path.relative(path.join(root,'artifacts/chain-network-performance'),window);
  if(!/^window-[A-Za-z0-9]{6}$/.test(relative))throw Error('stopped window must be one original isolated artifact directory');
  const binary=path.join(root,'artifacts/chain-performance-20261017/partial-reconciliation-client.test');
  return {mode:'stopped_replay',command:'nice',args:['-n','10',binary,'-test.run','^(TestStoppedNetworkReplay|TestStoppedReadySenderAccountReadback)$','-test.count=1','-test.v','-test.timeout=45s'],env:{...env,YNX_CHAIN_STOPPED_WINDOW:window},window,binary,binarySHA256:'a77ce29169a4277df163a4cb4b156e32f7a7d3cf2b99bb75d1a6ae66853a19cc'};
}
