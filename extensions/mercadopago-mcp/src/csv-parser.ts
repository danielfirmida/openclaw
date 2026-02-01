// Streaming CSV parser with memory efficiency and injection protection

export interface CsvRow {
  [key: string]: string;
}

// Sanitize CSV values to prevent formula injection
function sanitizeValue(value: string): string {
  // Check for formula injection characters but allow legitimate negative numbers
  // Formula injection typically starts with =, +, -, @ followed by non-numeric content
  // A negative number like -75 or -3.14 should not be sanitized
  if (/^[=@]/.test(value)) {
    return `'${value}`;
  }
  // For + and -, only sanitize if not followed by a valid number
  if (/^[+-]/.test(value) && !/^[+-]?\d+\.?\d*$/.test(value)) {
    return `'${value}`;
  }
  // Sanitize tab and carriage return
  if (/^[\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Parse CSV handling quoted fields correctly
export function* parseCSVStream(csv: string): Generator<CsvRow> {
  const lines = csv.split("\n");
  if (lines.length === 0) return;

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: CsvRow = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = sanitizeValue(values[j] ?? "");
    }

    yield row;
  }
}

// Aggregate cashflow from CSV with streaming
export function aggregateCashflow(csv: string): {
  totalInflow: number;
  totalOutflow: number;
  transactionCount: number;
} {
  let totalInflow = 0;
  let totalOutflow = 0;
  let transactionCount = 0;

  for (const row of parseCSVStream(csv)) {
    const credit = parseFloat(row.NET_CREDIT_AMOUNT || "0");
    const debitRaw = parseFloat(row.NET_DEBIT_AMOUNT || "0");

    // Handle both positive and negative debit values
    const debit = Math.abs(debitRaw);

    if (!isNaN(credit) && credit > 0) totalInflow += credit;
    if (!isNaN(debit) && debit > 0) totalOutflow += debit;
    transactionCount++;
  }

  return { totalInflow, totalOutflow, transactionCount };
}
