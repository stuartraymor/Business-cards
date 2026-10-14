# Business Cards installer (per-user, no admin rights needed)
# Gets the official Electron runtime, verifies its SHA-256, then installs the app.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}

$app         = 'Business Cards'
$version     = '1.0.0'
$runtimeUrl  = 'https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-x64.zip'
$runtimeHash = 'C325A6D905C67107E166267813EA2151AE7FD316C0A88DE0081DB0B9851A9946'
$dest      = Join-Path $env:LOCALAPPDATA 'Programs\BusinessCards'
$exe       = Join-Path $dest 'BusinessCards.exe'
$icon      = Join-Path $dest 'icon.ico'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Business Cards.lnk'
$desktop   = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Business Cards.lnk'
$regKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BusinessCards'

Write-Host ''
Write-Host '  Business Cards Setup' -ForegroundColor Cyan
Write-Host ''

# 1. Runtime: use electron.zip next to this script if present, otherwise download it once
$zip = Join-Path $PSScriptRoot 'electron.zip'
if (-not (Test-Path $zip)) {
  $zip = Join-Path $env:TEMP 'businesscards-runtime.zip'
  $ok = (Test-Path $zip) -and ((Get-FileHash $zip -Algorithm SHA256).Hash -eq $runtimeHash)
  if (-not $ok) {
    Write-Host '  Downloading the app runtime (about 110 MB, one time)...'
    try { Invoke-WebRequest -Uri $runtimeUrl -OutFile $zip -UseBasicParsing }
    catch {
      Write-Host ''
      Write-Host '  The download was blocked or failed.' -ForegroundColor Yellow
      Write-Host '  Download this file in your browser:'
      Write-Host "    $runtimeUrl"
      Write-Host '  Rename it to electron.zip, put it in this folder next to Install.cmd, and run Install.cmd again.'
      exit 1
    }
  }
}
Write-Host '  Checking the download...'
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $runtimeHash) {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Write-Host '  The runtime file did not match the expected fingerprint, so setup stopped. Run Install.cmd again.' -ForegroundColor Yellow
  exit 1
}

# 2. Install (only Business Cards files are touched; other apps are left alone)
Write-Host '  Installing...'
Get-Process -Name 'BusinessCards' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item (Join-Path $dest 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
Rename-Item (Join-Path $dest 'electron.exe') 'BusinessCards.exe'
Get-ChildItem (Join-Path $dest 'locales') -Exclude 'en-US.pak' | Remove-Item -Force -ErrorAction SilentlyContinue
$appDir = Join-Path $dest 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'app\*') $appDir -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot 'app\icon.ico') $icon -Force
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $dest -Force

# 3. Shortcuts: Start menu and desktop
$sh = New-Object -ComObject WScript.Shell
foreach ($lnk in @($startMenu, $desktop)) {
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $dest
  $s.IconLocation = "$icon,0"
  $s.Description = 'Capture and organize business cards'
  $s.Save()
}

# 4. Show in Settings > Apps so it can be uninstalled normally
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty $regKey DisplayName $app
Set-ItemProperty $regKey DisplayVersion $version
Set-ItemProperty $regKey Publisher 'Stuart Raymor'
Set-ItemProperty $regKey DisplayIcon $icon
Set-ItemProperty $regKey InstallLocation $dest
Set-ItemProperty $regKey UninstallString "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""
Set-ItemProperty $regKey NoModify 1 -Type DWord
Set-ItemProperty $regKey NoRepair 1 -Type DWord
$size = [int]((Get-ChildItem $dest -Recurse | Measure-Object Length -Sum).Sum / 1KB)
Set-ItemProperty $regKey EstimatedSize $size -Type DWord

Write-Host ''
Write-Host "  Done. Installed to $dest" -ForegroundColor Green
Write-Host '  Shortcuts were added to the Start menu and desktop.'
Start-Process $exe
