$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis/*-setup.exe' | Select-Object -First 1
if (-not $installer) { throw 'NSIS installer was not generated' }
$installDir = Join-Path $env:RUNNER_TEMP 'mythpen-installed'
$profileDir = Join-Path $env:RUNNER_TEMP 'mythpen-installed-profile'
$install = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -PassThru
if (-not $install.WaitForExit(120000)) { throw 'Installer timed out' }
if ($install.ExitCode -ne 0) { throw "Installer failed ($($install.ExitCode))" }
$sidecar = Join-Path $installDir 'mythpen-server.exe'
$keyring = Join-Path $installDir 'sync-keyring/index.js'
$desktop = Join-Path $installDir 'mythpen.exe'
foreach ($file in @($sidecar, $keyring, $desktop)) { if (-not (Test-Path $file)) { throw "Missing installed resource: $file" } }
& node scripts/smoke-sidecar.mjs $sidecar $keyring
if ($LASTEXITCODE -ne 0) { throw 'Installed service verification failed' }
# Cold-start the installed desktop host. This checks process/resource startup;
# it does not pretend to verify visible WebView interaction or Google login.
$env:MYTHPEN_DATA_DIR = $profileDir
$app = Start-Process -FilePath $desktop -WorkingDirectory $env:RUNNER_TEMP -PassThru
try {
    $healthy = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($app.HasExited) { throw "Desktop process exited ($($app.ExitCode))" }
        try {
            $status = Invoke-RestMethod 'http://127.0.0.1:3101/api/health' -TimeoutSec 2
            if ($status.db -eq 'connected') { $healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $healthy) { throw 'Installed desktop did not start its service' }
    $google = Invoke-RestMethod 'http://127.0.0.1:3101/api/sync/status' -TimeoutSec 5
    if ($google.configured) { throw 'Installer unexpectedly contains account configuration' }
    Write-Output 'Installed Windows desktop cold start, resource loading and isolated profile passed'
} finally {
    if (-not $app.HasExited) { $app.Kill($true); $app.WaitForExit() }
    Remove-Item Env:MYTHPEN_DATA_DIR -ErrorAction SilentlyContinue
}
