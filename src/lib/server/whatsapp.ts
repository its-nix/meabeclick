/**
 * WhatsApp through CallMeBot — the tutor's notification channel and, for
 * ops alerts, any other recipient channel (ops-alert.ts).
 */
import { TUTOR_PHONE } from '../contact.ts';

/** Where a CallMeBot WhatsApp goes. CallMeBot issues one API key per
 *  recipient phone, so a phone and its key always travel together. */
export interface WhatsAppChannel { phone: string; apiKey: string }

export type WhatsAppResult = { ok: true } | { ok: false; error: string };

/** Sends a WhatsApp via CallMeBot and says whether it went. The tutor's
 *  channel (CALLMEBOT_PHONE / CALLMEBOT_API_KEY) unless `to` names another.
 *  Never throws. */
export async function sendWhatsAppChecked(text: string, to?: WhatsAppChannel | null): Promise<WhatsAppResult> {
  const phone  = to?.phone  ?? (process.env.CALLMEBOT_PHONE || TUTOR_PHONE);
  const apiKey = to?.apiKey ?? process.env.CALLMEBOT_API_KEY;
  if (!apiKey) {
    console.warn('whatsapp: CALLMEBOT_API_KEY not set, cannot WhatsApp:', text.replace(/\n/g, ' | '));
    return { ok: false, error: 'CALLMEBOT_API_KEY not set' };
  }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const body = await r.text();
    if (!r.ok || body.includes('ERROR')) {
      console.error('whatsapp: CallMeBot error:', body);
      return { ok: false, error: `CallMeBot answered ${r.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error('whatsapp: CallMeBot request failed:', err.message);
    return { ok: false, error: `CallMeBot request failed: ${err.message}` };
  }
}

/** Sends a WhatsApp message to the tutor. */
export async function sendWhatsApp(text: string): Promise<void> {
  await sendWhatsAppChecked(text);
}
