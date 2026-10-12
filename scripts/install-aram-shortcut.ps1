$ErrorActionPreference = 'Stop'

$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target = Join-Path $project 'scripts\sync-aram.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'Skin Draft ARAM.lnk'

if (-not (Test-Path $target)) {
  throw "Arquivo nao encontrado: $target"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $project
$shortcut.WindowStyle = 1
$shortcut.Description = 'Sincroniza o pool ARAM do Skin Draft via LCU'
$shortcut.Save()

Write-Host "Atalho criado: $linkPath"
Write-Host 'Ao abrir, informe o codigo da sala (ele sera lembrado na proxima vez).'
