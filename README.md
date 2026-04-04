# NorthCode Stock Manager

Smart inventory management system for Northern Nigeria boutiques.
Bilingual (English + Hausa) · Nigerian Naira (₦) · Mobile-first PWA.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/northcode-stock)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js 14)              │
│  PWA · Tailwind CSS · shadcn/ui · Framer Motion     │
│  next-intl (EN/Hausa) · Recharts · jsPDF            │
└──────────────────────┬──────────────────────────────┘
                       │ Supabase JS Client
┌──────────────────────▼──────────────────────────────┐
│                   SUPABASE                           │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  PostgreSQL │  │   Auth   │  │    Storage     │  │
│  │  + RLS      │  │  Magic   │  │  receipts/     │  │
│  │  Realtime   │  │  Links   │  │  product-imgs/ │  │
│  └─────────────┘  └──────────┘  └────────────────┘  │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Edge Functions                                  │ │
│  │  · low-stock-alert (cron 8am WAT)                │ │
│  │  · daily-report (cron 9pm WAT)                   │ │
│  │  · paystack-webhook                              │ │
│  │  · generate-receipt                              │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
         │                    │              │
    Paystack             Resend          WhatsApp
   (Payments)           (Email)       (Deep Links)
```

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- Supabase account (free tier)
- Paystack account (test mode)
- Resend account (free tier)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/northcode-stock.git
cd northcode-stock
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
# Fill in your Supabase, Paystack, and Resend keys
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `supabase/migrations/001_schema.sql`
3. Create auth users in **Authentication → Users**:
   - `admin@northcode.ng` (owner)
   - `cashier@northcode.ng` (cashier)
   - `stock@northcode.ng` (stock_manager)
4. Run `supabase/seed.sql` to populate demo data
5. Copy your project URL and keys to `.env.local`

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → redirects to `/en/login`

---

## Supabase Setup Guide

### Database Schema
Run the full SQL schema from `supabase/migrations/001_schema.sql` in the SQL Editor.
This creates:
- All 10 tables with proper constraints
- Row Level Security policies for all 4 roles
- Triggers: auto sale_number, stock deduction, debt tracking
- Storage buckets: `receipts`, `product-images`, `shop-logos`
- Realtime enabled on: `sales`, `products`, `stock_movements`, `payments`

### Edge Functions

Deploy via Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF

supabase functions deploy low-stock-alert
supabase functions deploy daily-report
supabase functions deploy paystack-webhook
supabase functions deploy generate-receipt
```

Set secrets for Edge Functions:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set RESEND_FROM_EMAIL=alerts@northcode-stock.ng
```

### Cron Jobs (pg_cron)
Run in SQL Editor:
```sql
-- Low stock alert at 8am WAT (7am UTC)
select cron.schedule(
  'low-stock-alert',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/low-stock-alert',
    headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
  )
  $$
);

-- Daily report at 9pm WAT (8pm UTC)
select cron.schedule(
  'daily-report',
  '0 20 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-report',
    headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
  )
  $$
);
```

---

## Paystack Setup

### Test Keys
1. Sign up at [paystack.com](https://paystack.com)
2. Go to **Settings → API Keys & Webhooks**
3. Copy test keys to `.env.local`

### Webhook Configuration
1. In Paystack Dashboard → **API Keys & Webhooks**
2. Set webhook URL:
   - **Supabase Edge Function**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook`
   - **Or Vercel**: `https://YOUR_DOMAIN.vercel.app/api/paystack/webhook`
3. Select events: `charge.success`

### Test Cards
```
Card: 4084 0840 8408 4081
Expiry: Any future date
CVV: 408
PIN: 0000
OTP: 123456
```

---

## Role System

