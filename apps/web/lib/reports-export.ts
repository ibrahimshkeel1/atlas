import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

type ReportPayload = {
  period_start: string;
  period_end: string;
  total_income: number;
  total_expenses: number;
  net_cash_flow: number;
  transaction_count: number;
  by_category: { name: string; type: string; income: number; expenses: number }[];
  transactions: {
    date: string;
    description: string;
    debit: string | number | null;
    credit: string | number | null;
    category: string;
    review_status: string;
  }[];
};

type Meta = { client_name: string; prepared_by: string; prepared_date: string };

export async function buildExcelReport(payload: ReportPayload, meta: Meta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Transactions");
  ws.addRow(["Atlas Finance AI — Working papers"]).font = { bold: true, size: 14 };
  ws.addRow(["Client", meta.client_name]);
  ws.addRow(["Period", `${payload.period_start} to ${payload.period_end}`]);
  ws.addRow(["Prepared", `${meta.prepared_date} by ${meta.prepared_by}`]);
  ws.addRow([]);
  ws.addRow([
    "Date",
    "Description",
    "Debit",
    "Credit",
    "Category",
    "Review status",
  ]).font = { bold: true };
  for (const t of payload.transactions) {
    ws.addRow([t.date, t.description, t.debit, t.credit, t.category, t.review_status]);
  }
  const summary = wb.addWorksheet("Summary");
  summary.addRow(["Total income", payload.total_income]);
  summary.addRow(["Total expenses", payload.total_expenses]);
  summary.addRow(["Net cash flow", payload.net_cash_flow]);
  summary.addRow([]);
  summary.addRow(["Category", "Type", "Income", "Expenses"]).font = { bold: true };
  for (const c of payload.by_category) {
    summary.addRow([c.name, c.type, c.income, c.expenses]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildPdfReport(payload: ReportPayload, meta: Meta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Atlas Finance AI — Working papers", { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(`Client: ${meta.client_name}`);
    doc.text(`Period: ${payload.period_start} to ${payload.period_end}`);
    doc.text(`Prepared: ${meta.prepared_date} by ${meta.prepared_by}`);
    doc.text(`Currency: PKR`);
    doc.moveDown();
    doc.text(
      `Income: ${payload.total_income.toLocaleString()}  Expenses: ${payload.total_expenses.toLocaleString()}  Net: ${payload.net_cash_flow.toLocaleString()}`
    );
    doc.moveDown();
    doc.fontSize(10);
    for (const t of payload.transactions.slice(0, 200)) {
      doc.text(
        `${t.date}  ${t.description.slice(0, 60)}  D:${t.debit ?? "-"}  C:${t.credit ?? "-"}  [${t.category}]`
      );
    }
    if (payload.transactions.length > 200) {
      doc.moveDown().text(`… and ${payload.transactions.length - 200} more rows (see Excel export).`);
    }
    doc.end();
  });
}
