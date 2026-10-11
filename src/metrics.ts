/**
 * Derived metrics for a financial record. Computed in code so the model reads
 * growth rates and margins instead of doing the arithmetic itself.
 */

import type { FinancialRecord } from "./data.ts";

export interface YearMetrics {
  fiscalYear: number;
  revenueGrowthPct: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  freeCashFlowMarginPct: number | null;
}

export interface RevenueCagr {
  fromYear: number;
  toYear: number;
  cagrPct: number;
}

export interface DerivedMetrics {
  note: string;
  latestReportedYear: number | null;
  unreportedYears: number[];
  annual: YearMetrics[];
  revenueCagr: RevenueCagr[];
}

const pct = (n: number) => Math.round(n * 1000) / 10;

function ratioPct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return pct(numerator / denominator);
}

export function deriveMetrics(record: FinancialRecord): DerivedMetrics {
  const annual = [...record.annual].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const revenueByYear = new Map(annual.map((a) => [a.fiscalYear, a.revenue]));
  const reported = annual.filter((a) => a.revenue !== null);

  const cagr = (fromYear: number, toYear: number): RevenueCagr | null => {
    const from = revenueByYear.get(fromYear);
    const to = revenueByYear.get(toYear);
    if (from == null || to == null || toYear <= fromYear) return null;
    return { fromYear, toYear, cagrPct: pct((to / from) ** (1 / (toYear - fromYear)) - 1) };
  };

  const latest = reported.at(-1)?.fiscalYear ?? null;
  const earliest = reported[0]?.fiscalYear ?? null;
  const revenueCagr: RevenueCagr[] = [];
  if (latest !== null && earliest !== null) {
    const fullSpan = cagr(earliest, latest);
    if (fullSpan) revenueCagr.push(fullSpan);
    const threeYear = cagr(latest - 3, latest);
    if (threeYear && latest - 3 !== earliest) revenueCagr.push(threeYear);
  }

  return {
    note: "Computed from the annual figures. All values are percentages (15.6 = 15.6%). Unreported years have null figures and are excluded from growth rates.",
    latestReportedYear: latest,
    unreportedYears: annual.filter((a) => a.revenue === null).map((a) => a.fiscalYear),
    annual: annual.map((a) => {
      const prior = revenueByYear.get(a.fiscalYear - 1) ?? null;
      return {
        fiscalYear: a.fiscalYear,
        revenueGrowthPct:
          a.revenue === null || prior === null ? null : pct(a.revenue / prior - 1),
        operatingMarginPct: ratioPct(a.operatingIncome, a.revenue),
        netMarginPct: ratioPct(a.netIncome, a.revenue),
        freeCashFlowMarginPct: ratioPct(a.freeCashFlow, a.revenue),
      };
    }),
    revenueCagr,
  };
}
