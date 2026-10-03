// Execute the shipped Android MusicStore against an isolated host file/preferences fixture.
// This verifies persistence boundaries; it does not claim installed Android acceptance.
import {createHash} from 'node:crypto';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const jar=process.argv[2],javaHome=process.argv[3];
if(!jar)throw new Error('Usage: node verify-native-store.mjs /absolute/json-20240303.jar [JAVA_HOME]; test dependency stays outside the product');
if(createHash('sha256').update(await readFile(jar)).digest('hex')!=='3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed')throw new Error('Unexpected host-only JSON test dependency');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),stage=await mkdtemp(join(tmpdir(),'ynx-music-owned-store-host-'));
const binary=name=>javaHome?join(javaHome,'bin',name):name;
const sources=['scripts/native-store-fixture/android/content/Context.java','scripts/native-store-fixture/com/ynxweb4/music/NativeStoreCheck.java','scripts/native-store-fixture/com/ynxweb4/music/NativeApiCheck.java','scripts/native-store-fixture/com/ynxweb4/music/NativeCanonicalApiCheck.java','scripts/native-store-fixture/com/ynxweb4/music/NativeSessionBridge.java','android/app/src/main/java/com/ynxweb4/music/NativeProductState.java','android/app/src/main/java/com/ynxweb4/music/NativeSessionIdentity.java','scripts/native-store-fixture/com/ynxweb4/music/SecureStore.java','scripts/native-store-fixture/com/ynxweb4/music/CentralContracts.java','scripts/native-store-fixture/com/ynxweb4/music/BuildConfig.java','android/app/src/main/java/com/ynxweb4/music/MusicStore.java','android/app/src/main/java/com/ynxweb4/music/MusicApi.java'].map(path=>join(root,path));
execFileSync(binary('javac'),['-classpath',resolve(jar),'-d',stage,...sources],{stdio:'inherit'});
execFileSync(binary('java'),['-classpath',stage+':'+resolve(jar),'com.ynxweb4.music.NativeStoreCheck'],{stdio:'inherit'});

execFileSync(binary('java'),['-classpath',stage+':'+resolve(jar),'com.ynxweb4.music.NativeApiCheck'],{stdio:'inherit'});

execFileSync(binary('java'),['-classpath',stage+':'+resolve(jar),'com.ynxweb4.music.NativeCanonicalApiCheck'],{stdio:'inherit'});
