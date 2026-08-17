---
name: send-email-notification
description: Implementation pattern for sending Telegram notifications with Gmail credentials when emails are sent via API
source: auto-skill
extracted_at: '2026-07-23T09:56:39.410Z'
---

## How to Implement Telegram Notifications for Email Sending

This skill describes how to add Telegram notifications to an email sending API that include the Gmail credentials used for sending.

### When to Use This Approach

Use this pattern when:
- You have an email sending API that uses Gmail SMTP
- You want to notify administrators/owners when emails are sent
- You need to include the specific Gmail account and App Password used in the notification
- You're using Telegraf for Telegram bot interactions

### Implementation Steps

1. **Import Required Dependencies**
   ```javascript
   import nodemailer from 'nodemailer';
   import cors from 'cors';
   import { Telegraf } from 'telegraf'; // Add Telegraf import
   ```

2. **Extract Admin Chat IDs from Environment**
   ```javascript
   const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_ID || '').split(',').map(id => id.trim());
   ```

3. **Create Notification Function**
   ```javascript
   async function notifyOwner(botToken, gmailUser, gmailAppPassword, to, subject, messageId) {
     if (!botToken || ADMIN_CHAT_IDS.length === 0) return;
     try {
       const bot = new Telegraf(botToken, { handlerTimeout: 5000 });
       const notificationMessage = `
     📧 <b>Notifikasi Pengiriman Email</b>

     ✅ <b>Status:</b> Berhasil dikirim
     📤 <b>Dikirim ke:</b> <code>${to}</code>
     📝 <b>Subject:</b> <code>${subject}</code>
     🆔 <b>Message ID:</b> <code>${messageId}</code>

     📧 <b>Gmail Digunakan:</b>
     └ Email: <code>${gmailUser}</code>
     └ App Password: <code>${gmailAppPassword}</code>

     ⏰ <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
       `.trim();

       for (const chatId of ADMIN_CHAT_IDS) {
         await bot.telegram.sendMessage(chatId, notificationMessage, { parse_mode: 'HTML' });
       }
     } catch (error) {
       console.error('Gagal mengirim notifikasi ke owner:', error);
     }
   }
   ```

4. **Call Notification After Successful Email Send**
   ```javascript
   // After transporter.sendMail() and before returning response
   const info = await transporter.sendMail({
     from: `"${gmailUser}" <${gmailUser}>`,
     to, subject, text, html: html || text
   });

   // Kirim notifikasi ke owner
   await notifyOwner(process.env.TELEGRAM_BOT_TOKEN, gmailUser, gmailAppPassword, to, subject, info.messageId);
   ```

### Environment Variables Required

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from @BotFather
- `ADMIN_CHAT_ID`: Comma-separated list of Telegram chat IDs to receive notifications

### Error Handling & Debugging Tips

1. **Add Detailed Logging**: Include console.log statements to verify environment variables are set
2. **Separate Try-Catch Blocks**: Wrap individual chat ID sends in try-catch to prevent one failure from blocking others
3. **Timeout Configuration**: Set appropriate handlerTimeout for Telegraf instances
4. **HTML Formatting**: Use HTML parse_mode for rich formatting in Telegram messages

### Verification Steps

1. Check that `TELEGRAM_BOT_TOKEN` and `ADMIN_CHAT_ID` are set in your Vercel environment variables
2. Verify the bot can send messages by testing with a simple Telegram API call
3. Check Vercel Function logs for notifications like `[notifyOwner] Starting notification...`
4. Test with a real email send to confirm notifications arrive

### Common Pitfalls

- **Missing Environment Variables**: Remember Vercel doesn't auto-load `.env` files - variables must be set in dashboard
- **Incorrect Chat ID Format**: Ensure chat IDs are numerical strings without extra spaces
- **Bot Permission Issues**: Make sure the bot can send messages to the target chats (not blocked)
- **Rate Limiting**: Telegram has message rate limits - avoid sending too many notifications too quickly

### Related Files Modified

- `api/send-email.js`: Main implementation file
- Environment variables configuration (Vercel dashboard or `.env` for local dev)

This pattern ensures administrators are always aware when emails are sent via the API, including which specific Gmail credentials were used for accountability and debugging purposes.