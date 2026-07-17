// API Helper
let currentUser = null;
let setupCompleted = false;

const BASE_PATH = '/unterrichtsbesuch';

function getToken() {
    return localStorage.getItem('ub_jwt_token');
}

function setToken(token) {
    localStorage.setItem('ub_jwt_token', token);
}

function removeToken() {
    localStorage.removeItem('ub_jwt_token');
}

// Wrapper für API-Anfragen
async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = options.headers || {};
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    
    options.headers = headers;
    
    const response = await fetch(BASE_PATH + url, options);
    
    if (response.status === 401) {
        removeToken();
        showView('login');
        throw new Error('Nicht autorisiert oder Session abgelaufen');
    }
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Fehler: ${response.statusText}`);
    }
    
    return response.json();
}

// View-Management
function showView(viewName) {
    // Alle Views verstecken
    document.getElementById('setup-view').classList.add('hidden');
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('view-teacher').classList.add('hidden');
    document.getElementById('view-sl').classList.add('hidden');
    document.getElementById('view-admin').classList.add('hidden');
    
    // Deaktiviere alle Navbar Links
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    if (viewName === 'setup') {
        document.getElementById('setup-view').classList.remove('hidden');
    } else if (viewName === 'login') {
        document.getElementById('login-view').classList.remove('hidden');
    } else {
        document.getElementById('main-view').classList.remove('hidden');
        if (viewName === 'teacher') {
            document.getElementById('view-teacher').classList.remove('hidden');
            document.getElementById('nav-teacher-dashboard').classList.add('active');
            loadTeacherDashboard();
        } else if (viewName === 'sl') {
            document.getElementById('view-sl').classList.remove('hidden');
            document.getElementById('nav-sl-dashboard').classList.add('active');
            loadSLDashboard();
        } else if (viewName === 'admin') {
            document.getElementById('view-admin').classList.remove('hidden');
            document.getElementById('nav-admin').classList.add('active');
            loadAdminDashboard();
        }
    }
    
    // Lucide Icons neu zeichnen
    lucide.createIcons();
}

// App Initialisierung
async function initApp() {
    try {
        const statusData = await apiFetch('/api/setup-status');
        setupCompleted = statusData.is_setup_completed;
        
        if (!setupCompleted) {
            // First-Run Setup erzwingen
            // Falls bereits ein Token existiert, versuchen wir uns anzumelden, um als Admin das Setup zu machen
            const token = getToken();
            if (token) {
                try {
                    const authData = await apiFetch('/api/auth/me');
                    currentUser = authData.user;
                    setupCompleted = authData.is_setup_completed;
                    
                    if (!setupCompleted) {
                        showView('setup');
                        return;
                    }
                } catch (e) {
                    removeToken();
                }
            }
            // Wenn kein Token da ist, zeigen wir den Login an. Der erste Benutzer, der sich einloggt, wird Admin.
            showView('login');
            return;
        }

        const token = getToken();
        if (!token) {
            showView('login');
            return;
        }

        // Benutzerdaten laden
        const authData = await apiFetch('/api/auth/me');
        currentUser = authData.user;
        setupCompleted = authData.is_setup_completed;

        if (!setupCompleted) {
            showView('setup');
            return;
        }

        // UI mit Benutzerdaten anpassen
        document.getElementById('user-display-name').textContent = currentUser.display_name;
        document.getElementById('user-role-badge').textContent = translateRole(currentUser.role);
        
        // Navigation einblenden
        if (currentUser.role === 'schulleitung' || currentUser.role === 'admin') {
            document.getElementById('nav-sl-dashboard').classList.remove('hidden');
        } else {
            document.getElementById('nav-sl-dashboard').classList.add('hidden');
        }
        
        if (currentUser.role === 'admin') {
            document.getElementById('nav-admin').classList.remove('hidden');
        } else {
            document.getElementById('nav-admin').classList.add('hidden');
        }

        showView('teacher');
    } catch (err) {
        console.error('Initialisierungsfehler:', err);
        showView('login');
    }
}

function translateRole(role) {
    switch (role) {
        case 'admin': return 'Administrator';
        case 'schulleitung': return 'Schulleitung';
        default: return 'Lehrkraft';
    }
}

// ----------------------------------------------------
// AUTH & SETTINGS EVENTS
// ----------------------------------------------------

// Login Formular
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('jwt-token').value.trim();
    if (!token) return;
    
    setToken(token);
    document.getElementById('jwt-token').value = '';
    
    // Versuchen, die App mit dem neuen Token zu initialisieren
    await initApp();
});

// Setup Formular
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settingsData = {
        smtp_host: document.getElementById('setup-smtp-host').value,
        smtp_port: document.getElementById('setup-smtp-port').value,
        smtp_user: document.getElementById('setup-smtp-user').value,
        smtp_pass: document.getElementById('setup-smtp-pass').value,
        smtp_from: document.getElementById('setup-smtp-from').value,
        jwt_claim_username: document.getElementById('setup-jwt-username').value,
        jwt_claim_name: document.getElementById('setup-jwt-name').value,
        jwt_claim_email: document.getElementById('setup-jwt-email').value,
        jwt_secret: document.getElementById('setup-jwt-secret').value
    };

    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: settingsData
        });
        alert('Setup erfolgreich abgeschlossen! Das System wird neu geladen.');
        window.location.reload();
    } catch (err) {
        alert('Setup fehlgeschlagen: ' + err.message);
    }
});

// Admin Settings Formular
document.getElementById('admin-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settingsData = {
        smtp_host: document.getElementById('admin-smtp-host').value,
        smtp_port: document.getElementById('admin-smtp-port').value,
        smtp_user: document.getElementById('admin-smtp-user').value,
        smtp_pass: document.getElementById('admin-smtp-pass').value,
        smtp_from: document.getElementById('admin-smtp-from').value,
        jwt_claim_username: document.getElementById('admin-jwt-username').value,
        jwt_claim_name: document.getElementById('admin-jwt-name').value,
        jwt_claim_email: document.getElementById('admin-jwt-email').value,
        jwt_secret: document.getElementById('admin-jwt-secret').value
    };

    try {
        await apiFetch('/api/settings', {
            method: 'POST',
            body: settingsData
        });
        alert('Einstellungen erfolgreich aktualisiert!');
        loadAdminDashboard();
    } catch (err) {
        alert('Fehler beim Speichern der Einstellungen: ' + err.message);
    }
});

// Logout Button
document.getElementById('logout-btn').addEventListener('click', () => {
    removeToken();
    currentUser = null;
    document.getElementById('nav-sl-dashboard').classList.add('hidden');
    document.getElementById('nav-admin').classList.add('hidden');
    showView('login');
});

// Navigation Links
document.getElementById('nav-teacher-dashboard').addEventListener('click', () => showView('teacher'));
document.getElementById('nav-sl-dashboard').addEventListener('click', () => showView('sl'));
document.getElementById('nav-admin').addEventListener('click', () => showView('admin'));

// ----------------------------------------------------
// LEHRKRAFT DASHBOARD (TEACHER VIEW)
// ----------------------------------------------------
let allMyUbs = [];
let teacherActiveTab = 'active'; // 'active' oder 'archived'

document.getElementById('tab-active-ub').addEventListener('click', () => {
    teacherActiveTab = 'active';
    document.getElementById('tab-active-ub').classList.add('active');
    document.getElementById('tab-archived-ub').classList.remove('active');
    renderTeacherUbs();
});

document.getElementById('tab-archived-ub').addEventListener('click', () => {
    teacherActiveTab = 'archived';
    document.getElementById('tab-archived-ub').classList.add('active');
    document.getElementById('tab-active-ub').classList.remove('active');
    renderTeacherUbs();
});

async function loadTeacherDashboard() {
    try {
        allMyUbs = await apiFetch('/api/unterrichtsbesuche');
        renderTeacherUbs();
    } catch (err) {
        console.error('Fehler beim Laden des Dashboards:', err);
    }
}

function renderTeacherUbs() {
    const container = document.getElementById('ub-list-container');
    container.innerHTML = '';

    const now = new Date();
    
    const filteredUbs = allMyUbs.filter(ub => {
        const ubDate = new Date(ub.date_time);
        const isPast = ubDate < now;
        
        if (teacherActiveTab === 'active') {
            return !isPast && ub.status !== 'archived';
        } else {
            return isPast || ub.status === 'archived';
        }
    });

    if (filteredUbs.length === 0) {
        container.innerHTML = `
            <div class="glass-card" style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-secondary);">
                <i data-lucide="info" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--primary);"></i>
                <p>Keine Unterrichtsbesuche in dieser Kategorie gefunden.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    filteredUbs.forEach(ub => {
        const card = document.createElement('div');
        card.className = 'glass-card ub-card';

        const ubDate = new Date(ub.date_time);
        const dateFormatted = ubDate.toLocaleString('de-DE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Status Deutsch übersetzen
        let statusText = 'Entwurf';
        let statusClass = 'status-draft';
        if (ub.status === 'submitted') {
            statusText = 'Eingereicht';
            statusClass = 'status-submitted';
        } else if (ub.status === 'archived') {
            statusText = 'Archiviert';
            statusClass = 'status-archived';
        }

        const isPast = ubDate < now;
        const isEditable = ub.status === 'draft' && !isPast;

        let actionButtons = '';
        if (isEditable) {
            actionButtons += `
                <button class="btn btn-secondary btn-icon" onclick="openEditUbModal(${ub.id})" title="Bearbeiten">
                    <i data-lucide="edit"></i>
                </button>
                <button class="btn btn-primary" onclick="submitUb(${ub.id})">
                    <i data-lucide="send"></i> Einreichen
                </button>
            `;
        }
        
        // PDF-Upload ist immer möglich, solange nicht archiviert oder vergangen, auch nach Einreichung.
        if (ub.status !== 'archived' && !isPast) {
            actionButtons += `
                <button class="btn btn-secondary btn-icon" onclick="openUploadModal(${ub.id})" title="Entwurf hochladen (PDF)">
                    <i data-lucide="upload-cloud"></i> ${ub.file_path ? 'Entwurf ersetzen' : 'PDF hochladen'}
                </button>
            `;
        }

        card.innerHTML = `
            <div class="ub-card-header">
                <div>
                    <span class="status-indicator ${statusClass}">${statusText}</span>
                </div>
                <div class="ub-meta-item">
                    <i data-lucide="calendar"></i>
                    <span>${dateFormatted}</span>
                </div>
            </div>
            <div>
                <h3>${ub.subject} (${ub.grade})</h3>
                <p class="subtitle" style="margin-bottom: 12px;">${ub.type}</p>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="ub-meta-item">
                        <i data-lucide="map-pin"></i>
                        <span>Raum: ${ub.room}</span>
                    </div>
                    ${ub.instructor ? `
                    <div class="ub-meta-item">
                        <i data-lucide="user"></i>
                        <span>Fachleiter: ${ub.instructor}</span>
                    </div>` : ''}
                    ${ub.module ? `
                    <div class="ub-meta-item">
                        <i data-lucide="book-open"></i>
                        <span>Modul: ${ub.module}</span>
                    </div>` : ''}
                    <div class="ub-meta-item">
                        <i data-lucide="shield-check"></i>
                        <span>Begleitung: ${ub.assigned_sl_name || 'Noch ausstehend'}</span>
                    </div>
                    ${ub.file_path ? `
                    <div class="ub-meta-item">
                        <i data-lucide="file-text" style="color: var(--success);"></i>
                        <a href="${BASE_PATH}/${ub.file_path}" target="_blank" style="color: var(--success); font-weight: 600; text-decoration: none;">PDF Entwurf öffnen</a>
                    </div>` : `
                    <div class="ub-meta-item">
                        <i data-lucide="file-warning" style="color: var(--warning);"></i>
                        <span style="color: var(--warning);">Kein Entwurf hochgeladen</span>
                    </div>`}
                </div>
            </div>
            
            ${actionButtons ? `<div class="ub-card-footer">${actionButtons}</div>` : ''}
        `;

        container.appendChild(card);
    });

    lucide.createIcons();
}

