param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][int]$PortablePid,
  [Parameter(Mandatory=$true)][string]$DataPath,
  [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$taskNext = $null
$taskBackup = $null
try {
  $taskSource = [IO.Path]::GetFullPath($Source)
  $taskTarget = [IO.Path]::GetFullPath($Target)
  $taskData = [IO.Path]::GetFullPath($DataPath)
  $taskRoot = [IO.Path]::Combine($taskData, 'updates') + [IO.Path]::DirectorySeparatorChar
  if (!$taskSource.StartsWith($taskRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($taskTarget) -ne '.exe') { throw 'Invalid update paths.' }
  # NSIS must leave ExecWait and unload the old portable executable first.
  $taskDeadline = (Get-Date).AddSeconds(30)
  while (Get-Process -Id $PortablePid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $taskDeadline) { throw 'Old portable app has not exited; no changes made.' }
    Start-Sleep -Milliseconds 200
  }
  $taskNext = $taskTarget + '.new-' + [guid]::NewGuid().ToString()
  $taskBackup = $taskTarget + '.backup-' + [guid]::NewGuid().ToString()
  Copy-Item -LiteralPath $taskSource -Destination $taskNext
  Move-Item -LiteralPath $taskTarget -Destination $taskBackup
  try { Move-Item -LiteralPath $taskNext -Destination $taskTarget }
  catch { Move-Item -LiteralPath $taskBackup -Destination $taskTarget; throw }
  try { if (!$NoOpen) { Start-Process -FilePath $taskTarget | Out-Null } }
  catch { Remove-Item -LiteralPath $taskTarget; Move-Item -LiteralPath $taskBackup -Destination $taskTarget; throw }
  Remove-Item -LiteralPath $taskBackup
  Remove-Item -LiteralPath ([IO.Path]::Combine($taskData, 'update-install.json')) -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ([IO.Path]::Combine($taskData, 'update-error.txt')) -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ([IO.Path]::GetDirectoryName($taskSource)) -Recurse -Force
} catch {
  if ($taskNext -and (Test-Path -LiteralPath $taskNext)) { Remove-Item -LiteralPath $taskNext -Force }
  'Không cài được cập nhật. App cũ và thư mục dữ liệu được giữ. ' + $_.Exception.Message | Set-Content -LiteralPath ([IO.Path]::Combine($DataPath, 'update-error.txt')) -Encoding UTF8
  exit 1
}
