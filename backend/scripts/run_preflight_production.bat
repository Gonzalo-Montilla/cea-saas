@echo off
cd /d C:\Proyectos\SAAS-CEA\backend
set PYTHONPATH=.
call .venv\Scripts\python.exe -m scripts.preflight_production
