# AI Wine Assistant — Next.js Starter (Bid-Cap 3B)

This starter gives you:
- `/config/fees.yaml` and `/config/risk.yaml`
- A typed bid-cap engine in `/lib/bidcap.ts`
- An API endpoint at `/api/compute`
- A minimal React form to test it

## Quick Start

```bash
npm i
npm run dev
# open http://localhost:3000
```

## Edit Rules
- Update premiums/tax in `config/fees.yaml`
- Update risk deductions and drinkability in `config/risk.yaml`
- The formula lives in `lib/bidcap.ts`

## Next Steps
- Hook up Supabase for auth/storage/logging
- Add image upload + V1 Condition (6 yes/no questions) to map to risk
- Later: create a `vision` microservice (FastAPI + YOLOv8) and call it from the UI
