# MRS Stationery POS

Initial React + TypeScript + Vite point-of-sale application for MRS Stationery.

## Modules in this starter
- Dashboard overview
- POS billing interface with a demo cart
- Product catalogue and stock overview
- Sales, staff and settings placeholders
- Supabase client configuration
- Netlify deployment configuration

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your Supabase project URL and anon key to `.env.local` when ready. The current UI uses sample data and demo checkout; it does not yet persist transactions or process payments.

## Deploy to Netlify
- Build command: `npm run build`
- Publish directory: `dist`
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables when Supabase is configured.

This is the initial foundation. Before live store use, complete database integration, authentication, stock deduction, receipt printing, tax/invoice handling, and test the checkout workflow.
