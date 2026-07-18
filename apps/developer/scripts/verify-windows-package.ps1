$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$outRoot = Join-Path $app ".ynx-developer-windows"
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"
$install = Join-Path $env:RUNNER_TEMP "ynx-developer-portable-install"
$evidence = Join-Path $outRoot "windows-install-evidence.json"

if (!(Test-Path $zip)) { throw "Windows package is missing: $zip" }
Remove-Item $install -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $install
$bundle = Join-Path $install "YNX Developer Testnet Preview"
$exe = Join-Path $bundle "YNXDeveloper.TestnetPreview.exe"
$resources = Join-Path $bundle "Resources"
if (!(Test-Path $exe)) { throw "Packaged executable is missing" }

$selfTest = Start-Process $exe -ArgumentList @("--self-test", "`"$resources`"", "`"$evidence`"") -Wait -PassThru
if ($selfTest.ExitCode -ne 0 -or !(Test-Path $evidence)) { throw "Packaged self-test failed with exit $($selfTest.ExitCode)" }

$desktop = Start-Process $exe -PassThru
$child = $null
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  if ($desktop.HasExited) { throw "Windows App exited before its bundled server was observed" }
  $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($desktop.Id)" | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "server\.mjs" } | Select-Object -First 1
  if ($child) { break }
  Start-Sleep -Milliseconds 250
}
if (!$child) { throw "Bundled Node server was not observed during Windows cold launch" }

if (!$desktop.CloseMainWindow()) { throw "Windows App did not expose a closable main window" }
if (!$desktop.WaitForExit(10000)) { $desktop.Kill($true); throw "Windows App did not close cleanly" }
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  if (!(Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
if (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue) { throw "Bundled Node child survived App shutdown" }

$record = Get-Content $evidence | ConvertFrom-Json
if (!$record.resourcesVerified -or $record.signingClass -ne "unsigned") { throw "Self-test evidence is invalid" }
Write-Host "Windows portable extraction, resource self-test, cold launch, bundled server observation and child cleanup passed."
