# Shared verifier: launches only an exact packaged executable with an isolated, marked QA profile.
function Invoke-YNXWindowsUIAcceptance([string]$Executable, [string]$OutputRoot, [string]$Label, [string]$ExpectedRuntimeCheckpoint) {
  $token = [Guid]::NewGuid().ToString('N')
  $records = @{}
  foreach ($phase in @('write', 'reopen')) {
    $path = Join-Path $OutputRoot "$Label-ui-$phase.json"
    if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite UI acceptance evidence: $path" }
    $process = Start-Process -FilePath $Executable -ArgumentList @('--ui-acceptance', $token, $phase, "`"$path`"") -PassThru
    try {
      if (!$process.WaitForExit(180000)) { throw "Actual WebView/editor acceptance timed out during $Label/$phase" }
      if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $path)) { throw "Actual application acceptance failed during $Label/$phase (exit $($process.ExitCode))" }
    } finally {
      if (!$process.HasExited) { $process.Kill($true); $process.WaitForExit(10000) | Out-Null }
    }
    $result = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    foreach ($flag in @('success','webViewReady','editorReady','hostedWorkspaceConnected','normalCloseSaveAcknowledged')) { if ($result.$flag -ne $true) { throw "Application did not prove $flag during $Label/$phase" } }
    if ($result.runtimeCheckpoint -ne $ExpectedRuntimeCheckpoint -or $result.token -ne $token) { throw 'Application runtime/profile identity mismatch' }
    if ($phase -eq 'write') {
      foreach ($flag in @('nativeImportModel','nativeSelectAll','nativeUndo','nativeRedo','nativeCopyPasteMultiline','nativeCutPasteMultiline','cancelPreservesDirtyModel','invalidImportPreservesModel','nativeNewFile','nativeLocalSaveAcknowledged','nativeCommandPipeline')) {
        if ($result.$flag -ne $true) { throw "Native application did not prove $flag" }
      }
    } elseif ($result.sameProfileProjectRestored -ne $true) { throw 'Same-profile project restoration was not proved' }
    $records[$phase] = $result
  }
  if ($records.write.profile -ne $records.reopen.profile) { throw 'Reopen used a different profile' }
  return $records
}
