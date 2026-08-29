$content = Get-Content "E:\git project\project-plans\PHASES_DETAILED.md" -Raw
$phases = $content -split '(?=### P-\d+:)' | Where-Object { $_ -match '^### P-\d+:' }

$results = @()

foreach ($phase in $phases) {
    if ($phase -match '^### P-(\d+):\s*(.+?)(?=\n|$)') {
        $num = [int]$matches[1]
        $title = $matches[2].Trim()
        
        $hasContext = $phase -match '\*\*Context:\*\*'
        $hasFiles = $phase -match '\*\*Files to Create'
        $hasImpl = $phase -match '\*\*Implementation Steps'
        $hasMCPs = $phase -match '\*\*Required MCPs'
        $hasSkills = $phase -match '\*\*Skills to Invoke'
        $hasAcceptance = $phase -match '\*\*Acceptance Criteria'
        $hasTests = $phase -match '\*\*Tests Required'
        $hasDeps = $phase -match '\*\*Dependencies:'
        $hasHandoff = $phase -match '\*\*Handoff Notes'
        
        $score = 0
        if ($hasContext) { $score++ }
        if ($hasFiles) { $score++ }
        if ($hasImpl) { $score++ }
        if ($hasMCPs) { $score++ }
        if ($hasSkills) { $score++ }
        if ($hasAcceptance) { $score++ }
        if ($hasTests) { $score++ }
        if ($hasDeps) { $score++ }
        if ($hasHandoff) { $score++ }
        
        $results += [pscustomobject]@{
            Phase = $num
            Title = $title
            Score = $score
            HasContext = $hasContext
            HasFiles = $hasFiles
            HasImpl = $hasImpl
            HasMCPs = $hasMCPs
            HasSkills = $hasSkills
            HasAcceptance = $hasAcceptance
            HasTests = $hasTests
            HasDeps = $hasDeps
            HasHandoff = $hasHandoff
        }
    }
}

$results | Sort-Object Phase | ForEach-Object {
    $status = if ($_.Score -eq 9) { "✅ FULL" } elseif ($_.Score -ge 7) { "⚠️ PARTIAL" } else { "❌ MINIMAL" }
    Write-Host "P-$($_.Phase.ToString('000')): Score $($_.Score)/9 - $status - $($_.Title)"
}

$full = ($results | Where-Object { $_.Score -eq 9 }).Count
$partial = ($results | Where-Object { $_.Score -ge 7 -and $_.Score -lt 9 }).Count
$minimal = ($results | Where-Object { $_.Score -lt 7 }).Count

Write-Host ""
Write-Host "Summary: Full=$full, Partial=$partial, Minimal=$minimal, Total=$($results.Count)"