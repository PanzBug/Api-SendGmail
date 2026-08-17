import crypto from 'crypto';

export const generateApiKey = () => crypto.randomBytes(32).toString('hex');