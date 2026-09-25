(function (window) {
  const TYPE_META = {
    LOW_STOCK: { label: 'Low stock', icon: 'inventory', severity: 'warning' },
    OUT_OF_STOCK: { label: 'Out of stock', icon: 'inventory', severity: 'critical' },
    PAYMENT_FAILED: { label: 'Payment failed', icon: 'alert', severity: 'critical' },
    REFUND_REQUEST: { label: 'Refund requested', icon: 'sales', severity: 'warning' },
    REFUND_COMPLETED: { label: 'Refund completed', icon: 'check', severity: 'info' },
    CASH_SHORTAGE: { label: 'Cash shortage', icon: 'alert', severity: 'critical' },
    CASH_OVER: { label: 'Cash over', icon: 'alert', severity: 'warning' },
    SHIFT_OPENED: { label: 'Shift opened', icon: 'check', severity: 'info' },
    SHIFT_CLOSED: { label: 'Shift closed', icon: 'check', severity: 'info' },
    SALE_CANCELLED: { label: 'Sale cancelled', icon: 'sales', severity: 'warning' },
    TRANSFER_REQUESTED: { label: 'Transfer requested', icon: 'branches', severity: 'info' },
    ETIMS_FAILED: { label: 'eTIMS failed', icon: 'alert', severity: 'critical' },
    CREDIT_DUE: { label: 'Credit due', icon: 'employees', severity: 'warning' },
    CREDIT_SALE: { label: 'Credit sale', icon: 'sales', severity: 'info' },
    CUSTOMER_PAYMENT: { label: 'Payment received', icon: 'check', severity: 'info' },
    SYSTEM_ALERT: { label: 'System alert', icon: 'alert', severity: 'warning' },
    EMPLOYEE_ALERT: { label: 'Staff alert', icon: 'alert', severity: 'warning' },
  };

  // Same subset the backend's POST /notifications/alert accepts.
  const EMPLOYEE_RAISABLE_TYPES = ['LOW_STOCK', 'OUT_OF_STOCK', 'PAYMENT_FAILED', 'REFUND_REQUEST', 'CASH_SHORTAGE', 'CREDIT_DUE', 'SYSTEM_ALERT'];

  const QUICK_FILTERS = [
    ['', 'All'], ['CASH_SHORTAGE', 'Cash shortage'], ['SHIFT_CLOSED', 'Shifts'],
    ['LOW_STOCK', 'Stock'], ['SALE_CANCELLED', 'Sales'], ['REFUND_REQUEST', 'Refunds'],
    ['TRANSFER_REQUESTED', 'Transfers'], ['PAYMENT_FAILED', 'Payments'],
    ['CREDIT_DUE', 'Credit due'], ['CREDIT_SALE', 'Credit sales'], ['CUSTOMER_PAYMENT', 'Payments received'],
  ];

  function meta(type) {
    return TYPE_META[type] || { label: type, icon: 'alert', severity: 'info' };
  }

  window.NotificationTypes = { TYPE_META, EMPLOYEE_RAISABLE_TYPES, QUICK_FILTERS, meta };
})(window);