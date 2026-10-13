// An engineer can open a client account to see that portal.
// The preview is read-only: it never books, pays, invites, or signs off.

function canPreview(user) {
  return !!(user && user.isAdmin);
}

function previewAccess(user, method, asId) {
  const id = typeof asId === 'string' ? asId.trim() : '';
  if (!id) return { id: '', preview: false };
  if (!canPreview(user)) {
    const err = new Error('Only the engineer can open another account.');
    err.status = 403;
    throw err;
  }
  if (String(method || 'GET').toUpperCase() !== 'GET') {
    const err = new Error('Client preview is read-only.');
    err.status = 403;
    throw err;
  }
  return { id: id, preview: true };
}

module.exports = { canPreview, previewAccess };
