import tls from 'node:tls';
import { resolvePublic } from './fetcher.js';

/** Opens a TLS handshake to read the certificate, protocol, cipher and ALPN (HTTP/2) support. */
export async function tlsInfo(host, port = 443, timeout = 8000) {
  const { address } = await resolvePublic(host);
  return new Promise((resolve) => {
    const t0 = performance.now();
    const socket = tls.connect({
      host: address,
      port,
      servername: host,
      rejectUnauthorized: false,
      ALPNProtocols: ['h2', 'http/1.1'],
      timeout,
    });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true);
      const handshakeMs = Math.round(performance.now() - t0);
      if (!cert || !cert.subject) return done({ error: 'No certificate presented' });
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const sans = (cert.subjectaltname || '')
        .split(',').map((s) => s.trim()).filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4));
      const chain = [];
      let c = cert;
      const seen = new Set();
      while (c && c.fingerprint256 && !seen.has(c.fingerprint256)) {
        seen.add(c.fingerprint256);
        chain.push(c.subject?.CN || c.subject?.O || 'unknown');
        c = c.issuerCertificate;
      }
      done({
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name || null,
        alpn: socket.alpnProtocol || null,
        http2: socket.alpnProtocol === 'h2',
        subject: cert.subject?.CN || null,
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        issuerCN: cert.issuer?.CN || null,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        daysRemaining: Math.floor((validTo - Date.now()) / 86400000),
        lifetimeDays: Math.round((validTo - validFrom) / 86400000),
        keyType: cert.asn1Curve ? `EC ${cert.asn1Curve}` : cert.bits ? `RSA ${cert.bits}` : null,
        serialNumber: cert.serialNumber,
        fingerprint256: cert.fingerprint256,
        sans: sans.slice(0, 100),
        sanCount: sans.length,
        wildcard: sans.some((s) => s.startsWith('*.')),
        chain,
        handshakeMs,
      });
    });
    socket.once('timeout', () => done({ error: 'TLS handshake timed out' }));
    socket.once('error', (err) => done({ error: `TLS: ${err.code || err.message}` }));
  });
}
