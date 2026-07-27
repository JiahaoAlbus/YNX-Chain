$ErrorActionPreference = "Stop"

function Assert-Equal($actual, $expected, [string]$name) {
  if ([string]$actual -ne [string]$expected) {
    throw "$name mismatch: '$actual' != '$expected'"
  }
}

$app = Split-Path -Parent $PSScriptRoot
$repoRoot = (& git -C $app rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "Unable to resolve the repository root for Windows verification"
}

$outRoot = Join-Path $app ".ynx-developer-windows"
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"
$packageEvidence = Join-Path $outRoot "windows-package.json"
$install = Join-Path $env:RUNNER_TEMP "ynx-developer-portable-install"
$nativeEvidence = Join-Path $outRoot "windows-native-self-test.json"
$evidence = Join-Path $outRoot "windows-install-evidence.json"

if (!(Test-Path $zip)) { throw "Windows package is missing: $zip" }
if (!(Test-Path $packageEvidence)) { throw "Windows package evidence is missing: $packageEvidence" }

$expectedSourceCommit = if ($env:YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT) {
  $env:YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT
} else {
  (& git -C $repoRoot rev-parse HEAD).Trim()
}
$expectedSourceTree = if ($env:YNX_DEVELOPER_EXPECTED_SOURCE_TREE) {
  $env:YNX_DEVELOPER_EXPECTED_SOURCE_TREE
} else {
  (& git -C $repoRoot rev-parse "${expectedSourceCommit}^{tree}").Trim()
}
$release = Get-Content (Join-Path $app "product-release.json") -Raw | ConvertFrom-Json
$expectedRuntimeCheckpoint = [string]$release.featureStatus.apiStudio.sourceCommit
if ([string]::IsNullOrWhiteSpace($expectedRuntimeCheckpoint)) {
  throw "product-release.json does not expose featureStatus.apiStudio.sourceCommit"
}

$actualZipHash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$actualZipBytes = (Get-Item $zip).Length
$packageRecord = Get-Content $packageEvidence -Raw | ConvertFrom-Json
Assert-Equal $packageRecord.schemaVersion 1 "package schemaVersion"
Assert-Equal $packageRecord.sha256 $actualZipHash "package sha256"
Assert-Equal $packageRecord.bytes $actualZipBytes "package bytes"
Assert-Equal $packageRecord.signingClass "unsigned-no-authenticode" "package signingClass"
Assert-Equal $packageRecord.authenticodeStatus "NotSigned" "package authenticodeStatus"
Assert-Equal $packageRecord.architecture "win-x64" "package architecture"
Assert-Equal $packageRecord.installClass "portable-extract" "package installClass"
Assert-Equal $packageRecord.sourceCommit $expectedSourceCommit "package sourceCommit"
Assert-Equal $packageRecord.sourceTree $expectedSourceTree "package sourceTree"
Assert-Equal $packageRecord.runtimeCheckpoint $expectedRuntimeCheckpoint "package runtimeCheckpoint"
if ($packageRecord.sourceDirty -ne $false -or $packageRecord.provenanceEmbedded -ne $true -or $packageRecord.hosted -ne $false -or $packageRecord.productionSigned -ne $false) {
  throw "Windows package truth flags are invalid"
}

Remove-Item $install -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $install
$bundle = Join-Path $install "YNX Developer Testnet Preview"
$exe = Join-Path $bundle "YNXDeveloper.TestnetPreview.exe"
$resources = Join-Path $bundle "Resources"
$provenancePath = Join-Path $resources "build-provenance.json"
$sbomPath = Join-Path $resources "sbom.cdx.json"
if (!(Test-Path $exe)) { throw "Packaged executable is missing" }
if (!(Test-Path $provenancePath)) { throw "Embedded build provenance is missing" }
if (!(Test-Path $sbomPath)) { throw "Embedded SBOM is missing" }

