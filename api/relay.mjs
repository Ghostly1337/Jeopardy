// Vercel Function: message relay between host and players (see lib/relay-core.mjs).
import { neon } from '@neondatabase/serverless';
import { handleRelay } from '../lib/relay-core.mjs';
import { pgStore } from '../lib/relay-stores.mjs';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = url ? neon(url) : null;
const store = sql ? pgStore((text, params) => sql.query(text, params)) : null;

export const config = { maxDuration: 30 };

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (!store) {
      // Without a database the clients fall back to WebRTC (ping fails).
      return Response.json({ error: 'relay not configured' }, { status: 503 });
    }
    const rawBody = request.method === 'POST' ? await request.text() : '';
    const { status, json } = await handleRelay({ method: request.method, query: u.searchParams, rawBody }, store);
    return Response.json(json, { status, headers: { 'cache-control': 'no-store' } });
  },
};
