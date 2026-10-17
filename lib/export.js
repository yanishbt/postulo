import { buildXlsx, STYLE } from './xlsx.js';
import { todayISO } from './storage.js';

const COLUMNS = [
  { header: 'Date de candidature', width: 14 },
  { header: 'Intitulé du poste', width: 40, style: STYLE.wrap },
  { header: 'Entreprise', width: 24 },
  { header: 'Localisation', width: 22 },
  { header: 'Type de contrat', width: 15 },
  { header: 'Salaire', width: 18 },
  { header: 'Statut', width: 14 },
  { header: 'Jours écoulés', width: 10, style: STYLE.number },
  { header: 'Source', width: 18 },
  { header: "Lien de l'offre", width: 16 },
  { header: 'Notes', width: 40, style: STYLE.wrap },
];

export function applicationsToXlsx(applications) {
  const sorted = [...applications].sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const rows = sorted.map((a, i) => [
    a.appliedAt ? { date: a.appliedAt } : '',
    a.title,
    a.company,
    a.location,
    a.contractType,
    a.salary,
    a.status,
    a.appliedAt ? { formula: `IF(A${i + 2}="","",TODAY()-A${i + 2})` } : '',
    a.source,
    a.url ? { link: a.url, text: "Voir l'offre" } : '',
    a.notes,
  ]);
  return buildXlsx({ sheetName: 'Candidatures', columns: COLUMNS, rows });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportExcel(applications) {
  downloadBlob(applicationsToXlsx(applications), `candidatures-${todayISO()}.xlsx`);
}
