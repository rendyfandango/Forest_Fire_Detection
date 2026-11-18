// ================= SUPABASE CLIENT SETUP =================
const supabaseUrl = 'https://jofxozsyfdfozfxkewux.supabase.co';
const supabaseKey = 'sb_publishable_jOt6Ytl4KK1uHobQsVOCcA_359_4Lwf';
// Menggunakan 'supabaseClient' agar tidak bentrok dengan objek global 'supabase' dari CDN
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// ================= GLOBAL STATE =================
let currentUser = null;
let historicalLogs = [];

// Menyimpan kondisi sensor ter-update secara lokal dari topic MQTT terpisah
let sensorState = {
    temperature: null,
    flame: null,
    smoke: null
};

// ================= DOM ELEMENTS =================
// Auth Containers & Forms
const authContainer = document.getElementById('auth-container');
const dashboardContainer = document.getElementById('dashboard-container');

const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');

const registerForm = document.getElementById('register-form');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');

// Toggle links
const toggleToRegister = document.getElementById('toggle-to-register');
const toggleToLogin = document.getElementById('toggle-to-login');

// Error & User displays
const authErrorDiv = document.getElementById('auth-error');
const errorMessageSpan = document.getElementById('error-message');
const userEmailSpan = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');

// Connection Badges
const badgeFlask = document.getElementById('status-flask');
const badgeMqtt = document.getElementById('status-mqtt');

// Telemetry values DOM
const valSuhu = document.getElementById('val-suhu');
const lblSuhu = document.getElementById('lbl-suhu');
const valApi = document.getElementById('val-api');
const lblApi = document.getElementById('lbl-api');
const valAsap = document.getElementById('val-asap');
const lblAsap = document.getElementById('lbl-asap');
const valSistem = document.getElementById('val-sistem');
const lblSistem = document.getElementById('lbl-sistem');

// Telemetry Card Containers DOM
const cardSuhu = document.getElementById('card-suhu');
const cardApi = document.getElementById('card-api');
const cardAsap = document.getElementById('card-asap');
const cardSistem = document.getElementById('card-sistem');

// Controls buttons
const btnBuzzerOn = document.getElementById('btn-buzzer-on');
const btnBuzzerOff = document.getElementById('btn-buzzer-off');

// Physical LED Indicator Elements
const indicatorRed = document.getElementById('indicator-led-red');
const indicatorYellow = document.getElementById('indicator-led-yellow');
const indicatorGreen = document.getElementById('indicator-led-green');

// Table and Actions
const btnRefreshHistory = document.getElementById('btn-refresh-history');
const btnDownloadCsv = document.getElementById('btn-download-csv');
const logsTableBody = document.getElementById('logs-table-body');
const iconRefresh = document.getElementById('icon-refresh');

// Toast Notification
const toastDiv = document.getElementById('toast');
const toastMessageSpan = document.getElementById('toast-message');

// ================= INIT APPLICATION =================
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    lucide.createIcons();
    
    // Check current auth status on load (this triggers handleRouting automatically)
    checkSession();
    
    // Setup Socket.IO Event Listeners
    setupSocketListeners();
    
    // Setup Action Listeners
    setupEventListeners();
});

// ================= TOAST NOTIFICATION HELPERS =================
function showToast(message, type = 'info') {
    toastMessageSpan.textContent = message;
    
    toastDiv.classList.remove('hidden');
    toastDiv.style.opacity = '1';
    toastDiv.style.transform = 'translateY(0)';
    
    setTimeout(() => {
        toastDiv.style.opacity = '0';
        toastDiv.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            toastDiv.classList.add('hidden');
        }, 300);
    }, 3000);
}

