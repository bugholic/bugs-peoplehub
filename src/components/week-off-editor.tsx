"use client";

import { Select } from "@/components/ui";
import { describeWeekOff, formatWeekOff, parseWeekOff, WEEKDAY_NAMES, type WeekOffRules } from "@/lib/week-off";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];
type Mode = "working" | "all" | "some";

/**
 * Edits a week-off pattern (src/lib/week-off.ts): per weekday, working, off every week, or off
 * on chosen weeks of the month (e.g. 2nd and 4th Saturday). `value` / `onChange` use the
 * canonical text form, e.g. "0,6#2,6#4".
 */
export function WeekOffEditor({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const rules = parseWeekOff(value);

  function update(day: number, rule: WeekOffRules[number]) {
    const next = [...rules];
    next[day] = rule;
    onChange(formatWeekOff(next));
  }

  const modeOf = (day: number): Mode => (rules[day] === "all" ? "all" : rules[day] ? "some" : "working");
  const allOff = rules.every((r) => r === "all");

  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const mode = modeOf(day);
        const weeks = rules[day] instanceof Set ? (rules[day] as Set<number>) : new Set<number>();
        return (
          <div key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="w-24 text-sm font-medium text-foreground">{WEEKDAY_NAMES[day]}</span>
            <div className="w-40">
              <Select
                aria-label={`${WEEKDAY_NAMES[day]} week off`}
                value={mode}
                disabled={disabled}
                onChange={(e) => {
                  const m = e.target.value as Mode;
                  update(day, m === "all" ? "all" : m === "some" ? new Set([2, 4]) : undefined);
                }}
              >
                <option value="working">Working day</option>
                <option value="all">Off every week</option>
                <option value="some">Off some weeks</option>
              </Select>
            </div>
            {mode === "some" && (
              <div className="flex flex-wrap gap-3">
                {ORDINALS.map((label, i) => {
                  const n = i + 1;
                  return (
                    <label key={n} className="flex items-center gap-1.5 text-[13px] text-foreground/80">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        disabled={disabled}
                        checked={weeks.has(n)}
                        onChange={(e) => {
                          const s = new Set(weeks);
                          if (e.target.checked) s.add(n);
                          else s.delete(n);
                          update(day, s.size ? s : undefined);
                        }}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className={`text-[13px] ${allOff ? "text-destructive" : "text-muted-foreground"}`}>
        {allOff ? "At least one day must be a working day." : <>Weekly off: <strong className="text-foreground/80">{describeWeekOff(value)}</strong></>}
      </p>
    </div>
  );
}
