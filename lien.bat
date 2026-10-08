@echo off
rem Affiche l'adresse a envoyer aux amis (et rien d'autre).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Test-Path .env) -and (Select-String -Path .env -Pattern '^TUNNEL_TOKEN=.+' -Quiet)) { [Console]::Error.WriteLine('Tunnel nomme : l adresse est celle configuree chez Cloudflare.'); exit 0 }; for ($i = 0; $i -lt 30; $i++) { $m = docker compose logs --no-color tunnel 2>$null | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches; if ($m) { ($m | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1); exit 0 }; Start-Sleep -Seconds 1 }; [Console]::Error.WriteLine('Pas de lien trouve. Le jeu tourne-t-il ? Lance : docker compose up -d --build'); exit 1"