// ================= SPA ROUTING ENGINE (HTML5 HISTORY API) =================
function handleRouting() {
    const path = window.location.pathname;
    console.log('SPA Router active path:', path);
    
    if (currentUser) {
        // user sudah login
        authContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');
        
        // Sesuaikan URL jika bukan di /dashboard
        if (path !== '/dashboard') {
            history.replaceState(null, '', '/dashboard');
        }
        
        // Segarkan data tabel jika masih kosong
        if (historicalLogs.length === 0) {
            fetchHistoryLogs();
        }
    } else {
        // user belum login
        dashboardContainer.classList.add('hidden');
        authContainer.classList.remove('hidden');
        
        if (path === '/register') {
            showRegisterForm();
        } else {
            showLoginForm();
            // Sesuaikan URL ke /login jika mengakses url asing saat logout
            if (path !== '/login' && path !== '/') {
                history.replaceState(null, '', '/login');
            }
        }
    }
}

function showRegisterForm() {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    authErrorDiv.classList.add('hidden');
}

function showLoginForm() {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    authErrorDiv.classList.add('hidden');
}

// ================= AUTHENTICATION LOGIC =================
async function checkSession() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        
        if (session && session.user) {
            handleLoginSuccess(session.user);
        } else {
            handleLogoutSuccess();
        }
    } catch (err) {
        console.error('Error checking auth session:', err);
        handleLogoutSuccess();
    }
}

// Handler untuk login
async function handleLogin(e) {
    e.preventDefault();
    
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    
    // Disable button & show loading state
    const btnLogin = document.getElementById('btn-login');
    const originalText = btnLogin.innerHTML;
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<span>Memverifikasi...</span>';
    authErrorDiv.classList.add('hidden');
    
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
        showToast('Login berhasil!', 'success');
        handleLoginSuccess(data.user);
    } catch (err) {
        console.error('Login error:', err);
        errorMessageSpan.textContent = err.message || 'Email atau password salah.';
        authErrorDiv.classList.remove('hidden');
    } finally {
        btnLogin.disabled = false;
        btnLogin.innerHTML = originalText;
        lucide.createIcons();
    }
}

// Handler untuk registrasi
async function handleRegister(e) {
    e.preventDefault();
    
    const email = registerEmailInput.value.trim();
    const password = registerPasswordInput.value;
    
    if (password.length < 6) {
        errorMessageSpan.textContent = 'Kata sandi minimal harus 6 karakter.';
        authErrorDiv.classList.remove('hidden');
        return;
    }
    
    const btnRegister = document.getElementById('btn-register');
    const originalText = btnRegister.innerHTML;
    btnRegister.disabled = true;
    btnRegister.innerHTML = '<span>Mendaftarkan...</span>';
    authErrorDiv.classList.add('hidden');
    
    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
        // Cek jika akun butuh konfirmasi email atau langsung aktif
        if (data.user && data.session === null) {
            showToast('Registrasi berhasil! Silakan periksa inbox email Anda untuk konfirmasi.', 'info');
        } else {
            showToast('Registrasi berhasil! Akun Anda aktif.', 'success');
        }
        
        // Bersihkan dan arahkan ke form login
        registerEmailInput.value = '';
        registerPasswordInput.value = '';
        loginEmailInput.value = email; // Isi otomatis email ke form login
        
        history.pushState(null, '', '/login');
        handleRouting();
        
    } catch (err) {
        console.error('Registration error:', err);
        errorMessageSpan.textContent = err.message || 'Gagal mendaftarkan akun baru.';
        authErrorDiv.classList.remove('hidden');
    } finally {
        btnRegister.disabled = false;
        btnRegister.innerHTML = originalText;
        lucide.createIcons();
    }
}

function handleLoginSuccess(user) {
    currentUser = user;
    userEmailSpan.textContent = user.email;
    
    // Clear forms & errors
    loginEmailInput.value = '';
    loginPasswordInput.value = '';
    authErrorDiv.classList.add('hidden');
    
    // Jalankan routing untuk pindah ke dashboard
    handleRouting();
}

async function handleLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        
        showToast('Anda telah keluar.', 'info');
        handleLogoutSuccess();
    } catch (err) {
        console.error('Logout error:', err);
        showToast('Gagal keluar dari sesi.', 'error');
    }
}

function handleLogoutSuccess() {
    currentUser = null;
    // Jalankan routing untuk pindah ke login screen
    handleRouting();
}

// ================= SOCKET.IO CLIENT (MQTT REALTIME MONITORING) =================
let socket;

