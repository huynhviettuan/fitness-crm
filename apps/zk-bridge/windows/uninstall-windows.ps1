#Requires -RunAsAdministrator
<#
  Flow Fitness - go cau noi ZKTeco (docs/33). Removes the bridge's task and firewall rule.
  The settings, the queue and the log stay in this folder; delete the folder to remove them.
    powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'Flow ZK Bridge'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "  Da xoa tac vu '$TaskName' / task removed"
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*main.js*zk-bridge.json*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host '  Da go cau noi. Luot quet con cho (zk-bridge-queue.json) van giu lai va se gui khi cai lai / waiting punches are kept and sent after a reinstall'
