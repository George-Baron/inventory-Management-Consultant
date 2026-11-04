// Single source of truth for roles, staff modules and their fields.
// The server validates records against this file; the browser renders forms and tables from it.

const ROLES = {
  admin: 'Administrator',
  audit: 'Audit',
  accountant: 'Accountant',
  hr: 'HR',
  inventory: 'Inventory',
  sales: 'Sales',
  marketing: 'Marketing',
};

const MODULES = {
  ledger: {
    title: 'Accounts ledger',
    group: 'Accounting',
    roles: ['accountant'],
    blurb: 'Record income and expenses and see the running balance.',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'kind', label: 'Type', type: 'select', options: ['Income', 'Expense'], required: true },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'amount', label: 'Amount (NGN)', type: 'number', required: true, money: true },
    ],
    summary: [
      { label: 'Income', op: 'sum', field: 'amount', where: { kind: 'Income' }, money: true },
      { label: 'Expenses', op: 'sum', field: 'amount', where: { kind: 'Expense' }, money: true },
      { label: 'Balance', op: 'signed', field: 'amount', key: 'kind', positive: 'Income', negative: 'Expense', money: true },
    ],
  },
  invoices: {
    title: 'Invoices',
    group: 'Accounting',
    roles: ['accountant'],
    blurb: 'Track what clients owe and what has been paid.',
    fields: [
      { key: 'number', label: 'Invoice no.', type: 'text', required: true },
      { key: 'client', label: 'Client', type: 'text', required: true },
      { key: 'issued', label: 'Issued', type: 'date' },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'amount', label: 'Amount (NGN)', type: 'number', required: true, money: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent', 'Paid', 'Overdue'], required: true },
    ],
    summary: [
      { label: 'Invoices', op: 'count' },
      { label: 'Outstanding', op: 'sum', field: 'amount', where: { status: ['Sent', 'Overdue'] }, money: true },
      { label: 'Paid', op: 'sum', field: 'amount', where: { status: 'Paid' }, money: true },
    ],
  },
  audit: {
    title: 'Audit findings',
    group: 'Audit',
    roles: ['audit'],
    blurb: 'Log findings, rate their severity and follow them to closure.',
    fields: [
      { key: 'title', label: 'Finding', type: 'text', required: true },
      { key: 'area', label: 'Area', type: 'select', options: ['Stock', 'Cash', 'Sales', 'Purchasing', 'Payroll', 'Expenses', 'Other'] },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'In progress', 'Resolved'], required: true },
      { key: 'owner', label: 'Owner', type: 'text' },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: [
      { label: 'Findings', op: 'count' },
      { label: 'Open', op: 'count', where: { status: ['Open', 'In progress'] } },
      { label: 'High / critical open', op: 'count', where: { severity: ['High', 'Critical'], status: ['Open', 'In progress'] } },
    ],
  },
  countsheets: {
    title: 'Stock count variances',
    group: 'Audit',
    roles: ['audit', 'inventory'],
    blurb: 'Compare system quantity with counted quantity and see the value of each gap.',
    fields: [
      { key: 'date', label: 'Count date', type: 'date', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'system', label: 'System qty', type: 'number', required: true },
      { key: 'counted', label: 'Counted qty', type: 'number', required: true },
      { key: 'cost', label: 'Unit cost (NGN)', type: 'number', money: true },
      { key: 'variance', label: 'Variance', type: 'computed', compute: { op: 'sub', a: 'counted', b: 'system' } },
      { key: 'varianceValue', label: 'Variance value', type: 'computed', compute: { op: 'mulsub', a: 'counted', b: 'system', c: 'cost' }, money: true },
    ],
    summary: [
      { label: 'Lines counted', op: 'count' },
      { label: 'Lines with variance', op: 'countNonZero', field: 'variance' },
      { label: 'Net variance value', op: 'sumComputed', field: 'varianceValue', money: true },
    ],
  },
  recruitment: {
    title: 'Recruitment pipeline',
    group: 'HR',
    roles: ['hr'],
    blurb: 'Follow candidates from application to hire.',
    fields: [
      { key: 'name', label: 'Candidate', type: 'text', required: true },
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'client', label: 'For client', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'select', options: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'], required: true },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: [
      { label: 'Candidates', op: 'count' },
      { label: 'In process', op: 'count', where: { stage: ['Screening', 'Interview', 'Offer'] } },
      { label: 'Hired', op: 'count', where: { stage: 'Hired' } },
    ],
  },
  orgreview: {
    title: 'Structure inspection',
    group: 'HR',
    roles: ['hr'],
    blurb: 'Inspect a client\'s organisation structure, record gaps and activate the fixes.',
    fields: [
      { key: 'client', label: 'Client', type: 'text', required: true },
      { key: 'unit', label: 'Unit / department', type: 'text', required: true },
      { key: 'finding', label: 'Finding', type: 'textarea', required: true },
      { key: 'action', label: 'Recommended action', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['Inspected', 'Planned', 'Activated'], required: true },
    ],
    summary: [
      { label: 'Items', op: 'count' },
      { label: 'Planned', op: 'count', where: { status: 'Planned' } },
      { label: 'Activated', op: 'count', where: { status: 'Activated' } },
    ],
  },
  stock: {
    title: 'Stock list',
    group: 'Inventory',
    roles: ['inventory'],
    blurb: 'Quantities, reorder levels and stock value, with low-stock flags.',
    fields: [
      { key: 'sku', label: 'SKU', type: 'text', required: true },
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'qty', label: 'Qty on hand', type: 'number', required: true },
      { key: 'reorder', label: 'Reorder level', type: 'number' },
      { key: 'cost', label: 'Unit cost (NGN)', type: 'number', money: true },
      { key: 'expiry', label: 'Expiry', type: 'date' },
      { key: 'value', label: 'Stock value', type: 'computed', compute: { op: 'mul', a: 'qty', b: 'cost' }, money: true },
    ],
    flagLow: { qty: 'qty', reorder: 'reorder' },
    summary: [
      { label: 'Items', op: 'count' },
      { label: 'Low stock', op: 'lowStock' },
      { label: 'Stock value', op: 'sumComputed', field: 'value', money: true },
    ],
  },
  pipeline: {
    title: 'Sales pipeline',
    group: 'Sales',
    roles: ['sales'],
    blurb: 'Prospects, proposals and follow-ups.',
    fields: [
      { key: 'company', label: 'Company', type: 'text', required: true },
      { key: 'contact', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'service', label: 'Service', type: 'select', options: ['Inventory consulting', 'POS & inventory setup', 'HR admin', 'Accounting & audit', 'Website & marketing', 'Odoo / AppSheet'] },
      { key: 'value', label: 'Deal value (NGN)', type: 'number', money: true },
      { key: 'stage', label: 'Stage', type: 'select', options: ['Lead', 'Proposal', 'Negotiation', 'Won', 'Lost'], required: true },
      { key: 'followUp', label: 'Next follow-up', type: 'date' },
    ],
    summary: [
      { label: 'Deals', op: 'count' },
      { label: 'Open value', op: 'sum', field: 'value', where: { stage: ['Lead', 'Proposal', 'Negotiation'] }, money: true },
      { label: 'Won value', op: 'sum', field: 'value', where: { stage: 'Won' }, money: true },
    ],
  },
  campaigns: {
    title: 'Content & campaigns',
    group: 'Marketing',
    roles: ['marketing'],
    blurb: 'Plan posts and campaigns and track what is published.',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'channel', label: 'Channel', type: 'select', options: ['WhatsApp', 'Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'Website', 'Email'] },
      { key: 'date', label: 'Publish date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Idea', 'Drafting', 'Scheduled', 'Published'], required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: [
      { label: 'Items', op: 'count' },
      { label: 'Scheduled', op: 'count', where: { status: 'Scheduled' } },
      { label: 'Published', op: 'count', where: { status: 'Published' } },
    ],
  },
};

function modulesForRole(role) {
  return Object.entries(MODULES)
    .filter(([, m]) => role === 'admin' || m.roles.includes(role))
    .map(([id]) => id);
}

module.exports = { ROLES, MODULES, modulesForRole };
