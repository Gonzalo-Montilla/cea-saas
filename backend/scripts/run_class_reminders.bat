@echo off
cd /d C:\Proyectos\SAAS-CEA\backend
set PYTHONPATH=.
call .venv\Scripts\python.exe -m scripts.send_class_reminders
