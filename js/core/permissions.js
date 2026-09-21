/**
 * permissions.js
 * UI-side mirror of the backend's role -> default permission mapping.
 * This is ONLY used to hide/show buttons and menu items so users don't see
 * actions they can't perform. It is NOT a security boundary - the backend
 * re-checks every permission on every request regardless of what the UI shows.
 */
(function (window) {
  const ROLES = Object.freeze({
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    CASHIER: 'CASHIER',
    STOREKEEPER: 'STOREKEEPER',
    ACCOUNTANT: 'ACCOUNTANT',
  });

  const DEFAULT_ROLE_PERMISSIONS = {
    MANAGER: [
      'categories.view', 'categories.create', 'categories.update',
      'products.view', 'products.create', 'products.update',
      'inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.transfer',
      'sales.create', 'sales.view', 'sales.cancel', 'sales.price_override',
      'refunds.view', 'refunds.create', 'refunds.approve',
      'expenses.create', 'expenses.view', 'expenses.approve',
      'employees.view',
      'reports.view', 'reports.profit',
      'payments.view', 'payments.refund',
      'customers.view', 'customers.create', 'customers.update',
      'suppliers.view', 'suppliers.create', 'suppliers.update',
      'purchases.view', 'purchases.create', 'purchases.receive', 'purchases.pay',
      'registers.manage',
      'shifts.open', 'shifts.close', 'shifts.view',
      'branches.view',
      'audit.view',
    ],
    CASHIER: [
      'categories.view',
      'products.view',
      'inventory.view',
      'sales.create', 'sales.view',
      'refunds.view', 'refunds.create',
      'payments.view',
      'customers.view', 'customers.create',
      'shifts.open', 'shifts.close', 'shifts.view',
    ],
    STOREKEEPER: [
      'categories.view', 'categories.create', 'categories.update',
      'products.view', 'products.create', 'products.update',
      'inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.transfer',
      'suppliers.view', 'suppliers.create',
      'purchases.view', 'purchases.create', 'purchases.receive',
    ],
    ACCOUNTANT: [
      'categories.view', 'products.view',
      'reports.view', 'reports.profit',
      'expenses.view', 'expenses.approve',
      'payments.view',
      'purchases.view', 'purchases.pay',
      'customers.view',
      'suppliers.view',
      'audit.view',
      'etims.view',
    ],
  };

  function can(user, permission) {
    if (!user) return false;
    if (user.role === ROLES.OWNER || user.role === ROLES.ADMIN) return true;
    if ((user.revokedPermissions || []).includes(permission)) return false;
    const defaults = DEFAULT_ROLE_PERMISSIONS[user.role] || [];
    return defaults.includes(permission) || (user.grantedPermissions || []).includes(permission);
  }

  /**
   * Hides any element with [data-requires-permission="x.y"] the current user
   * lacks, and any [data-requires-role="OWNER,ADMIN"] the user isn't in.
   * Call after rendering any chunk of HTML that might contain gated actions.
   */
  function applyPermissionGates(root, user) {
    (root || document).querySelectorAll('[data-requires-permission]').forEach((el) => {
      const perm = el.getAttribute('data-requires-permission');
      el.classList.toggle('hidden', !can(user, perm));
    });
    (root || document).querySelectorAll('[data-requires-role]').forEach((el) => {
      const roles = el.getAttribute('data-requires-role').split(',').map((r) => r.trim());
      el.classList.toggle('hidden', !user || !roles.includes(user.role));
    });
  }

  window.Permissions = { ROLES, can, applyPermissionGates };
})(window);