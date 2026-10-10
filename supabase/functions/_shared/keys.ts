// Clés secrètes (device, terrain, club) : générées par le serveur, affichées
// une seule fois ; seule leur empreinte SHA-256 est stockée.
export { sha256Hex } from "../sync/handler.ts";

// 24 octets aléatoires → 48 hex (format device key établi).
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
}
