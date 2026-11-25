"use client";

import { useState } from "react";
import { DIAL_CODES, splitPhone } from "@/lib/phone";
import { Input, Select } from "@/components/ui";

/** Country code picker + national number. Emits "+<dial><number>" (or "" when empty); the API normalises to E.164. */
export function PhoneInput({ value, onChange, placeholder = "98765 43210" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const initial = splitPhone(value);
  // Local state so changing the country before typing a number isn't lost.
  const [dial, setDial] = useState(initial.dial || DIAL_CODES[0].code);
  const national = splitPhone(value).national;

  const emit = (d: string, n: string) => onChange(n.trim() ? `+${d}${n.replace(/\D/g, "").replace(/^0+/, "")}` : "");

  return (
    <div className="flex gap-2">
      <Select
        aria-label="Country code"
        className="w-28 shrink-0"
        value={dial}
        onChange={(e) => {
          setDial(e.target.value);
          emit(e.target.value, national);
        }}
      >
        {DIAL_CODES.map((d) => (
          <option key={d.code} value={d.code}>
            +{d.code} {d.country}
          </option>
        ))}
      </Select>
      <Input type="tel" inputMode="tel" autoComplete="tel-national" aria-label="Phone number" placeholder={placeholder} value={national} onChange={(e) => emit(dial, e.target.value)} />
    </div>
  );
}
