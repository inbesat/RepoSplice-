$phases = @()
Get-Content "E:\git project\project-plans\PHASES_DETAILED.md" | Select-String -Pattern "^### P-\d+:" | ForEach-Object { 
    $match = $_.Matches[0].Value
    $num = [int]($match.Split('P-')[1].Split(':')[0])
    $phases += $num
}
$unique = $phases | Sort-Object | Select-Object -Unique
Write-Host "Count: $($unique.Count)"
Write-Host "Phases: $($unique -join ',')"

# Check missing from 0-318
$all = 0..318
$missing = $all | Where-Object { $_ -notin $unique }
Write-Host "Missing: $($missing.Count) - $($missing -join ',')"