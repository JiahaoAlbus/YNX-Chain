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

$expectedSourceCommit = if ($env:YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT) {
  $env:YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT
} else {
  (& git -C $repoRoot rev-parse HEAD).Trim()
}
if ([string]::IsNullOrWhiteSpace($expectedSourceCommit)) { throw "Unable to resolve exact Windows package source commit" }
$candidateRoot = [System.IO.Path]::GetFullPath((Join-Path $app ".ynx-developer-windows-candidates"))
$defaultOutput = Join-Path $candidateRoot $expectedSourceCommit.Substring(0, 12)
$outRoot = [System.IO.Path]::GetFullPath($(if ($env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR) { $env:YNX_DEVELOPER_WINDOWS_OUTPUT_DIR } else { $defaultOutput }))
$candidatePrefix = "$candidateRoot$([System.IO.Path]::DirectorySeparatorChar)"
if (!$outRoot.StartsWith($candidatePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "YNX_DEVELOPER_WINDOWS_OUTPUT_DIR must stay under $candidateRoot"
}
$zip = Join-Path $outRoot "ynx-developer-testnet-preview-windows-x64-unsigned.zip"
$packageEvidence = Join-Path $outRoot "windows-package.json"
$install = Join-Path $env:RUNNER_TEMP "ynx-developer-portable-install"
$nativeEvidence = Join-Path $outRoot "windows-native-self-test.json"
$evidence = Join-Path $outRoot "windows-install-evidence.json"

if (!(Test-Path $zip)) { throw "Windows package is missing: $zip" }
if (!(Test-Path $packageEvidence)) { throw "Windows package evidence is missing: $packageEvidence" }

$expectedSourceTree = if ($env:YNX_DEVELOPER_EXPECTED_SOURCE_TREE) {
  $env:YNX_DEVELOPER_EXPECTED_SOURCE_TREE
} else {
  (& git -C $repoRoot rev-parse "${expectedSourceCommit}^{tree}").Trim()
}
$release = Get-Content (Join-Path $app "product-release.json") -Raw | ConvertFrom-Json
$expectedRuntimeCheckpoint = [string]$release.featureStatus.ynxCodePlatform.webSourceCommit
$publicDeploymentCommit = [string]$release.featureStatus.ynxCodePlatform.publicDeployment.sourceCommit
if ([string]::IsNullOrWhiteSpace($expectedRuntimeCheckpoint) -or [string]::IsNullOrWhiteSpace($publicDeploymentCommit) -or $expectedRuntimeCheckpoint -ne $publicDeploymentCommit) {
  throw "product-release.json does not expose one exact current public YNX Code runtime checkpoint"
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
Assert-Equal $packageRecord.deliveryMode "hosted-workspace-client" "package deliveryMode"
Assert-Equal $packageRecord.workspaceUrl "https://developer.ynxweb4.com/" "package workspaceUrl"
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
$sbomDocument = Get-Content $sbomPath -Raw | ConvertFrom-Json
$actualSbomHash = (Get-FileHash $sbomPath -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Equal $provenance.schemaVersion 1 "provenance schemaVersion"
Assert-Equal $provenance.productId "ynx-developer-v1" "provenance productId"
Assert-Equal $provenance.artifactClass "unsigned-testnet-preview" "provenance artifactClass"
Assert-Equal $provenance.platform "windows-x64" "provenance platform"
Assert-Equal $provenance.signingClass "unsigned-no-authenticode" "provenance signingClass"
Assert-Equal $provenance.deliveryMode "hosted-workspace-client" "provenance deliveryMode"
Assert-Equal $provenance.workspaceUrl "https://developer.ynxweb4.com/" "provenance workspaceUrl"
Assert-Equal $provenance.sourceCommit $expectedSourceCommit "provenance sourceCommit"
Assert-Equal $provenance.sourceTree $expectedSourceTree "provenance sourceTree"
Assert-Equal $provenance.runtimeCheckpoint $expectedRuntimeCheckpoint "provenance runtimeCheckpoint"
Assert-Equal $provenance.sbomPath "Resources/sbom.cdx.json" "provenance sbomPath"
Assert-Equal $provenance.sbomSha256 $actualSbomHash "provenance sbomSha256"
Assert-Equal $packageRecord.sbomSha256 $actualSbomHash "package sbomSha256"
if ($provenance.sourceDirty -ne $false) { throw "Embedded provenance incorrectly reports a dirty source" }
if ($sbomDocument.bomFormat -ne "CycloneDX" -or $sbomDocument.specVersion -ne "1.5" -or $sbomDocument.components.Count -lt 4) {
  throw "Windows hosted-client CycloneDX inventory is incomplete"
}
foreach ($required in @(".NET Runtime win-x64", ".NET Windows Desktop Runtime win-x64", "Microsoft.Web.WebView2", "YNX Code Hosted Workspace")) {
  if (!($sbomDocument.components | Where-Object { $_.name -eq $required })) { throw "SBOM component $required is missing" }
}

$signature = Get-AuthenticodeSignature $exe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
  throw "Expected Authenticode NotSigned, got $($signature.Status)"
}

if (Test-Path -LiteralPath $nativeEvidence) { throw "Refusing to overwrite existing Windows native self-test evidence: $nativeEvidence" }
$selfTest = Start-Process $exe -ArgumentList @("--self-test", "`"$resources`"", "`"$nativeEvidence`"") -Wait -PassThru
if ($selfTest.ExitCode -ne 0 -or !(Test-Path $nativeEvidence)) { throw "Packaged self-test failed with exit $($selfTest.ExitCode)" }
$nativeRecord = Get-Content $nativeEvidence -Raw | ConvertFrom-Json
if (!$nativeRecord.resourcesVerified) { throw "Native self-test did not verify resources" }
Assert-Equal $nativeRecord.signingClass "unsigned-no-authenticode" "native self-test signingClass"
Assert-Equal $nativeRecord.sourceCommit $expectedSourceCommit "native self-test sourceCommit"
Assert-Equal $nativeRecord.runtimeCheckpoint $expectedRuntimeCheckpoint "native self-test runtimeCheckpoint"
Assert-Equal $nativeRecord.workspaceUrl "https://developer.ynxweb4.com/" "native self-test workspaceUrl"

$workspaceUrl = "https://developer.ynxweb4.com/"
$webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$workspaceHealth = Invoke-RestMethod -Uri "${workspaceUrl}runtime/health" -WebSession $webSession -TimeoutSec 15
if (!$workspaceHealth.ok -or !$workspaceHealth.sandboxReady -or !$workspaceHealth.compilers.cpp) { throw "Hosted YNX Code runtime is not ready for the Windows client" }
$compileBody = [ordered]@{
  protocolVersion = "ynx-code/v1"
  task = "build-run-active"
  projectId = "windows-package-cpp-verification"
  activePath = "hello.cpp"
  files = [ordered]@{ "hello.cpp" = "#include <iostream>`nint main(){std::cout << `"YNX-WINDOWS-CPP`"; return 0;}" }
  approval = "execute-once"
} | ConvertTo-Json -Depth 8 -Compress
$compile = Invoke-RestMethod -Uri "${workspaceUrl}runtime/tasks" -Method Post -ContentType "application/json" -Body $compileBody -WebSession $webSession -TimeoutSec 60
if (!$compile.ok -or $compile.language -ne "cpp" -or $compile.output -notmatch "YNX-WINDOWS-CPP" -or $compile.sandbox.network -ne $false) {
  throw "Hosted YNX Code C++ compilation failed: $($compile | ConvertTo-Json -Depth 8 -Compress)"
}

function Test-ColdLaunch([string]$label) {
  $desktop = Start-Process $exe -PassThru
  try {
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
      if ($desktop.HasExited) { throw "Windows App exited during $label" }
      $desktop.Refresh()
      if ($desktop.MainWindowHandle -ne 0) { break }
      Start-Sleep -Milliseconds 250
    }
    if ($desktop.MainWindowHandle -eq 0) { throw "Windows App did not expose a main window during $label" }
    if (!$desktop.CloseMainWindow()) { throw "Windows App did not expose a closable main window during $label" }
    if (!$desktop.WaitForExit(10000)) { $desktop.Kill($true); throw "Windows App did not close cleanly during $label" }
  } finally {
    if (!$desktop.HasExited) { $desktop.Kill($true) }
  }
}
Test-ColdLaunch "cold launch"
Test-ColdLaunch "second launch"

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
  deliveryMode = "hosted-workspace-client"
  workspaceUrl = $workspaceUrl
  hostedWorkspaceConnected = $true
  realCppCompile = $true
  secondLaunch = $true
  hosted = $false
  productionSigned = $false
  nativeRuntime = $nativeRecord.runtime
  generatedAt = [DateTimeOffset]::UtcNow
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($evidence, (($finalEvidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)
Write-Host "Windows hosted-workspace client extraction, embedded provenance, Authenticode classification, real remote C++ compile, cold launch and second launch passed."
Write-Host "Verified source $expectedSourceCommit, tree $expectedSourceTree, artifact $actualZipHash ($actualZipBytes bytes) and SBOM $actualSbomHash."