// ----------------------------------------------------
// UB EDIT / CREATION MODAL
// ----------------------------------------------------
const ubModal = document.getElementById('ub-modal');

document.getElementById('btn-new-ub').addEventListener('click', () => {
    document.getElementById('ub-form').reset();
    document.getElementById('ub-id').value = '';
    document.getElementById('modal-title').textContent = 'Neuen Unterrichtsbesuch anlegen';
    ubModal.classList.remove('hidden');
});

document.getElementById('btn-close-modal').addEventListener('click', () => ubModal.classList.add('hidden'));
document.getElementById('btn-cancel-modal').addEventListener('click', () => ubModal.classList.add('hidden'));

async function openEditUbModal(id) {
    const ub = allMyUbs.find(item => item.id === id);
    if (!ub) return;

    document.getElementById('ub-id').value = ub.id;
    document.getElementById('ub-date').value = ub.date_time.slice(0, 16); // Schneidet Sekunden/Zonen ab
    document.getElementById('ub-room').value = ub.room;
    document.getElementById('ub-subject').value = ub.subject;
    document.getElementById('ub-grade').value = ub.grade;
    document.getElementById('ub-type').value = ub.type;
    document.getElementById('ub-instructor').value = ub.instructor || '';
    document.getElementById('ub-module').value = ub.module || '';

    document.getElementById('modal-title').textContent = 'Unterrichtsbesuch bearbeiten';
    ubModal.classList.remove('hidden');
}

