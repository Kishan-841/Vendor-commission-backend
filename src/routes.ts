import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { vendorRouter } from './modules/vendors/vendor.routes.js';
import { zoneRouter } from './modules/zones/zone.routes.js';
import { calculationRouter } from './modules/calculations/calculation.routes.js';
import { approvalRouter } from './modules/approvals/approval.routes.js';
import { billRouter } from './modules/bills/bill.routes.js';
import { salesRouter, salesSummaryRouter } from './modules/sales/sales.routes.js';
import { payoutRouter } from './modules/payouts/payout.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';

// Aggregates all module routers under /api. Each module is added here as it's built.
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/vendors', vendorRouter); // Module 1
apiRouter.use('/zones', zoneRouter); // Module 2
// salesRouter first: its literal generation paths (/generate-vendor,
// /vendors-for-month, …) must win over calculationRouter's GET /:id, which
// would otherwise swallow them as an id. Real ids fall through to it.
apiRouter.use('/calculations', salesRouter); // Sheet-driven generation (Tab 2)
apiRouter.use('/calculations', calculationRouter); // Module 3
apiRouter.use('/calculations', approvalRouter); // Module 4 (workflow actions on calculations)
apiRouter.use('/sales', salesSummaryRouter); // Sales Summary (months/list/filters)
apiRouter.use('/payouts', payoutRouter); // Vendor payout tracking + receipts + CSV export
apiRouter.use('/dashboard', dashboardRouter); // Overview stats
apiRouter.use('/reports', reportRouter); // Zone-wise commission report + export
apiRouter.use('/bills', billRouter); // Module 5
apiRouter.use('/logs', auditRouter); // System logs (ADMIN)
