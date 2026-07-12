import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Default PKR for Pakistan bank statements (Meezan, HBL, etc.) */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string = "PKR"
) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