function setupSocketListeners() {
    // Hubungkan ke Flask Bridge server
    socket = io();
    
    // Log status ke server Flask
    socket.on('connect', () => {
        console.log('Connected to Flask Bridge WebSocket server');
        updateConnectionBadge(badgeFlask, 'connected', 'Terhubung');
        // Minta status MQTT saat ini ke Flask
        socket.emit('get_status');
    });
    
    socket.on('disconnect', () => {
        console.warn('Disconnected from Flask Bridge WebSocket server');
        updateConnectionBadge(badgeFlask, 'disconnected', 'Terputus');
        updateConnectionBadge(badgeMqtt, 'disconnected', 'Terputus');
    });
    
    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        updateConnectionBadge(badgeFlask, 'disconnected', 'Gagal Konek');
    });
    
    // Status koneksi MQTT broker yang dilaporkan oleh Flask
    socket.on('mqtt_status', (data) => {
        if (data.status === 'connected') {
            updateConnectionBadge(badgeMqtt, 'connected', 'Terhubung');
        } else {
            const errInfo = data.error_code ? ` (RC: ${data.error_code})` : '';
            updateConnectionBadge(badgeMqtt, 'disconnected', `Terputus${errInfo}`);
            showToast('Koneksi MQTT Broker terputus!', 'error');
        }
    });
    
    // Menerima data sensor real-time dari Flask (relayed dari MQTT serial_gateway)
    socket.on('telemetry_data', (payload) => {
        updateTelemetryUI(payload);
    });
}

function updateConnectionBadge(badgeEl, state, text) {
    badgeEl.className = 'badge'; // Reset classes
    
    if (state === 'connected') {
        badgeEl.classList.add('badge-success');
    } else if (state === 'connecting') {
        badgeEl.classList.add('badge-warning');
    } else {
        badgeEl.classList.add('badge-error');
    }
    
    badgeEl.querySelector('.badge-text').textContent = text;
}

