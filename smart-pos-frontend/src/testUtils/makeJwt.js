// Test helper: an unsigned, structurally valid JWT. The client only ever reads the
// payload (expiry, user id); signatures are the server's job.
export function makeJwt(payload) {
  const toB64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  const enc = (o) => toB64(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}
export const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