| Feature                    | Owner | Cashier | Stock Manager | Viewer |
|----------------------------|-------|---------|---------------|--------|
| Dashboard (live)           | ✅    | ❌      | ❌            | ✅ (limited) |
| Point of Sale              | ✅    | ✅      | ❌            | ❌     |
| View buying prices         | ✅    | ❌      | ❌            | ❌     |
| Sales history (all)        | ✅    | Own only| ❌            | ❌     |
| Manage stock               | ✅    | ❌      | ✅            | ❌     |
| Reports & PDF export       | ✅    | ❌      | ❌            | ❌     |
| Manage team                | ✅    | ❌      | ❌            | ❌     |
| WhatsApp/email alerts      | ✅    | ❌      | ❌            | ❌     |
| Settings                   | ✅    | ❌      | ❌            | ❌     |

**Hausa role names**: Maigida (Owner) · Mai Sayarwa (Cashier) · Mai Kaya (Stock Manager) · Mai Kallo (Viewer)

---

## PWA Installation

### Android (Chrome)
1. Open the app in Chrome
2. Tap the three-dot menu → "Add to Home Screen"
3. Or look for the install banner at the bottom

### iPhone (Safari)
1. Open the app in Safari
2. Tap the Share button (📤)
3. Scroll down → "Add to Home Screen"
4. Tap "Add"

The app name on the homescreen will be **"NC Stock"**

---

## Inviting First Employee

1. Log in as owner
2. Go to **Team** page
3. Click **Invite Employee**
4. Enter their email, full name, and assign a role
5. They receive an email → click link → set password → log in

---

## Deployment (Vercel + Supabase)

### Vercel
1. Push to GitHub
2. Connect at [vercel.com](https://vercel.com/new)
3. Add all environment variables from `.env.example`
4. Deploy

### Environment Variables to add in Vercel:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
PAYSTACK_SECRET_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
NEXT_PUBLIC_WHATSAPP_NUMBER
NEXT_PUBLIC_SITE_URL
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Animations | Framer Motion |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| i18n | next-intl (EN + Hausa) |
| PDF | jsPDF + jspdf-autotable |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| Storage | Supabase Storage |
| Functions | Supabase Edge Functions |
| Payments | Paystack |
| Email | Resend |
| Deployment | Vercel |

---

## File Structure

```
northcode-stock/
├── app/
│   ├── [locale]/
│   │   ├── (auth)/login/        ← Login page
│   │   ├── (app)/
│   │   │   ├── dashboard/       ← Live dashboard
│   │   │   ├── sales/new/       ← Point of Sale
│   │   │   ├── sales/history/   ← Sales history
│   │   │   ├── stock/           ← Stock management
│   │   │   ├── stock/movements/ ← Movement log
│   │   │   ├── payments/        ← Credit payments
│   │   │   ├── customers/       ← Customer list
│   │   │   ├── suppliers/       ← Supplier list
│   │   │   ├── reports/         ← Business reports
│   │   │   ├── team/            ← Team management
│   │   │   └── settings/        ← Shop settings
│   │   └── offline/             ← PWA offline page
│   └── api/
│       ├── team/invite/         ← Invite employee
│       └── paystack/webhook/    ← Payment webhook
├── components/
│   ├── ui/                      ← shadcn/ui components
│   ├── layout/                  ← App layout, nav
│   └── dashboard/               ← Dashboard widgets
├── lib/
│   ├── supabase/                ← Client + server
│   ├── types/                   ← TypeScript types
│   ├── hooks/                   ← Custom hooks
│   ├── utils/                   ← Currency, PDF, WhatsApp
│   └── validations/             ← Zod schemas
├── messages/
│   ├── en.json                  ← English strings
│   └── ha.json                  ← Hausa strings
├── supabase/
│   ├── migrations/001_schema.sql
│   ├── seed.sql
│   └── functions/               ← Edge Functions
└── public/
    ├── manifest.json            ← PWA manifest
    └── icons/                   ← App icons
```

---

## Support

Built with ❤️ for Northern Nigeria boutique owners.

For issues, open a GitHub issue or contact via WhatsApp.
