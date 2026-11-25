/**
 * Phone numbers are stored in E.164 ("+919876543210"). Shared by server and client
 * code, so keep it free of server-only imports.
 */

/** Used when a number is entered without a country code. The org is India-based (IST, INR). */
export const DEFAULT_DIAL_CODE = "91";

export const DIAL_CODES: readonly { code: string; country: string }[] = [
  { code: "91", country: "India" },
  { code: "1", country: "US / Canada" },
  { code: "44", country: "United Kingdom" },
  { code: "971", country: "UAE" },
  { code: "966", country: "Saudi Arabia" },
  { code: "974", country: "Qatar" },
  { code: "965", country: "Kuwait" },
  { code: "968", country: "Oman" },
  { code: "973", country: "Bahrain" },
  { code: "65", country: "Singapore" },
  { code: "61", country: "Australia" },
  { code: "64", country: "New Zealand" },
  { code: "49", country: "Germany" },
  { code: "33", country: "France" },
  { code: "31", country: "Netherlands" },
  { code: "353", country: "Ireland" },
  { code: "81", country: "Japan" },
  { code: "27", country: "South Africa" },
  { code: "977", country: "Nepal" },
  { code: "880", country: "Bangladesh" },
  { code: "94", country: "Sri Lanka" },
];

// Longest first, so "+971…" matches UAE before a shorter code could.
const BY_LENGTH = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalise user input to E.164, or null when it is empty.
 * "+91 98765-43210", "0091 9876543210" and "09876543210" all give "+919876543210";
 * a number without a country code gets `defaultDial`. Throws on anything that can't be a phone number.
 */
export function normalizePhone(raw: string | null | undefined, defaultDial = DEFAULT_DIAL_CODE): string | null {
  const s = (raw ?? "").trim().replace(/[\s\-().]/g, "");
  if (!s) return null;
  let e164: string;
  if (s.startsWith("+")) e164 = s;
  else if (s.startsWith("00")) e164 = `+${s.slice(2)}`;
  else e164 = `+${defaultDial}${s.replace(/^0+/, "")}`; // drop the domestic trunk prefix
  if (!E164.test(e164)) throw new Error("Enter a valid phone number, e.g. +91 98765 43210");
  if (e164.startsWith("+91") && e164.length !== 13) throw new Error("Indian numbers have 10 digits after +91");
  return e164;
}

/** Split a stored number into dial code and national part. Legacy values without "+" use the default code. */
export function splitPhone(value: string | null | undefined): { dial: string; national: string } {
  const v = (value ?? "").trim();
  if (!v.startsWith("+")) return { dial: DEFAULT_DIAL_CODE, national: v };
  const digits = v.slice(1).replace(/\D/g, "");
  const match = BY_LENGTH.find((d) => digits.startsWith(d.code));
  return match ? { dial: match.code, national: digits.slice(match.code.length) } : { dial: "", national: digits };
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const { dial, national } = splitPhone(value);
  if (!value.trim().startsWith("+")) return value;
  const grouped = dial === "91" && national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : national;
  return dial ? `+${dial} ${grouped}` : `+${national}`;
}
