import { STATUSES, addApplication, findDuplicate, getApplications, getSettings, setSettings, todayISO } from '../lib/storage.js';
import { exportExcel } from '../lib/export.js';

const form = document.getElementById('form');
const saveBtn = document.getElementById('save');

document.getElementById('status').innerHTML = STATUSES.map((s) => `<option>${s}</option>`).join('');

function fill(job) {
  for (const [k, v] of Object.entries(job)) if (form.elements[k] && v) form.elements[k].value = v;
}

// Récupère les infos de l'offre dans l'onglet actif (injecte le content script si l'onglet était ouvert avant l'installation).
async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return { url: tab?.url || '' };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB' });
    } catch {
      return { url: tab.url, source: new URL(tab.url).hostname.replace(/^www\./, '') };
    }
  }
}

async function refreshCount() {
  const apps = await getApplications();
  const today = todayISO();
  const n = apps.filter((a) => a.appliedAt === today).length;
  document.getElementById('count').textContent = `${apps.length} au total · ${n} aujourd'hui`;
  return apps;
}

async function init() {
  form.elements.appliedAt.value = todayISO();
  document.getElementById('mode').value = (await getSettings()).mode;

  const [apps, job] = await Promise.all([refreshCount(), readActiveTab()]);
  fill(job || {});

  const dup = job && findDuplicate(apps, job);
  if (dup) {
    document.getElementById('dup-date').textContent = dup.appliedAt.split('-').reverse().join('/');
    document.getElementById('duplicate').hidden = false;
    saveBtn.textContent = 'Enregistrer quand même';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const allowDuplicate = !document.getElementById('duplicate').hidden;
  const res = await addApplication(data, { allowDuplicate });
  if (res.status === 'saved') {
    saveBtn.textContent = '✓ Enregistrée';
    saveBtn.classList.add('done');
    saveBtn.disabled = true;
    refreshCount();
    setTimeout(() => window.close(), 900);
  }
});

document.getElementById('open-dashboard').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
document.getElementById('export').onclick = async () => exportExcel(await getApplications());
document.getElementById('mode').onchange = (e) => setSettings({ mode: e.target.value });

init();
