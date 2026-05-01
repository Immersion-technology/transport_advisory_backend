# Transport Advisory Services — Backend

Vehicle compliance and document management API for Nigerian vehicle owners (privately owned — not government affiliated).

## Tech Stack

- **Node.js + Express + TypeScript**
- **PostgreSQL + Prisma ORM**
- **node-cron** for scheduled reminder jobs
- **Termii API** for SMS
- **Nodemailer** for email
- **Cloudinary** for file storage
- **Paystack** for payments
- **Puppeteer** for NIID portal scraping

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` with your credentials (Database URL, SMTP, Termii, Cloudinary, Paystack, etc.)

### 3. Run database migrations
```bash
npm run db:push
```

### 4. Seed demo data (creates admin + demo user)
```bash
npm run db:seed
```

Default credentials:
- **Admin**: `admin@transportadvisory.ng` / `Admin@2026`
- **Demo User**: `demo@transportadvisory.ng` / `Demo@2026`

### 5. Start development server
```bash
npm run dev
```

Server runs on http://localhost:5000

## API Endpoints

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Sign in
- `GET /api/auth/profile` — Get current user
- `PUT /api/auth/profile` — Update profile
- `PUT /api/auth/change-password` — Change password

### Vehicles
- `GET /api/vehicles` — List user's vehicles
- `POST /api/vehicles` — Add vehicle
- `GET /api/vehicles/:id` — Get vehicle details
- `PUT /api/vehicles/:id` — Update vehicle
- `DELETE /api/vehicles/:id` — Remove vehicle
- `GET /api/vehicles/lookup/:plateNumber` — NIID lookup
- `POST /api/vehicles/documents` — Add/update document

### Applications
- `GET /api/applications` — List applications
- `POST /api/applications` — Create renewal
- `GET /api/applications/:id` — Get application
- `POST /api/applications/:id/documents` — Upload supporting docs
- `POST /api/applications/:id/pay` — Initialize Paystack payment
- `GET /api/applications/verify/:reference` — Verify payment

### Verifications (Pre-purchase)
- `POST /api/verifications` — Start paid verification
- `GET /api/verifications/complete/:reference` — Complete after payment
- `GET /api/verifications` — Previous checks

### Admin (requires ADMIN role)
- `GET /api/admin/stats` — Dashboard statistics
- `GET /api/admin/users` — All users
- `GET /api/admin/applications` — All applications
- `PUT /api/admin/applications/:id/status` — Update status
- `POST /api/admin/applications/:id/document` — Upload completed doc
- `GET /api/admin/reminders/unconfirmed` — Follow-up queue
- `PUT /api/admin/deliveries/:id/status` — Update delivery

### Reminders
- `GET /api/reminders/confirm/:token` — Email confirmation link

## Reminder Job

The cron job runs daily at 08:00 WAT (Africa/Lagos) and dispatches reminders at:
- **30 days** before expiry — informational
- **7 days** before — urgent
- **1 day** before — critical
- **Day of expiry** — emergency

Users who don't confirm 30-day AND 7-day reminders are flagged for admin phone follow-up.

## Data Sources

| Document | Method | Status |
|----------|--------|--------|
| Motor Insurance | NIID Puppeteer scraper | ✅ Live |
| Vehicle License | Manual entry | ✅ Launch |
| Roadworthiness | Manual entry | ✅ Launch |
| Hackney Permit | Manual entry | ✅ Launch |
