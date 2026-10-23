// Time helpers. FAMILYPULSE_NOW pins the clock for deterministic demos/tests.
export const now = () => new Date(process.env.FAMILYPULSE_NOW || Date.now());
export const ymd = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local TZ
export const at = (day, hhmm) => new Date(`${day}T${hhmm}:00`);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const spoken = (d) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\u202f/g, " ").replace(":00", "");
export const spokenHHMM = (day, hhmm) => spoken(at(day, hhmm));
export const joinList = (xs) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
