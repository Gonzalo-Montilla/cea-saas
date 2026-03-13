# SIAEC SaaS - Safe Start

This repository is the isolated SaaS base for SIAEC.

## Safety Rules

- Do not use production credentials in this repository.
- Do not connect local/staging environments to production database.
- Keep the original project repository separated from this one.
- Use `develop` for active work and keep `main` stable.

## First Setup

1. Copy `backend/.env.saas.example` to `backend/.env`.
2. Copy `frontend/.env.saas.example` to `frontend/.env`.
3. Set local database and keys (never production keys).
4. Run backend and frontend in local mode.

## Initial Goal

Build multi-tenant SaaS in phases without affecting current production:

- tenant isolation
- plans/subscriptions
- onboarding
- global admin panel
