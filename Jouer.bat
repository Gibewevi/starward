@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js est necessaire pour lancer STARWARD.
  echo Installez Node.js, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Preparation du prototype...
  call npm install
  if errorlevel 1 exit /b 1
  call npm run build
  if errorlevel 1 exit /b 1
)
rem Le serveur ouvre le navigateur lui-meme, une fois pret.
node scripts\serve.mjs --open
pause
