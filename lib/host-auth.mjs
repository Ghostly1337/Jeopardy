// Passwortprüfung für Server-Funktionen: Vergleich über Hashes gleicher Länge,
// Laufzeit unabhängig vom Inhalt; leere/fehlende Eingaben gelten nie als richtig.
async function sha256(text) {
  const data = new TextEncoder().encode('jeopardy-host:' + text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function passwordOk(given, expected) {
  if (typeof given !== 'string' || !given || typeof expected !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stimmt eines der Passwörter? (z. B. Spielleiter- ODER Host-Passwort)
export async function anyPasswordOk(given, ...expected) {
  const results = await Promise.all(expected.map((e) => passwordOk(given, e)));
  return results.some(Boolean);
}
