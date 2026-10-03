import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = mkdtempSync(path.join(tmpdir(), 'ynx-music-apple-check-'));
function run(command, args) {
  const result=spawnSync(command,args,{stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
try {
  const swift = ['MusicAccountState.swift','MusicAPI.swift','MusicCredentials.swift','MusicNativeEngine.swift','MusicNativeState.swift','MusicNativeCustody.swift','MusicNativeTransport.swift','MusicDeviceSigner.swift'].map(name=>path.join(product,'ios/YNXMusic',name));
  run('xcrun',['swiftc','-swift-version','5',...swift,path.join(product,'scripts/apple-account-check.swift'),'-o',path.join(stage,'check')]);
  run(path.join(stage,'check'),[]);
  run('xcrun',['swiftc','-frontend','-parse',...swift,path.join(product,'ios/YNXMusic/YNXMusicApp.swift')]);
  const appSource=readFileSync(path.join(product,'ios/YNXMusic/YNXMusicApp.swift'),'utf8');
  const modelFile=path.join(stage,'MusicModel.swift');
  writeFileSync(modelFile,appSource.slice(0,appSource.indexOf('struct TrackDetail:')));
  run('xcrun',['swiftc','-swift-version','5','-typecheck',...swift,modelFile]);
  console.log('PASS host SDK typecheck of shipped model, player, session and persistence code; SwiftUI screens are parse-only on this host');
  run('plutil',['-lint',path.join(product,'ios/YNXMusic.xcodeproj/project.pbxproj')]);
  console.log('PASS Swift iOS source parse and Xcode project syntax (not an iOS SDK build or installed acceptance)');
} finally { rmSync(stage,{recursive:true,force:true}); }