document.getElementById('ub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('ub-id').value;
    
    const ubData = {
        date_time: document.getElementById('ub-date').value,
        room: document.getElementById('ub-room').value,
        subject: document.getElementById('ub-subject').value,
        grade: document.getElementById('ub-grade').value,
        type: document.getElementById('ub-type').value,
        instructor: document.getElementById('ub-instructor').value,
        module: document.getElementById('ub-module').value
    };

    try {
        if (id) {
            await apiFetch(`/api/unterrichtsbesuche/${id}`, {
                method: 'PUT',
                body: ubData
            });
        } else {
            await apiFetch('/api/unterrichtsbesuche', {
                method: 'POST',
                body: ubData
            });
        }
        ubModal.classList.add('hidden');
        loadTeacherDashboard();
    } catch (err) {
        alert('Fehler beim Speichern: ' + err.message);
    }
});

async function submitUb(id) {
    if (!confirm('Möchten Sie diesen Unterrichtsbesuch einreichen? Änderungen an den Formulardaten sind danach nicht mehr möglich.')) return;
    try {
        await apiFetch(`/api/unterrichtsbesuche/${id}`, {
            method: 'PUT',
            body: { status: 'submitted' }
        });
        loadTeacherDashboard();
    } catch (err) {
        alert('Fehler beim Einreichen: ' + err.message);
    }
}

