// Content script : extrait les infos de l'offre affichée et détecte les clics sur « Postuler ».
// Il peut être injecté deux fois (manifest + injection depuis le popup), d'où la garde.
(() => {
  if (window.__jobTrackerLoaded) return;
  window.__jobTrackerLoaded = true;

  // ---------------------------------------------------------------- utilitaires
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const decode = (s) => clean(new DOMParser().parseFromString(String(s || ''), 'text/html').documentElement.textContent);
  const host = location.hostname.replace(/^www\./, '');

  function textOf(selectors) {
    for (const sel of [].concat(selectors)) {
      const el = document.querySelector(sel);
      const t = clean(el?.innerText || el?.textContent);
      if (t) return t;
    }
    return '';
  }

  const meta = (name) =>
    clean(document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content'));

  const SOURCES = [
    [/linkedin\./, 'LinkedIn'],
    [/indeed\./, 'Indeed'],
    [/welcometothejungle\./, 'Welcome to the Jungle'],
    [/hellowork\./, 'HelloWork'],
    [/francetravail\.|pole-emploi\./, 'France Travail'],
    [/apec\.fr/, 'APEC'],
    [/jobteaser\./, 'JobTeaser'],
    [/glassdoor\./, 'Glassdoor'],
    [/monster\./, 'Monster'],
    [/labonnealternance|alternance\.emploi\.gouv/, 'La bonne alternance'],
    [/walt\.community/, 'Walt'],
    [/meteojob\./, 'Meteojob'],
    [/jobijoba\./, 'Jobijoba'],
    [/cadremploi\./, 'Cadremploi'],
    [/greenhouse\.io/, 'Greenhouse'],
    [/lever\.co/, 'Lever'],
    [/myworkdayjobs\./, 'Workday'],
    [/teamtailor\./, 'Teamtailor'],
    [/smartrecruiters\./, 'SmartRecruiters'],
    [/jobs\.ashbyhq\./, 'Ashby'],
  ];
  const JOB_BOARDS = /linkedin|indeed|welcometothejungle|hellowork|francetravail|pole-emploi|apec|jobteaser|glassdoor|monster|labonnealternance|walt\.community|meteojob|jobijoba|cadremploi/;
  const sourceName = () => (SOURCES.find(([re]) => re.test(host)) || [, host])[1];

  // Type de contrat déduit d'un texte (titre, description, critères de l'offre).
  function detectContract(...texts) {
    const t = texts.filter(Boolean).join(' ').toLowerCase();
    if (/alternance|apprenti|contrat de professionnalisation|work[- ]study|apprenticeship/.test(t)) return 'Alternance';
    if (/\bstage\b|stagiaire|internship|\bintern\b/.test(t)) return 'Stage';
    if (/\bcdi\b|permanent contract/.test(t)) return 'CDI';
    if (/\bcdd\b|fixed[- ]term/.test(t)) return 'CDD';
    if (/int[ée]rim|temporary/.test(t)) return 'Intérim';
    if (/freelance|ind[ée]pendant|contractor/.test(t)) return 'Freelance';
    if (/\bv\.?i\.?e\b/.test(t)) return 'VIE';
    return '';
  }

  // ---------------------------------------------------------------- JSON-LD (schema.org JobPosting)
  const EMPLOYMENT = { FULL_TIME: 'Temps plein', PART_TIME: 'Temps partiel', CONTRACTOR: 'Freelance', TEMPORARY: 'CDD / Intérim', INTERN: 'Stage', VOLUNTEER: 'Bénévolat', PER_DIEM: 'Journalier' };
  const UNITS = { YEAR: 'an', MONTH: 'mois', WEEK: 'semaine', DAY: 'jour', HOUR: 'h' };

  function fromJsonLd() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const queue = [data];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        const type = [].concat(node['@type'] || []);
        if (type.includes('JobPosting')) return parseJobPosting(node);
        if (node['@graph']) queue.push(node['@graph']);
      }
    }
    return null;
  }

  function parseJobPosting(j) {
    const org = typeof j.hiringOrganization === 'string' ? j.hiringOrganization : j.hiringOrganization?.name;
    const locations = [].concat(j.jobLocation || []).map((l) => {
      const a = l?.address;
      if (!a) return '';
      if (typeof a === 'string') return a;
      const country = typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry;
      return a.addressLocality || a.addressRegion || country || '';
    });
    let location = [...new Set(locations.filter(Boolean).map(decode))].join(' / ');
    if (/TELECOMMUTE/i.test(j.jobLocationType || '')) location = location ? `${location} (télétravail possible)` : 'Télétravail';

    let salary = '';
    const s = j.baseSalary;
    if (s && typeof s === 'object') {
      const v = s.value && typeof s.value === 'object' ? s.value : { value: s.value };
      const amount = v.minValue && v.maxValue && v.minValue !== v.maxValue ? `${v.minValue} – ${v.maxValue}` : v.value ?? v.minValue ?? v.maxValue;
      if (amount) salary = clean(`${amount} ${s.currency || ''}${UNITS[v.unitText] ? ' / ' + UNITS[v.unitText] : ''}`);
    }

    const title = decode(j.title);
    const employment = [].concat(j.employmentType || []).map((e) => EMPLOYMENT[e] || e).join(', ');
    return {
      title,
      company: decode(org),
      location,
      salary,
      contractType: detectContract(title, employment) || detectContract(decode(j.description).slice(0, 3000)) || employment,
    };
  }

  // ---------------------------------------------------------------- microdonnées (itemprop)
  function fromMicrodata() {
    const title = textOf('[itemtype*="JobPosting"] [itemprop="title"]');
    if (!title) return null;
    return {
      title,
      company: textOf(['[itemprop="hiringOrganization"] [itemprop="name"]', '[itemprop="hiringOrganization"]']),
      location: textOf(['[itemprop="jobLocation"] [itemprop="addressLocality"]', '[itemprop="jobLocation"]']),
    };
  }

  // ---------------------------------------------------------------- sites spécifiques
  const firstSegment = (s) => clean((s || '').split('·')[0]);

  const SITES = [
    {
      test: /linkedin\./,
      extract() {
        const job = {
          title: textOf([
            '.job-details-jobs-unified-top-card__job-title h1',
            '.job-details-jobs-unified-top-card__job-title',
            '.jobs-unified-top-card__job-title',
            '.top-card-layout__title',
            '.jobs-details h1',
          ]),
          company: textOf([
            '.job-details-jobs-unified-top-card__company-name a',
            '.job-details-jobs-unified-top-card__company-name',
            '.jobs-unified-top-card__company-name',
            '.topcard__org-name-link',
          ]),
          location: firstSegment(
            textOf([
              '.job-details-jobs-unified-top-card__tertiary-description-container',
              '.job-details-jobs-unified-top-card__primary-description-container',
              '.jobs-unified-top-card__bullet',
              '.topcard__flavor--bullet',
            ])
          ),
        };
        const insights = textOf(['.job-details-preferences-and-skills', '.job-details-jobs-unified-top-card__job-insight', '.description__job-criteria-list']);
        job.contractType = detectContract(job.title, insights);
        // Repli : le titre de l'onglet est « Intitulé | Entreprise | LinkedIn » sur les pages /jobs/view/.
        if (!job.title || !job.company) {
          const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ');
          if (parts.length >= 3 && /linkedin/i.test(parts.at(-1))) {
            job.title ||= clean(parts[0]);
            job.company ||= clean(parts[1]);
          }
        }
        return job;
      },
    },
    {
      test: /indeed\./,
      extract() {
        const job = {
          title: textOf(['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1.jobsearch-JobInfoHeader-title', '.jobsearch-JobInfoHeader-title']).replace(/\s*-\s*(job post|offre d'emploi)$/i, ''),
          company: textOf(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.jobsearch-CompanyInfoContainer a']),
          location: textOf(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '#jobLocationText', '.jobsearch-JobInfoHeader-subtitle > div:last-child']),
          salary: textOf(['#salaryInfoAndJobType span', '[data-testid="jobsearch-OtherJobDetailsContainer"] span']),
        };
        job.contractType = detectContract(job.title, textOf(['#jobDetailsSection', '#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]']));
        return job;
      },
    },
    {
      test: /welcometothejungle\./,
      extract() {
        const meta = textOf(['[data-testid="job-metadata-block"]', '[data-testid="job-header-metas"]']);
        return {
          title: textOf(['[data-testid="job-metadata-block"] h2', 'h2[class*="Title"]', 'h1']),
          company: textOf(['[data-testid="job-metadata-block"] a span', '[data-testid="job-header-organization-name"]']),
          contractType: detectContract(meta),
        };
      },
    },
  ];

  // ---------------------------------------------------------------- extraction principale
  function extractJob() {
    const site = SITES.find((s) => s.test.test(host));
    const sources = [site?.extract(), fromJsonLd(), fromMicrodata()].filter(Boolean);

    // On fusionne : la première source qui fournit un champ gagne.
    const job = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) if (v && !job[k]) job[k] = v;
    }

    // Repli générique pour les sites carrière d'entreprise.
    if (!job.title) {
      job.title = textOf('h1') || meta('og:title') || clean(document.title.split(/ [|–-] /)[0]);
    }
    if (!job.company && !JOB_BOARDS.test(host)) job.company = meta('og:site_name');
    if (!job.contractType) job.contractType = detectContract(job.title);

    return {
      title: job.title || '',
      company: job.company || '',
      location: job.location || '',
      contractType: job.contractType || '',
      salary: job.salary || '',
      source: sourceName(),
      url: location.href,
    };
  }

  // ---------------------------------------------------------------- messages du popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_JOB') sendResponse(extractJob());
  });

  // ---------------------------------------------------------------- détection des candidatures
  // Ancré pour éviter les faux positifs du type « Apply filters » ou « Mes candidatures ».
  const APPLY_RE = new RegExp(
    [
      '^(postuler|je postule|candidater)\\b.*$',
      '^(envoyer|d[ée]poser|soumettre|valider|confirmer)( ma| la| votre)? candidature\\b.*$',
      '^(candidature simplifi[ée]e|easy apply|apply|apply now|apply for this (job|position)|apply on company (site|website)|submit( your)? application|send application)$',
    ].join('|'),
    'i'
  );
  const CONFIRM_RE = /(votre candidature a (bien )?été (envoyée|transmise|enregistrée)|candidature (bien )?envoyée|application (was )?sent|your application (has been|was) submitted|application submitted|merci pour votre candidature|thank you for (your application|applying))/i;

  const handled = new Set(); // évite de traiter deux fois la même offre pendant la visite

  async function getMode() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      return settings?.mode || 'auto';
    } catch {
      return 'off'; // extension rechargée : le contexte n'est plus valide
    }
  }

  async function onApplySignal() {
    const mode = await getMode();
    if (mode === 'off') return;
    const job = extractJob();
    const key = `${job.title}|${job.company}`;
    if (handled.has(key)) return;
    handled.add(key);

    const { application } = await send({ type: 'FIND_APPLICATION', job });
    if (application) return; // déjà enregistrée

    if (mode === 'auto' && job.title) {
      const res = await send({ type: 'SAVE_APPLICATION', job });
      if (res?.status === 'saved') toastSaved(res.application);
    } else {
      toastAsk(job, key);
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest?.('button, a, [role="button"], input[type="submit"], input[type="button"]');
      if (!el) return;
      const label = clean(el.innerText || el.value || el.getAttribute('aria-label') || '');
      if (label && label.length < 60 && APPLY_RE.test(label)) onApplySignal();
    },
    true
  );

  // Messages de confirmation (« Votre candidature a été envoyée ») affichés dans une modale ou une alerte.
  let pending = null;
  new MutationObserver((mutations) => {
    if (pending) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const scope = node.closest('[role="dialog"], [role="alertdialog"], [role="alert"], [role="status"], [aria-live]') || node.querySelector?.('[role="dialog"], [role="alertdialog"], [role="alert"]');
        if (!scope) continue;
        const text = (scope.innerText || '').slice(0, 1000);
        if (CONFIRM_RE.test(text)) {
          pending = setTimeout(() => (pending = null), 3000);
          onApplySignal();
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? {} : res || {}));
      } catch {
        resolve({});
      }
    });
  }

  // ---------------------------------------------------------------- bulle de notification (shadow DOM pour ne pas subir le CSS du site)
  let toastHost = null;

  function showToast(build, duration) {
    toastHost?.remove();
    toastHost = document.createElement('div');
    toastHost.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = toastHost.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .t{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#111827;color:#f9fafb;border-radius:12px;
           padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);width:320px;animation:in .2s ease-out}
        @keyframes in{from{transform:translateY(10px);opacity:0}}
        .h{font-weight:600;margin-bottom:4px}
        .j{color:#d1d5db;font-size:13px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .a{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}
        button{font:inherit;font-size:13px;border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
        .p{background:#2563eb;color:#fff}.p:hover{background:#1d4ed8}
        .s{background:transparent;color:#d1d5db}.s:hover{color:#fff;background:#374151}
      </style>
      <div class="t"></div>`;
    build(root.querySelector('.t'), () => toastHost?.remove());
    document.documentElement.appendChild(toastHost);
    if (duration) {
      const h = toastHost;
      setTimeout(() => h.remove(), duration);
    }
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const describe = (j) => esc([j.title || 'Offre sans titre', j.company].filter(Boolean).join(' — '));

  function toastSaved(app) {
    showToast((el, close) => {
      el.innerHTML = `<div class="h">✓ Candidature enregistrée</div><div class="j">${describe(app)}</div>
        <div class="a"><button class="s" data-a="undo">Annuler</button><button class="p" data-a="ok">OK</button></div>`;
      el.querySelector('[data-a="ok"]').onclick = close;
      el.querySelector('[data-a="undo"]').onclick = async () => {
        await send({ type: 'DELETE_APPLICATION', id: app.id });
        el.innerHTML = '<div class="h">Candidature retirée</div>';
        setTimeout(close, 1500);
      };
    }, 8000);
  }

  function toastAsk(job, key) {
    showToast((el, close) => {
      el.innerHTML = `<div class="h">Enregistrer cette candidature ?</div><div class="j">${describe(job)}</div>
        <div class="a"><button class="s" data-a="no">Ignorer</button><button class="p" data-a="yes">Enregistrer</button></div>`;
      el.querySelector('[data-a="no"]').onclick = () => {
        handled.delete(key);
        close();
      };
      el.querySelector('[data-a="yes"]').onclick = async () => {
        const res = await send({ type: 'SAVE_APPLICATION', job });
        el.innerHTML = `<div class="h">${res?.status === 'saved' ? '✓ Candidature enregistrée' : 'Déjà enregistrée'}</div>`;
        setTimeout(close, 1500);
      };
    }, 20000);
  }
})();
