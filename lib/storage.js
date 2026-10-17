// Stockage des candidatures dans chrome.storage.local (partagé entre popup, tableau de bord et service worker).

export const STATUSES = ['Postulé', 'Relancé', 'Entretien', 'Test technique', 'Offre reçue', 'Refusé', 'Abandonné'];

export const DEFAULT_SETTINGS = {
  // 'auto' : enregistre dès qu'un clic sur « Postuler » est détecté (avec possibilité d'annuler)
  // 'ask'  : affiche une bulle qui demande confirmation
  // 'off'  : détection désactivée, enregistrement manuel via le popup uniquement
  mode: 'auto',
};

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getApplications() {
  const { applications = [] } = await chrome.storage.local.get('applications');
  return applications;
}

async function setApplications(applications) {
  await chrome.storage.local.set({ applications });
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function setSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

// Ramène une URL d'offre à une forme stable pour détecter les doublons
// (LinkedIn et Indeed affichent la même offre sous plusieurs URL).
export function canonicalUrl(raw) {
  if (!raw) return '';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host.endsWith('linkedin.com')) {
    const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1];
    if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  if (host.includes('indeed.')) {
    const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
    if (jk) return `${u.origin}/viewjob?jk=${jk}`;
  }
  // On retire les paramètres de tracking, on garde les identifiants éventuels (gh_jid, id, ...).
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|ref|refId|trk|trackingId|source|from|origin|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function findDuplicate(applications, job) {
  const url = canonicalUrl(job.url);
  return applications.find((a) => {
    if (url && a.url && canonicalUrl(a.url) === url) return true;
    return job.title && job.company && norm(a.title) === norm(job.title) && norm(a.company) === norm(job.company);
  });
}

const FIELDS = ['title', 'company', 'location', 'contractType', 'salary', 'source', 'url', 'appliedAt', 'status', 'notes'];

function pick(data) {
  const out = {};
  for (const f of FIELDS) if (data[f] !== undefined) out[f] = typeof data[f] === 'string' ? data[f].trim() : data[f];
  return out;
}

export async function addApplication(job, { allowDuplicate = false } = {}) {
  const applications = await getApplications();
  const existing = findDuplicate(applications, job);
  if (existing && !allowDuplicate) return { status: 'duplicate', application: existing };

  const application = {
    id: crypto.randomUUID(),
    title: '',
    company: '',
    location: '',
    contractType: '',
    salary: '',
    source: '',
    url: '',
    notes: '',
    status: 'Postulé',
    appliedAt: todayISO(),
    ...pick(job),
    url: canonicalUrl(job.url),
    createdAt: new Date().toISOString(),
  };
  applications.push(application);
  await setApplications(applications);
  return { status: 'saved', application };
}

export async function updateApplication(id, patch) {
  const applications = await getApplications();
  const i = applications.findIndex((a) => a.id === id);
  if (i === -1) return null;
  applications[i] = { ...applications[i], ...pick(patch), updatedAt: new Date().toISOString() };
  await setApplications(applications);
  return applications[i];
}

export async function deleteApplication(id) {
  const applications = await getApplications();
  await setApplications(applications.filter((a) => a.id !== id));
}

// Import d'une sauvegarde JSON : fusionne sans créer de doublons.
export async function importApplications(list) {
  const applications = await getApplications();
  let added = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object' || (!item.title && !item.company)) continue;
    if (findDuplicate(applications, item)) continue;
    applications.push({ status: 'Postulé', appliedAt: todayISO(), ...pick(item), id: crypto.randomUUID(), createdAt: item.createdAt || new Date().toISOString() });
    added++;
  }
  await setApplications(applications);
  return added;
}