// ----------------------------------------------------
// FILE UPLOAD MODAL
// ----------------------------------------------------
const uploadModal = document.getElementById('upload-modal');

function openUploadModal(ubId) {
    document.getElementById('upload-ub-id').value = ubId;
    document.getElementById('upload-file').value = '';
    document.querySelector('.file-msg').textContent = 'Datei auswählen oder hierher ziehen';
    uploadModal.classList.remove('hidden');
}

document.getElementById('btn-close-upload-modal').addEventListener('click', () => uploadModal.classList.add('hidden'));
document.getElementById('btn-cancel-upload-modal').addEventListener('click', () => uploadModal.classList.add('hidden'));

document.getElementById('upload-file').addEventListener('change', (e) => {
    const filename = e.target.files[0]?.name;
    if (filename) {
        document.querySelector('.file-msg').textContent = filename;
    }
});

document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ubId = document.getElementById('upload-ub-id').value;
    const fileInput = document.getElementById('upload-file');
    
    if (!fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('entwurf', fileInput.files[0]);

    try {
        const token = getToken();
        const res = await fetch(`${BASE_PATH}/api/unterrichtsbesuche/${ubId}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Fehler beim Upload');
        }

        alert('PDF-Entwurf erfolgreich hochgeladen!');
        uploadModal.classList.add('hidden');
        loadTeacherDashboard();
    } catch (err) {
        alert('Upload fehlgeschlagen: ' + err.message);
    }
});

// ----------------------------------------------------
// SCHULLEITUNG DASHBOARD
// ----------------------------------------------------
let allSchoolUbs = [];
let slMembers = [];

async function loadSLDashboard() {
    try {
        allSchoolUbs = await apiFetch('/api/unterrichtsbesuche');
        slMembers = await apiFetch('/api/schulleitung-users');
        renderSLDashboard();
    } catch (err) {
        console.error('Fehler beim Laden des SL-Dashboards:', err);
    }
}

function renderSLDashboard() {
    const tbody = document.getElementById('sl-table-body');
    tbody.innerHTML = '';

    // Wir filtern UBs heraus, die noch im Entwurfsstatus (draft) sind. Die Schulleitung sieht nur eingereichte (submitted) und archivierte.
    const visibleUbs = allSchoolUbs.filter(ub => ub.status !== 'draft');

    if (visibleUbs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 40px;">
                    <i data-lucide="inbox" style="width: 48px; height: 48px; margin-bottom: 12px; display: inline-block;"></i>
                    <p>Momentan liegen keine eingereichten Unterrichtsbesuche vor.</p>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    visibleUbs.forEach(ub => {
        const tr = document.createElement('tr');
        
        const dateFormatted = new Date(ub.date_time).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Entwurfs-Link
        let pdfLink = '<span class="text-muted">Kein Entwurf</span>';
        if (ub.file_path) {
            pdfLink = `<a href="${BASE_PATH}/${ub.file_path}" target="_blank" class="btn btn-secondary btn-icon" title="PDF Entwurf öffnen">
                <i data-lucide="file-text"></i> PDF
            </a>`;
        }

        // Begleitungs-Dropdown
        let slDropdown = `<select onchange="assignSL(${ub.id}, this.value)" style="width: 100%;">
            <option value="">-- Nicht zugeordnet --</option>`;
        
        slMembers.forEach(sl => {
            const selected = ub.assigned_schulleitung_id === sl.id ? 'selected' : '';
            slDropdown += `<option value="${sl.id}" ${selected}>${sl.display_name}</option>`;
        });
        slDropdown += `</select>`;

        // Selbst übernehmen Button
        const isAssignedToMe = ub.assigned_schulleitung_id === currentUser.id;
        const takeButton = isAssignedToMe ? 
            `<button class="btn btn-secondary btn-icon" title="Zuordnung aufheben" onclick="assignSL(${ub.id}, '')">
                <i data-lucide="user-minus"></i> Freigeben
             </button>` :
            `<button class="btn btn-primary" onclick="assignSL(${ub.id}, '${currentUser.id}')">
                <i data-lucide="user-plus"></i> Übernehmen
             </button>`;

        tr.innerHTML = `
            <td><strong>${ub.user_name || 'Unbekannt'}</strong><br><small>${ub.user_email || ''}</small></td>
            <td>${dateFormatted}</td>
            <td><strong>${ub.subject}</strong><br><small>Klasse ${ub.grade}</small></td>
            <td>${ub.room}</td>
            <td>${ub.type}</td>
            <td>${ub.instructor || 'n.a.'}<br><small>${ub.module || ''}</small></td>
            <td>${pdfLink}</td>
            <td>${slDropdown}</td>
            <td>${takeButton}</td>
        `;

        tbody.appendChild(tr);
    });

    lucide.createIcons();
}

async function assignSL(ubId, slId) {
    try {
        await apiFetch(`/api/unterrichtsbesuche/${ubId}`, {
            method: 'PUT',
            body: { assigned_schulleitung_id: slId || null }
        });
        loadSLDashboard();
    } catch (err) {
        alert('Fehler bei der Zuweisung: ' + err.message);
    }
}

// ----------------------------------------------------
// ADMIN DASHBOARD
// ----------------------------------------------------
async function loadAdminDashboard() {
    try {
        // Einstellungsdaten laden
        const settings = await apiFetch('/api/settings');
        document.getElementById('admin-smtp-host').value = settings.smtp_host || '';
        document.getElementById('admin-smtp-port').value = settings.smtp_port || '';
        document.getElementById('admin-smtp-user').value = settings.smtp_user || '';
        document.getElementById('admin-smtp-pass').value = settings.smtp_pass || '';
        document.getElementById('admin-smtp-from').value = settings.smtp_from || '';
        document.getElementById('admin-jwt-username').value = settings.jwt_claim_username || 'username';
        document.getElementById('admin-jwt-name').value = settings.jwt_claim_name || 'name';
        document.getElementById('admin-jwt-email').value = settings.jwt_claim_email || 'email';
        document.getElementById('admin-jwt-secret').value = ''; // Secret wird nicht angezeigt

        // Benutzerliste laden
        const users = await apiFetch('/api/users');
        renderAdminUsers(users);
    } catch (err) {
        console.error('Fehler beim Laden des Admin-Dashboards:', err);
    }
}

function renderAdminUsers(users) {
    const tbody = document.getElementById('admin-users-table-body');
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        
        let roleDropdown = `<select onchange="changeUserRole('${u.id}', this.value)" ${u.id === currentUser.id ? 'disabled' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Lehrkraft</option>
            <option value="schulleitung" ${u.role === 'schulleitung' ? 'selected' : ''}>Schulleitung</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
        </select>`;

        tr.innerHTML = `
            <td><strong>${u.username}</strong></td>
            <td>${u.display_name || ''}<br><small>${u.email || ''}</small></td>
            <td>${roleDropdown}</td>
        `;
        tbody.appendChild(tr);
    });

    lucide.createIcons();
}

async function changeUserRole(userId, newRole) {
    try {
        await apiFetch(`/api/users/${userId}/role`, {
            method: 'PUT',
            body: { role: newRole }
        });
        loadAdminDashboard();
    } catch (err) {
        alert('Rollenänderung fehlgeschlagen: ' + err.message);
    }
}

// Global registrieren für inline Event Handler
window.openEditUbModal = openEditUbModal;
window.submitUb = submitUb;
window.openUploadModal = openUploadModal;
window.assignSL = assignSL;
window.changeUserRole = changeUserRole;

// Start
initApp();
