import PDFDocument from 'pdfkit';

// Collect a PDFKit document into a Buffer (no disk). Callers persist/stream it.
function docToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export interface BillPdfData {
  billNumber: string;
  generatedAt: Date;
  billingMonth: string;
  billingPeriod?: string | null;
  vendor: {
    name: string;
    companyName?: string | null;
    address?: string | null;
    email?: string | null;
    mobileNumber?: string | null;
    panNumber?: string | null;
    gstNumber?: string | null;
  };
  items: { description: string; commissionPercentage?: number | null; baseAmount?: number | null; amount: number }[];
  grossCommission: number;
  gstAmount: number;
  tdsAmount: number;
  fixedPayAmount?: number;
  finalPayable: number;
}

const inr = (n: number) =>
  '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Render a commission bill PDF and return it as a Buffer (caller stores/streams).
// Vendor -> Gazon commission bill: header, vendor block, zone-wise line items,
// then the GST/TDS/final-payable summary.
export function generateBillPdf(data: BillPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const done = docToBuffer(doc);

    // ── Header ────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text('GAZON', { continued: false });
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Commission Bill', { align: 'left' });
    doc.moveUp(2);
    doc.fontSize(10).fillColor('#000').text(`Bill No: ${data.billNumber}`, { align: 'right' });
    doc.fontSize(10).fillColor('#555').text(
      `Date: ${data.generatedAt.toLocaleDateString('en-IN')}`,
      { align: 'right' },
    );
    doc.fillColor('#000');
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(1);

    // ── Vendor block ──────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Vendor');
    doc.font('Helvetica').fontSize(10);
    if (data.vendor.companyName) doc.text(data.vendor.companyName);
    doc.text(data.vendor.name);
    if (data.vendor.address) doc.text(data.vendor.address);
    const contact = [data.vendor.email, data.vendor.mobileNumber].filter(Boolean).join('  |  ');
    if (contact) doc.text(contact);
    const tax = [
      data.vendor.panNumber ? `PAN: ${data.vendor.panNumber}` : null,
      data.vendor.gstNumber ? `GST: ${data.vendor.gstNumber}` : null,
    ]
      .filter(Boolean)
      .join('  |  ');
    if (tax) doc.text(tax);

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text(`Billing Month: `, { continued: true }).font('Helvetica').text(data.billingMonth);
    if (data.billingPeriod) {
      doc.font('Helvetica-Bold').text(`Billing Period: `, { continued: true }).font('Helvetica').text(data.billingPeriod);
    }
    doc.moveDown(1);

    // ── Line items table ──────────────────────────────────────────────────
    const tableTop = doc.y;
    const cols = { zone: 50, pct: 280, base: 360, amount: 460 };
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Zone', cols.zone, tableTop);
    doc.text('Comm %', cols.pct, tableTop, { width: 60, align: 'right' });
    doc.text('Base', cols.base, tableTop, { width: 80, align: 'right' });
    doc.text('Commission', cols.amount, tableTop, { width: 85, align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(10);
    for (const item of data.items) {
      const y = doc.y;
      doc.text(item.description, cols.zone, y, { width: 220 });
      doc.text(item.commissionPercentage != null ? `${item.commissionPercentage}%` : '-', cols.pct, y, { width: 60, align: 'right' });
      doc.text(item.baseAmount != null ? inr(item.baseAmount) : '-', cols.base, y, { width: 80, align: 'right' });
      doc.text(inr(item.amount), cols.amount, y, { width: 85, align: 'right' });
      doc.moveDown(0.4);
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);

    // ── Summary ───────────────────────────────────────────────────────────
    const summaryRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.text(label, 300, y, { width: 150, align: 'right' });
      doc.text(value, 460, y, { width: 85, align: 'right' });
      doc.moveDown(bold ? 0.2 : 0.35);
    };
    summaryRow('Gross Commission', inr(data.grossCommission));
    // Fixed pay joins the base before taxes (GST/TDS apply to gross + fixed).
    // Negative fixed pay is a deduction and must still appear.
    const fixedPay = data.fixedPayAmount ?? 0;
    if (fixedPay !== 0) {
      summaryRow('Fixed Pay', (fixedPay > 0 ? '+ ' : '- ') + inr(Math.abs(fixedPay)));
    }
    summaryRow('GST', '+ ' + inr(data.gstAmount));
    summaryRow('TDS', '- ' + inr(data.tdsAmount));
    // Final payable is rounded to the whole rupee; show the adjustment so the
    // summary lines add up exactly to the final figure.
    const roundOff =
      Math.round((data.finalPayable - (data.grossCommission + fixedPay + data.gstAmount - data.tdsAmount)) * 100) / 100;
    if (roundOff !== 0) {
      summaryRow('Round Off', (roundOff > 0 ? '+ ' : '- ') + inr(Math.abs(roundOff)));
    }
    doc.moveDown(0.2);
    doc.moveTo(300, doc.y).lineTo(545, doc.y).strokeColor('#888').stroke();
    doc.moveDown(0.4);
    summaryRow('Final Payable', inr(data.finalPayable), true);

    doc.moveDown(3);
    doc.fontSize(8).fillColor('#888').text(
      'This is a system-generated commission bill from the Vendor Commission Management System (VCMS).',
      50,
      doc.y,
      { align: 'center', width: 495 },
    );

  doc.end();
  return done;
}

export interface ReceiptPdfData {
  receiptNumber: string;
  paymentDate: Date;
  paymentMode: string;
  paymentReference?: string | null;
  notes?: string | null;
  paidAmount: number;
  paidByName?: string | null;
  vendor: { name: string; companyName?: string | null; address?: string | null; panNumber?: string | null };
  calculation: { month: string; finalPayable: number; totalPaid: number; billNumber?: string | null };
}

// Render a payment receipt PDF and return the absolute path. One receipt per
// PayoutPayment; regenerated on demand (nothing is stored on the record).
export function generateReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const done = docToBuffer(doc);

    // ── Header ────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text('GAZON');
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Commission Payment Receipt');
    doc.moveUp(2);
    doc.fontSize(10).fillColor('#000').text(`Receipt No: ${data.receiptNumber}`, { align: 'right' });
    doc
      .fontSize(10)
      .fillColor('#555')
      .text(`Payment Date: ${data.paymentDate.toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.fillColor('#000');
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(1);

    // ── Vendor block ──────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Paid To');
    doc.fontSize(10).font('Helvetica').text(data.vendor.name);
    if (data.vendor.companyName) doc.text(data.vendor.companyName);
    if (data.vendor.address) doc.fillColor('#555').text(data.vendor.address).fillColor('#000');
    if (data.vendor.panNumber) doc.text(`PAN: ${data.vendor.panNumber}`);
    doc.moveDown(1);

    // ── Payment details table ─────────────────────────────────────────────
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('#555').text(label, 50, y, { width: 180 });
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 12 : 10)
        .fillColor('#000')
        .text(value, 240, y, { width: 305 });
      doc.moveDown(0.5);
    };
    row('Commission Month', data.calculation.month);
    if (data.calculation.billNumber) row('Against Bill', data.calculation.billNumber);
    row('Payment Mode', data.paymentMode.replace(/_/g, ' '));
    if (data.paymentReference) row('Payment Reference', data.paymentReference);
    if (data.paidByName) row('Processed By', data.paidByName);
    if (data.notes) row('Notes', data.notes);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);
    row('Amount Paid (this receipt)', inr(data.paidAmount), true);
    row('Total Paid To Date', inr(data.calculation.totalPaid));
    row('Commission Payable', inr(data.calculation.finalPayable));
    const outstanding = Math.max(0, data.calculation.finalPayable - data.calculation.totalPaid);
    row('Outstanding', inr(outstanding), outstanding > 0);

    doc.moveDown(3);
    doc.fontSize(8).fillColor('#888').text(
      'This is a system-generated payment receipt from the Vendor Commission Management System (VCMS).',
      50,
      doc.y,
      { align: 'center', width: 495 },
    );

  doc.end();
  return done;
}

export interface LedgerPdfData {
  vendor: { name: string; companyName?: string | null; email?: string | null; mobileNumber?: string | null };
  summary: { totalPayout: number; totalReceived: number; outstanding: number; receiptCount: number };
  receipts: {
    receiptNumber: string;
    paymentDate: Date;
    paymentMode: string;
    paymentReference?: string | null;
    amount: number;
  }[];
  ledger: {
    date: Date;
    transactionType: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
}

// Render a vendor payout ledger PDF: payout info, receipt summary, ledger
// transactions, financial summary. Returns the absolute path.
export function generateLedgerPdf(data: LedgerPdfData): Promise<Buffer> {
  const d = (dt: Date) => dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const done = docToBuffer(doc);

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').text('GAZON');
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Vendor Payout Ledger');
    doc.moveUp(2);
    doc.fontSize(9).fillColor('#555').text(`Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'right' });
    doc.fillColor('#000');
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.8);

    // ── 1. Payout Information ─────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Payout Information');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(data.vendor.name);
    if (data.vendor.companyName) doc.text(data.vendor.companyName);
    const contact = [data.vendor.email, data.vendor.mobileNumber].filter(Boolean).join(' · ');
    if (contact) doc.fillColor('#555').text(contact).fillColor('#000');
    doc.moveDown(0.8);

    // ── 2. Financial Summary ──────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Financial Summary');
    doc.moveDown(0.3);
    const sRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('#555').text(label, 50, y, { width: 200 });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000').text(value, 250, y, { width: 200 });
      doc.moveDown(0.4);
    };
    sRow('Total Payout', inr(data.summary.totalPayout));
    sRow('Total Received', inr(data.summary.totalReceived));
    sRow('Outstanding Balance', inr(data.summary.outstanding), true);
    sRow('Number of Receipts', String(data.summary.receiptCount));
    doc.moveDown(0.6);

    // Column layout shared by both tables.
    const drawRow = (cells: { text: string; x: number; w: number; align?: 'left' | 'right' }[], opts?: { bold?: boolean; color?: string }) => {
      const y = doc.y;
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(opts?.color ?? '#000');
      for (const c of cells) doc.text(c.text, c.x, y, { width: c.w, align: c.align ?? 'left' });
      doc.moveDown(0.5);
    };

    // ── 3. Receipt Summary ────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Receipt Summary');
    doc.moveDown(0.3);
    const rc = [
      { key: 'Receipt No', x: 50, w: 110 },
      { key: 'Date', x: 160, w: 80 },
      { key: 'Mode', x: 240, w: 110 },
      { key: 'Reference', x: 350, w: 110 },
      { key: 'Amount', x: 460, w: 85, align: 'right' as const },
    ];
    drawRow(rc.map((c) => ({ text: c.key, x: c.x, w: c.w, align: c.align })), { bold: true });
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.3);
    if (data.receipts.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888').text('No receipts recorded.', 50);
      doc.moveDown(0.5);
    } else {
      for (const r of data.receipts) {
        drawRow([
          { text: r.receiptNumber, x: 50, w: 110 },
          { text: d(r.paymentDate), x: 160, w: 80 },
          { text: r.paymentMode.replace(/_/g, ' '), x: 240, w: 110 },
          { text: r.paymentReference ?? '-', x: 350, w: 110 },
          { text: inr(r.amount), x: 460, w: 85, align: 'right' },
        ]);
      }
    }
    doc.moveDown(0.6);

    // ── 4. Ledger Transactions ────────────────────────────────────────────────
    if (doc.y > 640) doc.addPage();
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text('Ledger Transactions');
    doc.moveDown(0.3);
    const lc = [
      { key: 'Date', x: 50, w: 62 },
      { key: 'Type', x: 112, w: 90 },
      { key: 'Reference', x: 202, w: 95 },
      { key: 'Debit', x: 297, w: 78, align: 'right' as const },
      { key: 'Credit', x: 375, w: 78, align: 'right' as const },
      { key: 'Balance', x: 453, w: 92, align: 'right' as const },
    ];
    drawRow(lc.map((c) => ({ text: c.key, x: c.x, w: c.w, align: c.align })), { bold: true });
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.3);
    if (data.ledger.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888').text('No ledger transactions.', 50);
    } else {
      for (const e of data.ledger) {
        if (doc.y > 780) doc.addPage();
        drawRow([
          { text: d(e.date), x: 50, w: 62 },
          { text: e.transactionType, x: 112, w: 90 },
          { text: e.reference, x: 202, w: 95 },
          { text: e.debit ? inr(e.debit) : '-', x: 297, w: 78, align: 'right' },
          { text: e.credit ? inr(e.credit) : '-', x: 375, w: 78, align: 'right' },
          { text: inr(e.balance), x: 453, w: 92, align: 'right' },
        ]);
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888').text(
      'This is a system-generated payout ledger from the Vendor Commission Management System (VCMS).',
      50,
      doc.y,
      { align: 'center', width: 495 },
    );

  doc.end();
  return done;
}
