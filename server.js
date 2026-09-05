import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { createLogger } from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;
const log = createLogger('server');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// request logger with duration
app.use((req, res, next) => {
  const start = Date.now();
  log.info(`→ ${req.method} ${req.url} ip=${req.ip || req.headers['x-forwarded-for'] || '-'} ct=${req.headers['content-type'] || '-'}`);
  const origEnd = res.end;
  res.end = function (...args) {
    const dur = Date.now() - start;
    log.info(`← ${req.method} ${req.url} status=${res.statusCode} dur=${dur}ms`);
    return origEnd.apply(this, args);
  };
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Global variable to track route status
const routeStatus = {
  loaded: [],
  failed: [],
  skipped: []
};

// Helper function to load Vercel handlers as Express routes
async function loadRoutes() {
  const apiDir = join(__dirname, 'api');
  if (!fs.existsSync(apiDir)) {
    console.error(`❌ API directory not found at: ${apiDir}`);
    return;
  }

  const files = fs.readdirSync(apiDir);
  log.info(`Found ${files.length} files in api directory`);

  for (const file of files) {
    if (file.endsWith('.js')) {
      const routeName = `/api/${file.replace('.js', '')}`;
      const absolutePath = join(apiDir, file);
      const modulePath = `file://${absolutePath}`;
      
      try {
        const { default: handler } = await import(modulePath);
        
        if (typeof handler === 'function') {
          app.all(routeName, async (req, res) => {
            try {
              if (!res.json) {
                res.json = (data) => {
                  res.setHeader('Content-Type', 'application/json');
                  return res.send(JSON.stringify(data, null, 2));
                };
              }
              await handler(req, res);
            } catch (err) {
              log.error(`Unhandled error in route ${routeName}: ${err.message}`, { stack: err.stack?.slice(0,1200) });
              if (!res.headersSent) res.status(500).send({ error: 'Internal Server Error', detail: err.message });
            }
          });
          log.info(`Route loaded: ${routeName}`);
          routeStatus.loaded.push(routeName);
        } else {
          log.warn(`Route ${routeName} skipped: No default function export found`);
          routeStatus.skipped.push({ route: routeName, reason: 'No default function export' });
        }
      } catch (err) {
        log.error(`Failed to load route ${routeName} from ${file}: ${err.message}`);
        routeStatus.failed.push({ route: routeName, file, error: err.message });
      }
    }
  }
}

// Start Server
async function start() {
  log.info('Starting server and loading routes...');
  await loadRoutes();
  
  // Basic Health Check
  app.get('/', (req, res) => {
    res.json({
      status: 'online',
      message: 'Email API Dual Gateway Server is running.',
      author: 'Ipanzxdev',
      debug: '/debug-routes'
    });
  });

  // Diagnostic endpoint
  app.get('/debug-routes', (req, res) => {
    res.json(routeStatus);
  });

  // Catch-all 404 handler for debugging
  app.use((req, res) => {
    log.warn(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
      error: 'Not Found',
      path: req.url,
      method: req.method,
      suggestion: 'Check if the route is loaded in the console logs (/debug-routes).'
    });
  });

  app.listen(PORT, () => {
    log.info(`Server is running on Pterodactyl/Local! URL=http://localhost:${PORT} env=${process.env.NODE_ENV || 'development'}`);
  });
}

start();