// Pemetaan dan pembaruan visual real-time sensor
function updateTelemetryUI(data) {
    console.log('Updating UI with telemetry segment:', data);
    
    // Update local state dynamically based on what was received
    if (data.temperature !== undefined) sensorState.temperature = data.temperature;
    if (data.flame !== undefined) sensorState.flame = data.flame;
    if (data.smoke !== undefined) sensorState.smoke = data.smoke;
    
    // 1. Suhu (Temperature)
    if (sensorState.temperature !== null && !isNaN(sensorState.temperature)) {
        valSuhu.textContent = sensorState.temperature.toFixed(1);
        
        if (sensorState.temperature >= 40) {
            lblSuhu.textContent = 'Temperatur Tinggi!';
            lblSuhu.className = 'widget-status status-danger';
            cardSuhu.classList.add('state-danger');
        } else if (sensorState.temperature >= 32) {
            lblSuhu.textContent = 'Temperatur Hangat';
            lblSuhu.className = 'widget-status status-warning';
            cardSuhu.classList.remove('state-danger');
        } else {
            lblSuhu.textContent = 'Temperatur Normal';
            lblSuhu.className = 'widget-status status-safe';
            cardSuhu.classList.remove('state-danger');
        }
    }
    
    // 2. Sensor Api (Flame)
    if (sensorState.flame !== null) {
        if (sensorState.flame) {
            valApi.textContent = 'TERDETEKSI';
            valApi.className = 'widget-value-text status-danger animate-pulse';
            lblApi.textContent = 'Ada Percikan/Api!';
            lblApi.className = 'widget-status status-danger';
            cardApi.classList.add('state-danger');
        } else {
            valApi.textContent = 'AMAN';
            valApi.className = 'widget-value-text status-safe';
            lblApi.textContent = 'Kondisi Aman';
            lblApi.className = 'widget-status status-safe';
            cardApi.classList.remove('state-danger');
        }
    }

    // 3. Sensor Asap (Smoke)
    if (sensorState.smoke !== null) {
        if (sensorState.smoke) {
            valAsap.textContent = 'TERDETEKSI';
            valAsap.className = 'widget-value-text status-warning animate-pulse';
            lblAsap.textContent = 'Asap/Gas Terdeteksi!';
            lblAsap.className = 'widget-status status-warning';
            cardAsap.classList.add('state-danger');
        } else {
            valAsap.textContent = 'AMAN';
            valAsap.className = 'widget-value-text status-safe';
            lblAsap.textContent = 'Kondisi Aman';
            lblAsap.className = 'widget-status status-safe';
            cardAsap.classList.remove('state-danger');
        }
    }

    // 4. Status Sistem (Edge Decision) - Dinamis dihitung berdasarkan data sensor terakhir
    let systemStatus = 'AMAN';
    if (sensorState.flame === true || sensorState.smoke === true || sensorState.temperature >= 40) {
        systemStatus = 'BAHAYA';
    } else if (sensorState.temperature >= 32) {
        systemStatus = 'WASPADA';
    }
    
    valSistem.textContent = systemStatus;
    cardSistem.className = 'widget-card';
    
    if (systemStatus === 'BAHAYA') {
        cardSistem.classList.add('system-card-danger');
        lblSistem.textContent = 'EVAKUASI SEGERA!';
        lblSistem.className = 'system-status-subtitle status-danger';
    } else if (systemStatus === 'WASPADA') {
        cardSistem.classList.add('system-card-warning');
        lblSistem.textContent = 'Pantau Sekitar Area Sensor';
        lblSistem.className = 'system-status-subtitle status-warning';
    } else {
        cardSistem.classList.add('system-card-safe');
        lblSistem.textContent = 'Seluruh Sistem Kondisi Aman';
        lblSistem.className = 'system-status-subtitle status-safe';
    }

    // 5. Update Status Lampu LED Fisik (Sesuai Logika ESP32)
    if (indicatorRed && indicatorYellow && indicatorGreen) {
        indicatorRed.classList.remove('active-red');
        indicatorYellow.classList.remove('active-yellow');
        indicatorGreen.classList.remove('active-green');
        
        if (sensorState.flame === true) {
            indicatorRed.classList.add('active-red');
        } else if (sensorState.smoke === true || sensorState.temperature >= 40.0) {
            indicatorYellow.classList.add('active-yellow');
        } else if (sensorState.temperature !== null) {
            indicatorGreen.classList.add('active-green');
        }
    }
}

// ================= ACTUATOR CONTROL OPERATIONS (PUBLISH MQTT VIA FLASK API) =================
async function publishBuzzer(state) {
    try {
        console.log(`Sending Buzzer state: ${state}`);
        
        if (state === 'ON') {
            btnBuzzerOn.classList.add('active');
            btnBuzzerOff.classList.remove('active');
        } else {
            btnBuzzerOff.classList.add('active');
            btnBuzzerOn.classList.remove('active');
        }
        
        const response = await fetch('/api/control/buzzer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: state })
        });
        
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        
        showToast(`Buzzer berhasil diset ke ${state}`, 'success');
    } catch (err) {
        console.error('Error controlling buzzer:', err);
        showToast(`Gagal kontrol buzzer: ${err.message}`, 'error');
    }
}

// Make actuator functions global so onclick triggers successfully
window.publishBuzzer = publishBuzzer;

