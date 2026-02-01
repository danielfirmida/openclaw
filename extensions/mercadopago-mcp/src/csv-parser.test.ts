import { describe, expect, it } from "vitest";

import { aggregateCashflow, parseCSVStream } from "./csv-parser.js";

describe("parseCSVStream", () => {
  it("parses simple CSV", () => {
    const csv = `name,value
alice,100
bob,200`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([
      { name: "alice", value: "100" },
      { name: "bob", value: "200" },
    ]);
  });

  it("handles quoted fields with commas", () => {
    const csv = `name,description,value
alice,"Hello, world",100`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([{ name: "alice", description: "Hello, world", value: "100" }]);
  });

  it("handles quoted fields with escaped quotes", () => {
    const csv = `name,description
alice,"She said ""Hello"""`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([{ name: "alice", description: 'She said "Hello"' }]);
  });

  it("handles empty lines", () => {
    const csv = `name,value
alice,100

bob,200
`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([
      { name: "alice", value: "100" },
      { name: "bob", value: "200" },
    ]);
  });

  it("sanitizes formula injection", () => {
    const csv = `name,formula
alice,=SUM(A1:A10)
bob,+cmd.exe
carol,-DROP TABLE
dave,@system`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([
      { name: "alice", formula: "'=SUM(A1:A10)" },
      { name: "bob", formula: "'+cmd.exe" },
      { name: "carol", formula: "'-DROP TABLE" },
      { name: "dave", formula: "'@system" },
    ]);
  });

  it("allows legitimate negative and positive numbers", () => {
    const csv = `name,value
alice,-75
bob,+100
carol,-3.14`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([
      { name: "alice", value: "-75" },
      { name: "bob", value: "+100" },
      { name: "carol", value: "-3.14" },
    ]);
  });

  it("returns empty for empty input", () => {
    const rows = [...parseCSVStream("")];
    expect(rows).toEqual([]);
  });

  it("handles missing values", () => {
    const csv = `a,b,c
1,,3`;
    const rows = [...parseCSVStream(csv)];
    expect(rows).toEqual([{ a: "1", b: "", c: "3" }]);
  });
});

describe("aggregateCashflow", () => {
  it("aggregates inflows and outflows", () => {
    const csv = `DATE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT
2026-01-01,100.50,0
2026-01-02,200.00,0
2026-01-03,0,50.25`;
    const result = aggregateCashflow(csv);
    expect(result).toEqual({
      totalInflow: 300.5,
      totalOutflow: 50.25,
      transactionCount: 3,
    });
  });

  it("handles negative debit values", () => {
    const csv = `DATE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT
2026-01-01,100,0
2026-01-02,0,-75`;
    const result = aggregateCashflow(csv);
    expect(result).toEqual({
      totalInflow: 100,
      totalOutflow: 75,
      transactionCount: 2,
    });
  });

  it("handles empty CSV", () => {
    const csv = `DATE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT`;
    const result = aggregateCashflow(csv);
    expect(result).toEqual({
      totalInflow: 0,
      totalOutflow: 0,
      transactionCount: 0,
    });
  });

  it("handles malformed numbers gracefully", () => {
    const csv = `DATE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT
2026-01-01,abc,0
2026-01-02,100,xyz`;
    const result = aggregateCashflow(csv);
    expect(result).toEqual({
      totalInflow: 100,
      totalOutflow: 0,
      transactionCount: 2,
    });
  });
});
