import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const base=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(path.join(tmpdir(),'ynx-video-native-boundary-'));
const javaHome=process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home';
function run(cmd,args){const result=spawnSync(cmd,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${cmd} failed (${result.status})`);}
try{
  run(path.join(javaHome,'bin/javac'),['-d',temporary,path.join(base,'android/app/src/main/java/com/ynxweb4/video/VideoRequestBoundary.java'),path.join(base,'scripts/native-boundary-check.java')]);
  run(path.join(javaHome,'bin/java'),['-cp',temporary,'com.ynxweb4.video.NativeBoundaryCheck']);
  run('xcrun',['swiftc','-target',`${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,'-module-cache-path',path.join(temporary,'modules'),...['VideoModel.swift','ProductDeviceKey.swift','VideoNativeCore.swift','VideoNativeState.swift','VideoNativeCustody.swift','VideoNativeEngine.swift','VideoNativeTransport.swift','VideoPrivateMedia.swift','VideoViewerState.swift'].map(name=>path.join(base,'ios/YNXVideo',name)),path.join(base,'scripts/native-boundary-check.swift'),'-o',path.join(temporary,'swift-check')]);
  run(path.join(temporary,'swift-check'),[]);
}finally{await rm(temporary,{recursive:true,force:true});}
