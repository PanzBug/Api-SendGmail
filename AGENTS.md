# AGENTS.md: API Email Gateway

This repository contains an Email API Gateway with various integrations.

## Core Architecture & Entry Points

*   **Vercel Serverless Functions:** All API endpoints reside in the `api/` directory. Each `.js` file acts as a separate serverless function (e.g., `api/send-email.js` maps to `/api/send-email`).
*   **Local Development:** Run `npm run dev` to start the local Express server defined in `server.js`.
*   **Telegram Bot:** The primary interaction point for the Telegram bot is the `/api/telegram-webhook` endpoint. This receives updates from Telegram.

## Essential Commands

*   **Install Dependencies:** `npm install`
*   **Run Locally:** `npm run dev` (Ensure `.env` is configured).
*   **Run Tests:** `npm test` (Tests are in `tests/*.test.js`).
*   **Deploy to Vercel:** `vercel --prod`
*   **Set Telegram Webhook (Post-Deployment):** `curl -X POST https://[YOUR_BASE_URL]/api/set-telegram-webhook`

## Configuration & Environment Variables

All critical configuration is managed via environment variables. Refer to `.env.example` for a complete list.

*   **Database:** `DATABASE_URL` is essential for database connectivity (Neon PostgreSQL).
*   **Telegram:** `TELEGRAM_BOT_TOKEN` and `ADMIN_CHAT_ID` are required for bot functionality and notifications.
*   **API Security:** `ADMIN_API_KEY` secures administrative API endpoints. `CRON_SECRET` secures the cleanup endpoint.
*   **Base URL:** `BASE_URL` is used for internal callbacks and webhook setup.

## Key Operational Details

*   **API Key Authentication:** Most API endpoints require an `apiKey` in the request body for user authentication.
*   **Admin Authentication:** Admin endpoints (`/api/admin`) require an `x-admin-key` header matching `ADMIN_API_KEY`.
*   **Gmail Integration:** For sending/checking emails, `gmailUser` and `gmailAppPassword` must be provided. `gmailAppPassword` is a 16-character App Password generated from Google Security, **not** your main Gmail password.
*   **Cleanup Cron Job:** The `/api/cleanup-expired-keys` endpoint should be triggered periodically via an external cron job with the `secret` query parameter or `Authorization` header set to `CRON_SECRET` to deactivate and delete expired API keys.

## Testing
*   Tests are located in `tests/*.test.js`.
*   A configured `DATABASE_URL` and correctly configured environment variables are prerequisites for running tests successfully.

This document summarizes critical information for quick onboarding and preventing common mistakes. Refer to the `README.md` for comprehensive documentation on all features and endpoints.
