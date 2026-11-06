@echo off
chcp 65001 >nul
title Arrêt de la démonstration DBS-ASSURANCES
cd /d "%~dp0"
echo.
echo  Arrêt de la démonstration DBS-ASSURANCES...
docker compose -f compose.yml down
echo.
echo  C'est arrêté. Les données sont gardées pour la prochaine fois.
echo.
pause