// ================= DATABASE HISTORICAL LOGS (SUPABASE) =================
async function fetchHistoryLogs() {
    iconRefresh.classList.add('spinning');
    
    try {
        const { data, error } = await supabaseClient
            .from('sensor_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
            
        if (error) throw error;
        
        historicalLogs = data || [];
        renderHistoryLogs(historicalLogs);
    } catch (err) {
        console.error('Error fetching logs from Supabase:', err);
        showToast('Gagal memuat log historis.', 'error');
        logsTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center status-danger">
                    Gagal mengambil data dari database: ${err.message}
                </td>
            </tr>
        `;
    } finally {
        setTimeout(() => {
            iconRefresh.classList.remove('spinning');
        }, 500);
    }
}

function renderHistoryLogs(logs) {
    if (logs.length === 0) {
        logsTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted">
                    Tidak ada data log tersimpan.
                </td>
            </tr>
        `;
        return;
    }
    
    logsTableBody.innerHTML = logs.map(log => {
        const logTime = new Date(log.created_at);
        const formattedTime = logTime.toLocaleString('id-ID', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const tempVal = log.suhu !== undefined ? log.suhu : (log.temperature !== undefined ? log.temperature : '--.-');
        
        const isFlame = (log.api === true || String(log.api).toUpperCase() === 'ON' || String(log.api).toUpperCase() === 'TERDETEKSI' || log.status_api === true || String(log.api) === '1');
        const apiLabel = isFlame ? 'TERDETEKSI' : 'AMAN';
        const apiClass = isFlame ? 'table-badge-danger' : 'table-badge-safe';
        
        const isSmoke = (log.asap === true || String(log.asap).toUpperCase() === 'ON' || String(log.asap).toUpperCase() === 'TERDETEKSI' || log.status_asap === true || String(log.asap) === '1');
        const smokeLabel = isSmoke ? 'TERDETEKSI' : 'AMAN';
        const smokeClass = isSmoke ? 'table-badge-warning' : 'table-badge-safe';
        
        const statusVal = String(log.status || log.status_sistem || log.system_status || 'AMAN').toUpperCase();
        let statusClass = 'table-badge-safe';
        if (statusVal === 'BAHAYA') statusClass = 'table-badge-danger';
        else if (statusVal === 'WASPADA') statusClass = 'table-badge-warning';

        return `
            <tr>
                <td>${formattedTime}</td>
                <td><strong>${tempVal}</strong></td>
                <td><span class="table-badge ${apiClass}">${apiLabel}</span></td>
                <td><span class="table-badge ${smokeClass}">${smokeLabel}</span></td>
                <td><span class="table-badge ${statusClass}">${statusVal}</span></td>
            </tr>
        `;
    }).join('');
}

// Convert JSON logs to CSV and trigger browser download
function downloadCSV() {
    if (historicalLogs.length === 0) {
        showToast('Tidak ada data historis untuk diunduh.', 'warning');
        return;
    }
    
    const headers = ['Waktu', 'Suhu (°C)', 'Sensor Api', 'Sensor Asap', 'Status Sistem'];
    
    const rows = historicalLogs.map(log => {
        const logTime = new Date(log.created_at).toLocaleString('id-ID');
        const temp = log.suhu !== undefined ? log.suhu : (log.temperature !== undefined ? log.temperature : '');
        
        const isFlame = (log.api === true || String(log.api).toUpperCase() === 'ON' || String(log.api).toUpperCase() === 'TERDETEKSI' || log.status_api === true || String(log.api) === '1');
        const flameText = isFlame ? 'TERDETEKSI' : 'AMAN';
        
        const isSmoke = (log.asap === true || String(log.asap).toUpperCase() === 'ON' || String(log.asap).toUpperCase() === 'TERDETEKSI' || log.status_asap === true || String(log.asap) === '1');
        const smokeText = isSmoke ? 'TERDETEKSI' : 'AMAN';
        
        const statusText = String(log.status || log.status_sistem || log.system_status || 'AMAN').toUpperCase();
        
        return [
            `"${logTime}"`,
            temp,
            `"${flameText}"`,
            `"${smokeText}"`,
            `"${statusText}"`
        ].join(',');
    });
    
    const csvContent = "\uFEFF" + [headers.join(','), ...rows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `log_kebakaran_iot_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('File CSV berhasil diunduh.', 'success');
}

// ================= EVENT LISTENERS BINDING =================
function setupEventListeners() {
    // Auth Forms submission
    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    
    // Toggle view links
    toggleToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        history.pushState(null, '', '/register');
        handleRouting();
    });
    toggleToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        history.pushState(null, '', '/login');
        handleRouting();
    });
    
    // Browser navigation (Back / Forward)
    window.addEventListener('popstate', () => {
        handleRouting();
    });
    
    // Logout Button
    btnLogout.addEventListener('click', handleLogout);
    
    // Historical actions
    btnRefreshHistory.addEventListener('click', fetchHistoryLogs);
    btnDownloadCsv.addEventListener('click', downloadCSV);
}
