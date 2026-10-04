import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
test('Windows lifecycle source assigns our suspended child before resume and closes owned handles',async()=>{
 const source=await read('WindowsJobProcess.cs');
 const start=source.indexOf('if (!CreateProcessW('),assign=source.indexOf('if (!AssignProcessToJobObject('),resume=source.indexOf('if (ResumeThread(');
 assert.ok(start>0&&assign>start&&resume>assign);
 assert.match(source,/CreateSuspended \| CreateNoWindow \| CreateUnicodeEnvironment/);
 assert.match(source,/CreateJobObjectW\(IntPtr.Zero, null\)/);assert.match(source,/KillOnJobClose = 0x00002000/);
 assert.match(source,/FileShare.None/);assert.match(source,/thread\?\.Dispose\(\)/);assert.match(source,/if \(!transferred\)/);
 assert.match(source,/TerminateProcess\(child, 1\)/);assert.match(source,/job\?\.Dispose\(\); child\?\.Dispose\(\); lease\?\.Dispose\(\)/);
 assert.match(source,/job.Dispose\(\).*Kernel kills/);assert.match(source,/await exit.ConfigureAwait\(false\)/);
 assert.match(source,/Marshal.FreeHGlobal\(block\)/);assert.doesNotMatch(source,/OpenProcess|Process.GetProcessById|BREAKAWAY|taskkill/i);
});
test('Windows local payload source refuses missing foreign or hosted inputs instead of faking local activation',async()=>{
 const source=await read('LocalWorkbenchPayload.cs');
 for(const marker of ['localWorkspace','canonicalAdmission','OS-user local project only','workbench.pin.json','archiveSha256','node-runtime.json','requiredNodeVersion','win32-x64','v26.','ReparsePoint','SHA256.HashData'])assert.ok(source.includes(marker),marker);
 assert.match(source,/Only|inputs must belong to this installed application/);assert.match(source,/reader.ReadUInt16\(\) != 0x8664/);
 assert.doesNotMatch(source,/https?:\/\/|HttpClient|WebClient|Download|grantToken/);
 const window=await read('MainWindow.xaml.cs');assert.match(window,/WorkspaceUrl \+ "projects"/);assert.doesNotMatch(window,/WindowsJobProcess\.Start|LocalWorkbenchPayload\.Inspect/);
});
