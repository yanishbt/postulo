import { STATUSES, deleteApplication, getApplications, importApplications, todayISO, updateApplication } from '../lib/storage.js';
import { downloadBlob, exportExcel } from '../lib/export.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const frDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

let apps = [];
let sort = { key: 'appliedAt', dir: 'desc' };

$('filter-status').innerHTML += STATUSES.map((s) => `<option>${s}</option>`).join('');

function renderStats() {
  const weekAgo = new Date(Date.now() - 6 * 86400000);
  const weekISO = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  const count = (fn) => apps.filter(fn).length;
  const stats = [
    ['Candidatures', apps.length],
    ["Aujourd'hui", count((a) => a.appliedAt === todayISO())],
    ['7 derniers jours', count((a) => a.appliedAt >= weekISO)],
    ['Entretiens', count((a) => a.status === 'Entretien' || a.status === 'Test technique')],
    ['Offres reçues', count((a) => a.status === 'Offre reçue')],
    ['Refus', count((a) => a.status === 'Refusé')],
  ];
  $('stats').innerHTML = stats.map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join('');
}

function visibleApps() {
  const q = $('search').value.trim().toLowerCase();
  const status = $('filter-status').value;
  return apps
    .filter((a) => !status || a.status === status)
    .filter((a) => !q || [a.title, a.company, a.location, a.contractType, a.notes, a.source].join(' ').toLowerCase().includes(q))
    .sort((a, b) => {
      const r = String(a[sort.key] || '').localeCompare(String(b[sort.key] || ''), 'fr', { sensitivity: 'base' });
      return (sort.dir === 'asc' ? r : -r) || (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

function renderRows() {
  const list = visibleApps();
  $('empty').hidden = apps.length > 0;
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.classList.toggle('asc', th.dataset.sort === sort.key && sort.dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === sort.key && sort.dir === 'desc');
  });
  $('rows').innerHTML = list
    .map(
      (a) => `
    <tr data-id="${a.id}">
      <td class="date"><input type="date" data-field="appliedAt" value="${esc(a.appliedAt)}" title="${frDate(a.appliedAt)}" /></td>
      <td>
        <div contenteditable="plaintext-only" data-field="title" data-placeholder="Intitulé">${esc(a.title)}</div>
        ${a.url ? `<a class="sub" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source || 'Voir l\'offre')} ↗</a>` : `<span class="sub">${esc(a.source)}</span>`}
      </td>
      <td><div contenteditable="plaintext-only" data-field="company" data-placeholder="Entreprise">${esc(a.company)}</div></td>
      <td><div contenteditable="plaintext-only" data-field="location" data-placeholder="—">${esc(a.location)}</div></td>
      <td><div contenteditable="plaintext-only" data-field="contractType" data-placeholder="—">${esc(a.contractType)}</div></td>
      <td><select class="status" data-field="status" data-s="${esc(a.status)}">${STATUSES.map((s) => `<option${s === a.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="notes"><div contenteditable="plaintext-only" data-field="notes" data-placeholder="Ajouter une note">${esc(a.notes)}</div></td>
      <td><button class="icon" data-action="delete" title="Supprimer">✕</button></td>
    </tr>`
    )
    .join('');
}

async function load() {
  apps = await getApplications();
  renderStats();
  renderRows();
}

// Édition en ligne : on enregistre à la perte de focus (texte) ou au changement (date, statut).
let saving = false;
async function saveField(el) {
  const id = el.closest('tr')?.dataset.id;
  const field = el.dataset.field;
  if (!id || !field) return;
  const value = el.isContentEditable ? el.innerText.trim() : el.value;
  const current = apps.find((a) => a.id === id);
  if (!current || current[field] === value) return;
  saving = true;
  const updated = await updateApplication(id, { [field]: value });
  Object.assign(current, updated);
  saving = false;
  if (field === 'status') el.dataset.s = value;
  renderStats();
}

$('rows').addEventListener('focusout', (e) => e.target.isContentEditable && saveField(e.target));
$('rows').addEventListener('change', (e) => e.target.matches('select, input') && saveField(e.target));
$('rows').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.isContentEditable && e.target.dataset.field !== 'notes') {
    e.preventDefault();
    e.target.blur();
  }
});
$('rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete"]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  const a = apps.find((x) => x.id === id);
  if (confirm(`Supprimer la candidature « ${a?.title || ''} » chez ${a?.company || '?'} ?`)) {
    await deleteApplication(id);
    await load();
  }
});

document.querySelectorAll('th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort && sort.dir === 'desc' ? 'asc' : 'desc' };
    renderRows();
  })
);
$('search').addEventListener('input', renderRows);
$('filter-status').addEventListener('change', renderRows);

$('export').onclick = () => exportExcel(apps);
$('backup').onclick = () => downloadBlob(new Blob([JSON.stringify(apps, null, 2)], { type: 'application/json' }), `candidatures-sauvegarde-${todayISO()}.json`);
$('import').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const added = await importApplications(Array.isArray(data) ? data : data.applications || []);
    alert(`${added} candidature(s) importée(s).`);
    await load();
  } catch {
    alert('Fichier invalide : il faut une sauvegarde JSON exportée par cette extension.');
  }
  e.target.value = '';
};

// Mise à jour en direct quand une candidature est enregistrée depuis un autre onglet.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applications && !saving && !document.activeElement?.closest('#rows')) load();
});

load();
