// Vercel Function: Fragensets speichern und laden (siehe lib/sets-core.mjs).
// Braucht DATABASE_URL/POSTGRES_URL (Neon) und JEOPARDY_HOST_PASSWORD.
import { neon } from '@neondatabase/serverless';
import { handleSets, pgSetStore } from '../lib/sets-core.mjs';
import { pgThrottle } from '../lib/throttle.mjs';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = url ? neon(url) : null;
const store = sql ? pgSetStore((text, params) => sql.query(text, params)) : null;
const throttle = sql ? pgThrottle((text, params) => sql.query(text, params)) : null;

export default {
  async fetch(request) {
    const u = new URL(request.url);
    const rawBody = request.method === 'POST' ? await request.text() : '';
    const { status, json, headers } = await handleSets(
      { method: request.method, query: u.searchParams, headers: request.headers, rawBody },
      store,
      process.env.JEOPARDY_HOST_PASSWORD,
      throttle,
    );
    return Response.json(json, { status, headers: { 'cache-control': 'no-store', ...headers } });
  },
};
