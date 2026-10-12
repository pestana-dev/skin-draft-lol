$ErrorActionPreference = 'Stop'

$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe = Join-Path $project 'dist\SkinDraftARAM.exe'
$batFallback = Join-Path $project 'scripts\sync-aram.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'Skin Draft ARAM.lnk'

if (Test-Path $exe) {
  $target = $exe
  $workDir = Split-Path $exe -Parent
} elseif (Test-Path $batFallback) {
  Write-Host 'AVISO: dist\SkinDraftARAM.exe nao encontrado. Usando .bat (precisa da pasta do projeto).'
  Write-Host 'Gere o exe com: npm run build:aram-exe'
  $target = $batFallback
  $workDir = $project
} else {
  throw "Nem exe nem bat encontrados. Rode: npm run build:aram-exe"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $workDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Skin Draft — sync ARAM (LCU)'
$shortcut.Save()

Write-Host "Atalho criado: $linkPath"
Write-Host "Alvo: $target"
