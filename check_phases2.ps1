$phases = @()
Get-Content "E:\git project\project-plans\PHASES_DETAILED.md" | ForEach-Object {
    if ($_ -match '^### P-(\d+):') {
        $phases += [int]$matches[1]
    }
}
$unique = $phases | Sort-Object | Select-Object -Unique
Write-Host "Count: $($unique.Count)"
Write-Host "Phases: $($unique -join ',')"

# Check missing from 0-318
$all = 0..318
$missing = $all | Where-Object { $_ -notin $unique }
Write-Host "Missing: $($missing.Count) - $($missing -join ',')"