import { describe, expect, it } from "vitest";
import { financials } from "./data.ts";
import { deriveMetrics } from "./metrics.ts";

const recordFor = (company: string) => {
  const record = financials.find((f) => f.company === company);
  if (!record) throw new Error(`no record for ${company}`);
  return record;
};

describe("deriveMetrics", () => {
  it("computes year-over-year revenue growth", () => {
    const derived = deriveMetrics(recordFor("Acme Robotics"));
    expect(derived.annual.map((a) => a.revenueGrowthPct)).toEqual([null, 45.2, 48.2, 52.7, 47.1]);
  });

  it("computes full-span and three-year revenue CAGR", () => {
    const derived = deriveMetrics(recordFor("Globex Inc"));
    expect(derived.revenueCagr).toEqual([
      { fromYear: 2021, toYear: 2025, cagrPct: 1.4 },
      { fromYear: 2022, toYear: 2025, cagrPct: 1.1 },
    ]);
  });

  it("computes margins from the reported figures", () => {
    const fy2025 = deriveMetrics(recordFor("Acme Robotics")).annual.at(-1)!;
    expect(fy2025.operatingMarginPct).toBe(5.1);
    expect(fy2025.netMarginPct).toBe(3.7);
    expect(fy2025.freeCashFlowMarginPct).toBe(3.1);
  });

  it("excludes unreported years and flags them", () => {
    const derived = deriveMetrics(recordFor("Initech"));
    expect(derived.latestReportedYear).toBe(2024);
    expect(derived.unreportedYears).toEqual([2025]);
    expect(derived.annual.at(-1)).toEqual({
      fiscalYear: 2025,
      revenueGrowthPct: null,
      operatingMarginPct: null,
      netMarginPct: null,
      freeCashFlowMarginPct: null,
    });
    // Three-year window ends at the last reported year, not FY2025.
    expect(derived.revenueCagr).toEqual([{ fromYear: 2021, toYear: 2024, cagrPct: 15.6 }]);
  });
});
