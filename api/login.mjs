// Vercel Function: Login für die ganze Seite (siehe lib/login-core.mjs).
// Fehlversuche werden pro IP in der Datenbank gezählt (lib/throttle.mjs).
import { neon } from '@neondatabase/serverless';
import { handleLogin } from '../lib/login-core.mjs';
import { pgThrottle, memoryThrottle } from '../lib/throttle.mjs';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = url ? neon(url) : null;
const throttle = sql ? pgThrottle((text, params) => sql.query(text, params)) : memoryThrottle();

export default {
  async fetch(request) {
    const form = request.method === 'POST' ? await request.formData().catch(() => null) : null;
    const res = await handleLogin({ method: request.method, headers: request.headers, form }, { password: process.env.JEOPARDY_PASSWORD, throttle });
    return new Response(res.body ?? null, { status: res.status, headers: res.headers });
  },
};
