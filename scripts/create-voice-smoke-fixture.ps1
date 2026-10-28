# Windows-only local synthetic speech. No microphone, network or provider credentials.
param([switch]$ApplicationTools)
$ErrorActionPreference = 'Stop'
$klnkFixtureDir = Join-Path (Split-Path $PSScriptRoot -Parent) '.data/production-audit'
New-Item -ItemType Directory -Force -Path $klnkFixtureDir | Out-Null
Add-Type -AssemblyName System.Speech
$klnkSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$klnkAudio = New-Object System.IO.MemoryStream
try {
    $klnkFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $klnkSynth.SetOutputToAudioStream($klnkAudio, $klnkFormat)
    if ($ApplicationTools) {
        $klnkSynth.Speak('Please look up Jordan Lee in my contacts. Tell me if the record is verified. Do not call anyone.')
        $klnkFixturePath = Join-Path $klnkFixtureDir 'application-tools-input.pcm'
    } else {
        $klnkSynth.Speak('This is a test using fictional data. Please check my calendar and call my fictional friend Jordan. Tell me which services you can actually use.')
        $klnkFixturePath = Join-Path $klnkFixtureDir 'input.pcm'
    }
    $klnkBytes = $klnkAudio.ToArray()
    # Chromium starts its file microphone during getUserMedia, before SDP and
    # the provider greeting finish. Preserve the whole fictional tool request.
    if ($ApplicationTools) { $klnkBytes = [byte[]]::new(10 * 48000) + $klnkBytes }
    [System.IO.File]::WriteAllBytes($klnkFixturePath, $klnkBytes)
    Write-Output "Fictional PCM fixture saved: $klnkFixturePath"
} finally {
    $klnkSynth.Dispose()
    $klnkAudio.Dispose()
}
