/** First two letters of the organization name, uppercased ("Acme Corp" -> "AC"). Falls back to "OR". */
export function orgPrefix(name: string): string {
  const letters = name.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters + "OR").slice(0, 2);
}

/** "AC" + 7 -> "AC007". The serial just keeps growing past 999 ("AC1000"). */
export function formatEmpCode(prefix: string, serial: number): string {
  return `${prefix}${String(serial).padStart(3, "0")}`;
}
