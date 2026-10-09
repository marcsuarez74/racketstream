// Abonnés SSE par canal. Un abonné = une fonction d'envoi ; publish diffuse le
// même message à tous les abonnés du canal. Plafond global de connexions pour
// qu'un afflux de spectateurs ne puisse pas épuiser le processus.
export type Send = (chunk: string) => void;

export class Hub {
  private subs = new Map<string, Set<Send>>();
  private count = 0;

  constructor(readonly max = 200) {}

  get size(): number { return this.count; }

  // Renvoie la fonction de désabonnement, ou null si le plafond est atteint.
  subscribe(channel: string, send: Send): (() => void) | null {
    if (this.count >= this.max) return null;
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, set = new Set());
    set.add(send);
    this.count++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      set!.delete(send);
      this.count--;
      if (set!.size === 0) this.subs.delete(channel);
    };
  }

  publish(channel: string, data: unknown): void {
    const set = this.subs.get(channel);
    if (!set) return;
    const chunk = `data: ${JSON.stringify(data)}\n\n`;
    // Un abonné en erreur (flux fermé) ne doit pas bloquer les autres.
    for (const send of [...set]) { try { send(chunk); } catch { /* nettoyé par son abort */ } }
  }
}