$provenance = Get-Content $provenancePath -Raw | ConvertFrom-Json
$null = Get-Content $sbomPath -Raw | ConvertFrom-Json
$actualSbomHash = (Get-FileHash $sbomPath -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Equal $provenance.schemaVersion 1 "provenance schemaVersion"
Assert-Equal $provenance.productId "ynx-developer-v1" "provenance productId"
Assert-Equal $provenance.artifactClass "unsigned-testnet-preview" "provenance artifactClass"
Assert-Equal $provenance.platform "windows-x64" "provenance platform"
Assert-Equal $provenance.signingClass "unsigned-no-authenticode" "provenance signingClass"
Assert-Equal $provenance.sourceCommit $expectedSourceCommit "provenance sourceCommit"
Assert-Equal $provenance.sourceTree $expectedSourceTree "provenance sourceTree"
Assert-Equal $provenance.runtimeCheckpoint $expectedRuntimeCheckpoint "provenance runtimeCheckpoint"
Assert-Equal $provenance.sbomPath "Resources/sbom.cdx.json" "provenance sbomPath"
Assert-Equal $provenance.sbomSha256 $actualSbomHash "provenance sbomSha256"
Assert-Equal $packageRecord.sbomSha256 $actualSbomHash "package sbomSha256"
if ($provenance.sourceDirty -ne $false) { throw "Embedded provenance incorrectly reports a dirty source" }

$signature = Get-AuthenticodeSignature $exe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
  throw "Expected Authenticode NotSigned, got $($signature.Status)"
}

Remove-Item $nativeEvidence -Force -ErrorAction SilentlyContinue
$selfTest = Start-Process $exe -ArgumentList @("--self-test", "`"$resources`"", "`"$nativeEvidence`"") -Wait -PassThru
if ($selfTest.ExitCode -ne 0 -or !(Test-Path $nativeEvidence)) { throw "Packaged self-test failed with exit $($selfTest.ExitCode)" }
$nativeRecord = Get-Content $nativeEvidence -Raw | ConvertFrom-Json
if (!$nativeRecord.resourcesVerified) { throw "Native self-test did not verify resources" }
Assert-Equal $nativeRecord.signingClass "unsigned-no-authenticode" "native self-test signingClass"
Assert-Equal $nativeRecord.sourceCommit $expectedSourceCommit "native self-test sourceCommit"
Assert-Equal $nativeRecord.runtimeCheckpoint $expectedRuntimeCheckpoint "native self-test runtimeCheckpoint"

$desktop = Start-Process $exe -PassThru
$child = $null
try {
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
} finally {
  if (!$desktop.HasExited) { $desktop.Kill($true) }
  if ($child -and (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue)) { Stop-Process -Id $child.ProcessId -Force }
}

$finalEvidence = [ordered]@{
  schemaVersion = 1
  productId = "ynx-developer-v1"
  surface = "windows-x64-testnet-preview"
  sourceCommit = $expectedSourceCommit
  sourceTree = $expectedSourceTree
  runtimeCheckpoint = $expectedRuntimeCheckpoint
  artifactSha256 = $actualZipHash
  artifactBytes = $actualZipBytes
  sbomSha256 = $actualSbomHash
  provenanceEmbedded = $true
  signingClass = "unsigned-no-authenticode"
  authenticodeStatus = "NotSigned"
  portableExtraction = $true
  resourcesVerified = $true
  coldLaunch = $true
  bundledServerObserved = $true
  childCleanup = $true
  hosted = $false
  productionSigned = $false
  nativeRuntime = $nativeRecord.runtime
  generatedAt = [DateTimeOffset]::UtcNow
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($evidence, (($finalEvidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Windows portable extraction, embedded provenance, resource self-test, Authenticode classification, cold launch, bundled server observation and child cleanup passed."
Write-Host "Verified source $expectedSourceCommit, tree $expectedSourceTree, artifact $actualZipHash ($actualZipBytes bytes) and SBOM $actualSbomHash."
