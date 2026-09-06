import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execute = promisify(execFile);
const VERSION = "ynx-private-file-v1";
const unavailable = () => Object.assign(new Error("Private durable Wallet storage is unavailable."), { code: "PRIVATE_FILE_UNAVAILABLE" });

// Paths are JSON data in a private child environment, never interpolated into the
// command. No password, plaintext key, file contents, or signed payload is sent.
// Windows chmod bits are not a DACL. Use the user's SID and inspect every allow ACE.
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw 'Unavailable' }
  $request = $env:YNX_WALLET_PRIVATE_FILE_REQUEST | ConvertFrom-Json
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  function Resolve-LocalPath([string]$value) {
    if ($value -notmatch '^[A-Za-z]:\\' -or $value.Substring(2).Contains(':')) { throw 'Invalid path' }
    $full = [IO.Path]::GetFullPath($value)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full -eq $root -or ([IO.DriveInfo]::new($root)).DriveFormat -ne 'NTFS') { throw 'Unsupported storage' }
    $probe = $full
    while ($probe -and $probe -ne $root) {
      if ([IO.File]::Exists($probe) -or [IO.Directory]::Exists($probe)) {
        if (([IO.File]::GetAttributes($probe) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
      }
      $probe = [IO.Path]::GetDirectoryName($probe)
    }
    return $full
  }
  function Read-PrivateAcl([string]$target) {
    $acl = Get-Acl -LiteralPath $target
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $current.Value -and $owner -ne 'S-1-5-18' -and $owner -ne 'S-1-5-32-544') { throw 'Wrong owner' }
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $currentAllowed = $false
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
        $sid = $rule.IdentityReference.Value
        if ($sid -ne $current.Value -and $sid -ne 'S-1-5-18' -and $sid -ne 'S-1-5-32-544') { throw 'Non-private access' }
        if ($sid -eq $current.Value) { $currentAllowed = $true }
      }
    }
    if (-not $currentAllowed) { throw 'Missing owner access' }
  }
  function Protect-PrivateAcl([string]$target, [bool]$directory) {
    $old = Get-Acl -LiteralPath $target
    $owner = $old.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $current.Value -and $owner -ne 'S-1-5-18' -and $owner -ne 'S-1-5-32-544') { throw 'Wrong owner' }
    if ($directory) {
      $acl = [Security.AccessControl.DirectorySecurity]::new()
      $rule = [Security.AccessControl.FileSystemAccessRule]::new($current, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else {
      $acl = [Security.AccessControl.FileSecurity]::new()
      $rule = [Security.AccessControl.FileSystemAccessRule]::new($current, 'FullControl', 'Allow')
    }
    $acl.SetOwner($current)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $target -AclObject $acl
    Read-PrivateAcl $target
  }
  $target = Resolve-LocalPath $request.path
  if ($request.operation -eq 'probe' -or $request.operation -eq 'replace') {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YnxPrivateFileNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileExW(string existing, string destination, uint flags);
}
'@
  }
  switch ($request.operation) {
    'probe' { }
    'protect-directory' { Protect-PrivateAcl $target $true }
    'protect-file' { Protect-PrivateAcl $target $false; Read-PrivateAcl ([IO.Path]::GetDirectoryName($target)) }
    'inspect' { Read-PrivateAcl $target; Read-PrivateAcl ([IO.Path]::GetDirectoryName($target)) }
    'replace' {
      $destination = Resolve-LocalPath $request.destination
      if ([IO.Path]::GetDirectoryName($target) -ne [IO.Path]::GetDirectoryName($destination)) { throw 'Cross-directory move' }
      Read-PrivateAcl $target
      Read-PrivateAcl ([IO.Path]::GetDirectoryName($target))
      if ([IO.File]::Exists($destination)) { Read-PrivateAcl $destination }
      # No COPY_ALLOWED or DELAY_UNTIL_REBOOT. The source is already file-fsynced.
      # Microsoft documents WRITE_THROUGH as returning only after the move is on disk.
      if (-not [YnxPrivateFileNative]::MoveFileExW(('\\?\' + $target), ('\\?\' + $destination), 9)) { throw 'Move failed' }
      $stream = [IO.File]::Open($destination, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
      try { $stream.Flush($true) } finally { $stream.Dispose() }
      Read-PrivateAcl $destination
    }
    default { throw 'Unknown operation' }
  }
  @{ version='ynx-private-file-v1'; operation=$request.operation; private=$true; durableMove=($request.operation -eq 'replace') } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('Private durable Wallet storage is unavailable.')
  exit 1
}
`;

async function windowsOperation(operation, filePath, destination) {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || !/^[A-Za-z]:\\[^\0]*$/u.test(systemRoot)) throw unavailable();
  const executable = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    const { stdout } = await execute(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 20_000, maxBuffer: 16_384,
      env: { ...process.env, YNX_WALLET_PRIVATE_FILE_REQUEST: JSON.stringify({ operation, path: filePath, ...(destination ? { destination } : {}) }) },
    });
    return JSON.parse(stdout.trim());
  } catch { throw unavailable(); }
}

/** Native OS permission/commit checks; never treats Windows mode 0666 as private. */
export class PrivateFilePolicy {
  #availability;
  constructor({ io = fs, platform = process.platform, windows = windowsOperation } = {}) { this.io = io; this.platform = platform; this.windows = windows; }
  async #windows(operation, filePath, destination) {
    const result = await this.windows(operation, filePath, destination);
    if (!result || result.version !== VERSION || result.operation !== operation || result.private !== true || result.durableMove !== (operation === "replace")) throw unavailable();
    return result;
  }
  async available(filePath) {
    if (this.platform !== "win32") return;
    // Availability is checked during read/prepare, before a new signing lease.
    // Publication still invokes and verifies the real native operation each time.
    this.#availability ??= this.#windows("probe", filePath).catch(error => { this.#availability = null; throw error; });
    await this.#availability;
  }
  async directory(directory) {
    await this.available(directory);
    await this.io.mkdir(directory, { recursive: true, mode: 0o700 });
    if (this.platform === "win32") await this.#windows("protect-directory", directory);
    else { const stat = await this.io.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0) throw unavailable(); }
  }
  async protect(filePath) { if (this.platform === "win32") await this.#windows("protect-file", filePath); }
  async assertPrivate(filePath, stat) {
    await this.available(filePath);
    const entry = await this.io.lstat(filePath);
    stat ??= entry;
    if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || entry.dev !== stat.dev || entry.ino !== stat.ino) throw unavailable();
    if (this.platform === "win32") { await this.#windows("inspect", filePath); return { protection: "windows-dacl", private: true }; }
    if ((stat.mode & 0o077) !== 0) throw unavailable();
    return { protection: "posix-mode", private: true };
  }
  async replace(source, destination) {
    await this.available(destination);
    if (this.platform === "win32") { await this.#windows("replace", source, destination); return; }
    await this.io.rename(source, destination);
    const directory = await this.io.open(path.dirname(destination), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
