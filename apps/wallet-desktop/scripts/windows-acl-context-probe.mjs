/** Synthetic Windows-only ACL capability comparison. Emits no path, SID or ACL. */
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const parent = process.argv[2];
if (process.platform !== "win32" || !["bash", "pwsh"].includes(parent)) throw new Error("ACL_CONTEXT_INPUT_INVALID");
const executable = path.win32.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const script = String.raw`
$ErrorActionPreference = 'Stop'
$paths = $env:YNX_WALLET_ACL_CONTEXT_PATHS | ConvertFrom-Json
$commandBefore = Get-Command Get-Acl -ErrorAction SilentlyContinue
$securityModule = Get-Module -ListAvailable Microsoft.PowerShell.Security | Select-Object -First 1
function Classify($record) {
  $name = $record.Exception.GetType().Name
  $kind = if ($name -match 'CommandNotFound') { 'command-missing' } elseif ($name -match 'Unauthorized|Security') { 'denied' } elseif ($name -match 'ItemNotFound|FileNotFound|DirectoryNotFound') { 'not-found' } else { 'other' }
  $bits = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes([int]$record.Exception.HResult), 0)
  return @{ kind=$kind; hresult=$bits.ToString('X8') }
}
function Check([string]$name, [string]$folder, [bool]$commandAvailable) {
  $result = @{ name=$name; directoryExists=[IO.Directory]::Exists($folder); dotnetAclOk=$false; cmdletAclOk=$false; dotnetFailure=$null; cmdletFailure=$null }
  try { $null = [IO.Directory]::GetAccessControl($folder); $result.dotnetAclOk = $true } catch { $result.dotnetFailure = Classify $_ }
  if ($commandAvailable) { try { $null = Get-Acl -LiteralPath $folder; $result.cmdletAclOk = $true } catch { $result.cmdletFailure = Classify $_ } }
  return $result
}
$beforeAscii = Check 'ascii' $paths.ascii ($null -ne $commandBefore)
$beforeUnicode = Check 'unicode' $paths.unicode ($null -ne $commandBefore)
$moduleLoadOk = $false
try { Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $moduleLoadOk = $true } catch { }
$commandAfter = Get-Command Get-Acl -ErrorAction SilentlyContinue
@{ moduleAvailable=($null -ne $securityModule); moduleLoadOk=$moduleLoadOk; getAclBeforeImport=($null -ne $commandBefore); getAclAfterImport=($null -ne $commandAfter); modulePathHasWindowsPowerShell=($env:PSModulePath -match 'WindowsPowerShell'); modulePathHasPowerShell7=($env:PSModulePath -match 'PowerShell\\7'); beforeAscii=$beforeAscii; beforeUnicode=$beforeUnicode; afterAscii=(Check 'ascii' $paths.ascii ($null -ne $commandAfter)); afterUnicode=(Check 'unicode' $paths.unicode ($null -ne $commandAfter)) } | ConvertTo-Json -Compress -Depth 5
`;
const folders = [];
try {
  folders.push(await fs.mkdtemp(path.join(os.tmpdir(), "ynx-acl-ascii-")));
  folders.push(await fs.mkdtemp(path.join(os.tmpdir(), "钱包 ACL-")));
  const { stdout } = await promisify(execFile)(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true, timeout: 30_000, maxBuffer: 16_384,
    env: { ...process.env, YNX_WALLET_ACL_CONTEXT_PATHS: JSON.stringify({ ascii: folders[0], unicode: folders[1] }) },
  });
  const result = JSON.parse(stdout.trim());
  const safe = value => value === true || value === false;
  if (!["moduleAvailable", "moduleLoadOk", "getAclBeforeImport", "getAclAfterImport", "modulePathHasWindowsPowerShell", "modulePathHasPowerShell7"].every(key => safe(result[key])) || ![result.beforeAscii, result.beforeUnicode, result.afterAscii, result.afterUnicode].every(item =>
    safe(item.directoryExists) && safe(item.dotnetAclOk) && safe(item.cmdletAclOk))) throw new Error("ACL_CONTEXT_RESULT_INVALID");
  console.log(JSON.stringify({ parent, ...result }));
} catch {
  console.log(JSON.stringify({ parent, probeFailed: true }));
} finally {
  await Promise.all(folders.map(folder => fs.rm(folder, { recursive: true, force: true }).catch(() => {})));
}
