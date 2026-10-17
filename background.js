import { addApplication, deleteApplication, findDuplicate, getApplications } from './lib/storage.js';

// Point d'entrée unique pour le content script (qui ne peut pas importer de modules).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ status: 'error', error: String(err?.message || err) }));
  return true; // réponse asynchrone
});

async function handle(msg) {
  switch (msg?.type) {
    case 'SAVE_APPLICATION':
      return addApplication(msg.job);
    case 'DELETE_APPLICATION':
      await deleteApplication(msg.id);
      return { status: 'deleted' };
    case 'FIND_APPLICATION':
      return { application: findDuplicate(await getApplications(), msg.job) || null };
    default:
      return { status: 'unknown' };
  }
}

// Badge : nombre de candidatures envoyées aujourd'hui.
async function refreshBadge() {
  const apps = await getApplications();
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const count = apps.filter((a) => a.appliedAt === today).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applications) refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.runtime.onInstalled.addListener(refreshBadge);
