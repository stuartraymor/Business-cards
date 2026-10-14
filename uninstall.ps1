# Business Cards uninstaller
$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\BusinessCards'
$dataDir = Join-Path $env:APPDATA 'BusinessCards'
Get-Process -Name 'BusinessCards' | Stop-Process -Force
Start-Sleep -Milliseconds 700
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Business Cards.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Business Cards.lnk') -Force
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BusinessCards' -Recurse -Force

# Your cards live apart from the program. Ask before deleting them.
if (Test-Path $dataDir) {
  Write-Host ''
  Write-Host "Your saved business cards are in: $dataDir"
  $answer = Read-Host 'Also delete your saved cards and images? Type Y to delete, or press Enter to keep them'
  if ($answer -match '^[Yy]') { Remove-Item $dataDir -Recurse -Force; Write-Host 'Saved cards deleted.' }
  else { Write-Host 'Saved cards were kept.' }
}

# The running script lives inside the folder, so remove the folder after this window closes
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$dest`"" -WindowStyle Hidden
Write-Host 'Business Cards was removed.'
