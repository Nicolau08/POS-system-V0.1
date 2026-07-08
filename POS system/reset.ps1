Write-Host "Parando processos Node..."
taskkill /F /IM node.exe 2>$null

Start-Sleep -Seconds 2

Write-Host "Limpando build e cache..."
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

Write-Host "Limpando cache do npm..."
npm cache clean --force

Write-Host "Reinstalando dependências..."
npm install

Write-Host "Iniciando o projeto..."
npm run dev