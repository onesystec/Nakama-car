/**
 * Live estimate pricing in the browser. Mirrors apps/api/app/services/pricing.py
 * (price_line), so the editor shows the same totals the server stores on Salva.
 */

export type PricingTerms = {
  labor_included?: boolean;
  labor_discount_percent?: string | number | null;
  parts_markup_percent?: string | number | null;
};

export type PricedFields = {
  category: string;
  quantity: string;
  unit_price: string;
  markup_percent?: string;
  discount_percent: string;
  labor_hours: string;
  labor_rate: string;
  paint_hours: string;
  paint_rate: string;
  materials: string;
  vat_rate: string;
};

export type LineAmounts = { parts: number; labor: number; subtotal: number; vat: number; total: number };

const num = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Round to cents, half up (as Decimal ROUND_HALF_UP on the server). */
export function money(value: number) {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function priceLine(line: PricedFields, terms: PricingTerms | null | undefined): LineAmounts {
  const discount = num(line.discount_percent) / 100;
  const markup = num(terms?.parts_markup_percent) / 100;
  // Workshop markup on the part cost (internal: the customer only sees the resulting price).
  const costMarkup = num(line.markup_percent) / 100;
  let parts = num(line.quantity) * num(line.unit_price) * (1 + costMarkup) * (1 - discount);
  parts = (parts + num(line.materials)) * (1 + markup);
  let labor = num(line.labor_hours) * num(line.labor_rate) + num(line.paint_hours) * num(line.paint_rate);
  labor = terms?.labor_included ? 0 : labor * (1 - num(terms?.labor_discount_percent) / 100);
  const partsMoney = money(parts);
  const laborMoney = money(labor);
  const subtotal = money(partsMoney + laborMoney);
  const vat = money((subtotal * num(line.vat_rate)) / 100);
  return { parts: partsMoney, labor: laborMoney, subtotal, vat, total: money(subtotal + vat) };
}

const laborCategories = new Set(["MECHANICAL_LABOR", "DIAGNOSTIC", "ELECTRICAL", "BODY_LABOR"]);

/**
 * Fields that still need a price on a line whose total is 0, so the editor can
 * mark them in red. Empty when the line is priced, or when its labor is free
 * because the fleet contract includes it.
 */
export function missingPriceFields(line: PricedFields, terms: PricingTerms | null | undefined): (keyof PricedFields)[] {
  if (priceLine(line, terms).subtotal > 0) return [];
  const hasLabor = num(line.labor_hours) > 0 || num(line.paint_hours) > 0;
  if (terms?.labor_included && hasLabor) return [];
  const missing: (keyof PricedFields)[] = [];
  const zero = (field: keyof PricedFields) => num(line[field]) <= 0;
  if (line.category === "PAINT") {
    if (zero("paint_hours") && zero("labor_hours")) missing.push("paint_hours", "labor_hours");
    else if (zero("labor_rate")) missing.push("labor_rate");
    if (zero("materials")) missing.push("materials");
  } else if (laborCategories.has(line.category)) {
    if (zero("labor_hours")) missing.push("labor_hours");
    if (zero("labor_rate")) missing.push("labor_rate");
  } else if (line.category === "MATERIAL") {
    if (zero("unit_price") && zero("materials")) missing.push("unit_price", "materials");
  } else {
    if (zero("quantity")) missing.push("quantity");
    if (zero("unit_price")) missing.push("unit_price");
  }
  return missing.length ? missing : ["unit_price"];
}
