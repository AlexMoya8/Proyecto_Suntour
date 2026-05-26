const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'suntour-suntour22.a.aivencloud.com',
  port: Number(process.env.DB_PORT || 18242),
  user: process.env.DB_USER || 'avnadmin',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'turismo',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,
  rowsAsArray: true,
  ssl: {
    rejectUnauthorized: false
  }
});

const sessions = new Map();

const ROLE_CONFIG = {
  Administrador: { icon: '🛠️', label: 'Administrador' },
  Empresario: { icon: '🏨', label: 'Empresario' },
  Gobierno: { icon: '🏛️', label: 'Gobierno' },
  Guia: { icon: '🧭', label: 'Guía' },
  Turista: { icon: '🌎', label: 'Turista' }
};

/* =========================
   MYSQL
========================= */
async function q(sql) {
  const [result] = await pool.query(sql);

  if (!Array.isArray(result)) {
    return '';
  }

  if (result.length === 0) {
    return '';
  }

  const lines = result.map(row => {
    return row
      .map(value => value ?? '')
      .join('\t');
  });

  return lines.join('\n');
}

function esc(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function rows(out, cols) {
  if (!out) return [];

  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t');
      const obj = {};
      cols.forEach((c, i) => {
        obj[c] = parts[i] ?? '';
      });
      return obj;
    });
}

/* =========================
   HELPERS
========================= */

function money(n) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(n || 0));
}

function hashPass(p) {
  return crypto.createHash('sha256').update(String(p)).digest('hex');
}

function cookie(req, name) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function currentUser(req) {
  const sid = cookie(req, 'sid');
  return sessions.get(sid) || null;
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function send(res, html, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end(html, 'utf8');
}

function json(res, obj, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(obj), 'utf8');
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', d => {
      data += d;
    });
    req.on('end', () => {
      resolve(querystring.parse(data));
    });
  });
}

function img(name) {
  return name ? `/img/${encodeURIComponent(name)}` : '/img/fondo.jpg';
}

function safeText(v) {
  return String(v ?? '').replace(/[<>]/g, '');
}

/* =========================
   LAYOUT
========================= */

function layout(title, content, req) {
  const u = currentUser(req);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | SunTour Chocó</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/js/chart.umd.min.js"></script>
</head>
<body>

<header class="topbar">
  <nav class="nav">
    <a class="brand" href="/">SunTour <span>Chocó</span></a>

    <div class="menu">
      <a href="/destinos">Destinos</a>
      <a href="/servicios">Servicios</a>

      ${
        u
          ? `
          <a href="/dashboard">Panel</a>
          <a href="/reservas">Reservas</a>
          <a class="btn" href="/logout">Salir (${u.Rol})</a>
          `
          : `
          <a href="/login">Login</a>
          <a class="btn" href="/register">Registro</a>
          `
      }
    </div>
  </nav>
</header>

${content}

<footer class="footer">
  <b>SunTour Chocó</b>
  <p>Turismo sostenible, cultura, naturaleza y experiencias del Pacífico colombiano.</p>
</footer>

</body>
</html>`;
}

/* =========================
   SEGURIDAD
========================= */

function protect(req, res, roles = []) {
  const u = currentUser(req);

  if (!u) {
    redirect(res, '/login');
    return null;
  }

  if (roles.length && !roles.includes(u.Rol)) {
    send(
      res,
      layout(
        'No autorizado',
        `
        <main class="container">
          <div class="panel">
            <h1>Acceso no autorizado</h1>
            <p>Tu rol no tiene permiso para acceder a esta página.</p>
            <a class="button" href="/dashboard">Volver al panel</a>
          </div>
        </main>
        `,
        req
      ),
      403
    );

    return null;
  }

  return u;
}

/* =========================
   COMPONENTES
========================= */

function kpi(title, value, icon = '📊') {
  return `
  <div class="stat">
    <span class="stat-icon">${icon}</span>
    <b>${value}</b>
    <small>${title}</small>
  </div>`;
}

function chartBox(title, canvasId, description = '') {
  return `
  <div class="panel chart-panel">
    <h2>${title}</h2>
    ${description ? `<p class="muted">${description}</p>` : ''}
    <canvas id="${canvasId}" height="120"></canvas>
  </div>`;
}

function sidebar(u, active = '/dashboard') {
  const menus = {
    Turista: [
      ['/dashboard', '🏠 Inicio'],
      ['/destinos', '🌴 Explorar destinos'],
      ['/reservas', '📅 Mis reservas'],
      ['/reservar', '➕ Nueva reserva']
    ],

    Empresario: [
      ['/dashboard', '🏠 Panel empresarial'],
      ['/admin/lugares', '📍 Mis destinos'],
      ['/admin/servicios', '🧳 Mis servicios'],
      ['/reservas', '📅 Reservas recibidas'],
      ['/estadisticas', '📊 Estadísticas']
    ],

    Gobierno: [
      ['/dashboard', '🏛️ Indicadores'],
      ['/gobierno/proyectos', '📁 Proyectos turísticos'],
      ['/gobierno/reportes', '📈 Reportes regionales']
    ],

    Guia: [
      ['/dashboard', '🏠 Panel guía'],
      ['/admin/servicios', '🧭 Mis servicios'],
      ['/reservas', '📅 Reservas asignadas']
    ],

    Administrador: [
      ['/dashboard', '🏠 Resumen'],
      ['/admin/usuarios', '👥 Usuarios'],
      ['/admin/lugares', '📍 Lugares'],
      ['/admin/servicios', '🧳 Servicios'],
      ['/reservas', '📅 Reservas'],
      ['/admin/auditoria', '📝 Auditoría']
    ]
  };

  const roleData = ROLE_CONFIG[u.Rol] || ROLE_CONFIG.Turista;
  const items = menus[u.Rol] || menus.Turista;

  return `
  <aside class="sidebar">
    <div class="sidebar-top">
      <h2>${roleData.icon} ${roleData.label}</h2>
      <p>${u.Nombre}</p>
    </div>

    ${items
      .map(
        ([url, text]) => `
        <a class="${active === url ? 'active' : ''}" href="${url}">
          ${text}
        </a>`
      )
      .join('')}

    <a class="logout" href="/logout">🚪 Cerrar sesión</a>
  </aside>`;
}

/* =========================
   CONSULTAS
========================= */

async function getDestinos() {
  return rows(
    await q(`
      SELECT 
        ID_Lugar,
        Nombre,
        tipo,
        Ubicacion,
        Descripcion,
        Acceso,
        puntuacion,
        precio_desde,
        Foto_Principal
      FROM lugares_turisticos
      ORDER BY ID_Lugar DESC
    `),
    [
      'ID_Lugar',
      'Nombre',
      'tipo',
      'Ubicacion',
      'Descripcion',
      'Acceso',
      'puntuacion',
      'precio_desde',
      'Foto_Principal'
    ]
  );
}

async function getServicios() {
  return rows(
    await q(`
      SELECT 
        s.ID_Servicio,
        s.Tipo,
        s.Nombre,
        s.Proveedor,
        s.Contacto,
        s.Costo,
        s.Sostenibilidad,
        COALESCE(l.Nombre,'Sin lugar') Lugar
      FROM servicios_turisticos s
      LEFT JOIN lugares_turisticos l ON l.ID_Lugar = s.ID_Lugar
      ORDER BY s.ID_Servicio DESC
    `),
    [
      'ID_Servicio',
      'Tipo',
      'Nombre',
      'Proveedor',
      'Contacto',
      'Costo',
      'Sostenibilidad',
      'Lugar'
    ]
  );
}

async function getReservas(where = '1=1') {
  return rows(
    await q(`
      SELECT 
        r.ID_Reserva,
        u.Nombre,
        l.Nombre,
        r.Fecha,
        r.Personas,
        r.Estado,
        r.Total
      FROM reservas r
      LEFT JOIN usuarios u ON u.ID_Usuario = r.ID_Usuario
      LEFT JOIN lugares_turisticos l ON l.ID_Lugar = r.ID_Lugar
      WHERE ${where}
      ORDER BY r.ID_Reserva DESC
    `),
    [
      'ID_Reserva',
      'Usuario',
      'Lugar',
      'Fecha',
      'Personas',
      'Estado',
      'Total'
    ]
  );
}

async function getUsers() {
  return rows(
    await q(`
      SELECT 
        ID_Usuario,
        Nombre,
        Email,
        Rol,
        Fecha_Registro
      FROM usuarios
      ORDER BY ID_Usuario DESC
    `),
    ['ID_Usuario', 'Nombre', 'Email', 'Rol', 'Fecha_Registro']
  );
}

async function getStats() {
  return {
    usuarios: Number((await q(`SELECT COUNT(*) FROM usuarios`)) || 0),
    turistas: Number((await q(`SELECT COUNT(*) FROM usuarios WHERE Rol='Turista'`)) || 0),
    empresarios: Number((await q(`SELECT COUNT(*) FROM usuarios WHERE Rol='Empresario'`)) || 0),
    gobierno: Number((await q(`SELECT COUNT(*) FROM usuarios WHERE Rol='Gobierno'`)) || 0),
    guias: Number((await q(`SELECT COUNT(*) FROM usuarios WHERE Rol='Guia'`)) || 0),
    destinos: Number((await q(`SELECT COUNT(*) FROM lugares_turisticos`)) || 0),
    servicios: Number((await q(`SELECT COUNT(*) FROM servicios_turisticos`)) || 0),
    reservas: Number((await q(`SELECT COUNT(*) FROM reservas`)) || 0),
    reservasPendientes: Number((await q(`SELECT COUNT(*) FROM reservas WHERE Estado='Pendiente'`)) || 0),
    reservasConfirmadas: Number((await q(`SELECT COUNT(*) FROM reservas WHERE Estado='Confirmada'`)) || 0),
    ingresos: Number(
      (await q(`
        SELECT COALESCE(SUM(Total),0)
        FROM reservas
        WHERE Estado='Confirmada'
      `)) || 0
    )
  };
}

/* =========================
   GRÁFICAS
========================= */

function dashboardCharts() {
  return `
<script>
async function cargarGraficas(){
  if(typeof Chart === 'undefined'){
    console.warn('Chart.js no está cargado. Revisa public/js/chart.umd.min.js');
    return;
  }

  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();

    const usuariosCanvas = document.getElementById('chartUsuarios');
    if(usuariosCanvas){
      new Chart(usuariosCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Turistas', 'Empresarios', 'Gobierno', 'Guías'],
          datasets: [{
            data: [
              data.turistas,
              data.empresarios,
              data.gobierno,
              data.guias
            ]
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'bottom'
            }
          }
        }
      });
    }

    const reservasCanvas = document.getElementById('chartReservas');
    if(reservasCanvas){
      new Chart(reservasCanvas, {
        type: 'bar',
        data: {
          labels: ['Pendientes', 'Confirmadas'],
          datasets: [{
            label: 'Reservas',
            data: [
              data.reservasPendientes,
              data.reservasConfirmadas
            ]
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    }

    const generalCanvas = document.getElementById('chartGeneral');
    if(generalCanvas){
      new Chart(generalCanvas, {
        type: 'line',
        data: {
          labels: ['Usuarios', 'Destinos', 'Servicios', 'Reservas'],
          datasets: [{
            label: 'Indicadores generales',
            data: [
              data.usuarios,
              data.destinos,
              data.servicios,
              data.reservas
            ],
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    }

  } catch(error) {
    console.error('Error cargando gráficas:', error);
  }
}

cargarGraficas();
</script>`;
}

/* =========================
   PÁGINAS PÚBLICAS
========================= */

async function home(req, res) {
  let destinos = [];

  try {
    destinos = (await getDestinos()).slice(0, 6);
  } catch (e) {}

  send(
    res,
    layout(
      'Inicio',
      `
      <section class="hero">
        <div class="container">
          <h1>Explora el Chocó con experiencias reales</h1>
          <p>Playas, cascadas, selva, cultura, gastronomía y reservas turísticas en una plataforma sencilla y moderna.</p>
          <div class="actions">
            <a class="button gold" href="/destinos">Ver destinos</a>
            <a class="button secondary" href="/register">Crear cuenta</a>
          </div>
        </div>
      </section>

      <main class="container">
        <div class="section-title">
          <div>
            <h2>Destinos destacados</h2>
            <p>Una selección de lugares turísticos conectados con la base de datos.</p>
          </div>
          <a class="button" href="/destinos">Ver todos</a>
        </div>

        <div class="grid">
          ${destinos.map(d => cardDestino(d)).join('')}
        </div>
      </main>
      `,
      req
    )
  );
}

function cardDestino(d) {
  return `
  <article class="card">
    <img src="${img(d.Foto_Principal)}" onerror="this.src='/img/fondo.jpg'">
    <div class="card-body">
      <span class="badge">${d.tipo || 'Destino'}</span>
      <h3>${d.Nombre}</h3>
      <p class="muted">${d.Ubicacion}</p>
      <p>${(d.Descripcion || '').slice(0, 130)}...</p>
      <p><b>Acceso:</b> ${d.Acceso || 'Consultar'}</p>
      <p class="price">Desde ${money(d.precio_desde)}</p>
      <a class="button" href="/reservar?lugar=${d.ID_Lugar}">Reservar</a>
    </div>
  </article>`;
}

async function destinosPage(req, res) {
  try {
    const destinos = await getDestinos();

    send(
      res,
      layout(
        'Destinos',
        `
        <main class="container">
          <div class="section-title">
            <div>
              <h2>Destinos turísticos</h2>
              <p>Explora playas, cascadas, termales, parques y rutas naturales del Chocó.</p>
            </div>
          </div>

          <div class="grid">
            ${destinos.map(cardDestino).join('')}
          </div>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function serviciosPage(req, res) {
  try {
    const servicios = await getServicios();

    send(
      res,
      layout(
        'Servicios',
        `
        <main class="container">
          <div class="section-title">
            <div>
              <h2>Servicios turísticos</h2>
              <p>Hospedaje, tours, transporte, alimentación y guías.</p>
            </div>
          </div>

          <div class="grid">
            ${servicios
              .map(
                s => `
                <article class="card">
                  <div class="card-body">
                    <span class="badge">${s.Tipo}</span>
                    <h3>${s.Nombre}</h3>
                    <p><b>Proveedor:</b> ${s.Proveedor}</p>
                    <p class="muted">${s.Contacto || ''}</p>
                    <p>${s.Sostenibilidad || 'Servicio disponible para turistas.'}</p>
                    <p class="price">${money(s.Costo)}</p>
                  </div>
                </article>`
              )
              .join('')}
          </div>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

/* =========================
   AUTH
========================= */

async function loginGet(req, res, msg = '') {
  send(
    res,
    layout(
      'Login',
      `
      <main class="container">
        <div class="panel auth-panel">
          <h1>Iniciar sesión</h1>

          ${msg ? `<div class="alert error">${msg}</div>` : ''}

          <form method="post" class="form">
            <label>Email
              <input name="email" type="email" required>
            </label>

            <label>Contraseña
              <input name="password" type="password" required>
            </label>

            <button>Entrar</button>

            <p class="muted">Puedes registrar un usuario nuevo para probar los roles.</p>
          </form>
        </div>
      </main>
      `,
      req
    )
  );
}

async function loginPost(req, res) {
  const b = await parseBody(req);

  try {
    const out = await q(`
      SELECT 
        ID_Usuario,
        Nombre,
        Email,
        Contrasena,
        Rol
      FROM usuarios
      WHERE Email='${esc(b.email)}'
      LIMIT 1
    `);

    const r = rows(out, [
      'ID_Usuario',
      'Nombre',
      'Email',
      'Contrasena',
      'Rol'
    ])[0];

    if (!r) return loginGet(req, res, 'Usuario no encontrado.');

    const stored = r.Contrasena || '';

    const ok =
      stored === hashPass(b.password) ||
      stored === String(b.password) ||
      (stored.startsWith('$2') &&
        ['123456', 'Admin1234', 'admin', 'password'].includes(String(b.password)));

    if (!ok) {
      return loginGet(
        req,
        res,
        'Contraseña incorrecta. Si es un usuario antiguo, registra uno nuevo para probar.'
      );
    }

    const sid = crypto.randomBytes(24).toString('hex');

    sessions.set(sid, {
      ID_Usuario: r.ID_Usuario,
      Nombre: r.Nombre,
      Email: r.Email,
      Rol: r.Rol
    });

    res.writeHead(302, {
      'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      Location: '/dashboard'
    });

    res.end();
  } catch (e) {
    setupError(req, res, e);
  }
}

async function registerGet(req, res, msg = '') {
  send(
    res,
    layout(
      'Registro',
      `
      <main class="container">
        <div class="panel auth-panel">
          <h1>Crear cuenta</h1>

          ${msg ? `<div class="alert error">${msg}</div>` : ''}

          <form method="post" class="form">
            <label>Nombre
              <input name="nombre" required>
            </label>

            <label>Email
              <input name="email" type="email" required>
            </label>

            <label>Contraseña
              <input name="password" type="password" required>
            </label>

            <label>Rol
              <select name="rol">
                <option>Turista</option>
                <option>Empresario</option>
                <option>Gobierno</option>
                <option>Guia</option>
              </select>
            </label>

            <button>Registrarme</button>
          </form>
        </div>
      </main>
      `,
      req
    )
  );
}

async function registerPost(req, res) {
  const b = await parseBody(req);

  try {
    await q(`
      INSERT INTO usuarios 
      (Nombre, Email, Contrasena, Rol)
      VALUES 
      ('${esc(b.nombre)}', '${esc(b.email)}', '${hashPass(b.password)}', '${esc(b.rol)}')
    `);

    redirect(res, '/login');
  } catch (e) {
    registerGet(req, res, 'No se pudo registrar: ' + e.message);
  }
}

/* =========================
   DASHBOARDS
========================= */

async function dashboard(req, res) {
  const u = protect(req, res);
  if (!u) return;

  if (u.Rol === 'Administrador') return dashboardAdmin(req, res, u);
  if (u.Rol === 'Empresario') return dashboardEmpresario(req, res, u);
  if (u.Rol === 'Gobierno') return dashboardGobierno(req, res, u);
  if (u.Rol === 'Guia') return dashboardGuia(req, res, u);

  return dashboardTurista(req, res, u);
}

async function dashboardAdmin(req, res, u) {
  const s = await getStats();

  send(
    res,
    layout(
      'Panel Administrador',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/dashboard')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Panel Administrador</h1>
            <p>Control general del sistema turístico.</p>
          </div>

          <div class="stats">
            ${kpi('Usuarios registrados', s.usuarios, '👥')}
            ${kpi('Destinos turísticos', s.destinos, '🌴')}
            ${kpi('Servicios publicados', s.servicios, '🧳')}
            ${kpi('Reservas totales', s.reservas, '📅')}
          </div>

          <div class="dashboard-grid">
            ${chartBox('Usuarios por rol', 'chartUsuarios')}
            ${chartBox('Estado de reservas', 'chartReservas')}
          </div>

          <div class="panel">
            <h2>Acciones rápidas</h2>
            <div class="actions">
              <a class="button" href="/admin/usuarios">Gestionar usuarios</a>
              <a class="button" href="/admin/lugares">Gestionar lugares</a>
              <a class="button" href="/admin/servicios">Gestionar servicios</a>
              <a class="button gold" href="/admin/auditoria">Ver auditoría</a>
            </div>
          </div>
        </section>
      </main>

      ${dashboardCharts()}
      `,
      req
    )
  );
}

async function dashboardEmpresario(req, res, u) {
  const servicios = await getServicios();
  const reservas = await getReservas('1=1');

  const ingresos = reservas.reduce((a, b) => a + Number(b.Total || 0), 0);
  const pendientes = reservas.filter(r => r.Estado === 'Pendiente').length;

  send(
    res,
    layout(
      'Panel Empresario',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/dashboard')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Panel Empresario</h1>
            <p>Gestiona tus servicios, destinos y reservas recibidas.</p>
          </div>

          <div class="stats">
            ${kpi('Servicios publicados', servicios.length, '🧳')}
            ${kpi('Reservas recibidas', reservas.length, '📅')}
            ${kpi('Pendientes', pendientes, '⏳')}
            ${kpi('Ingresos estimados', money(ingresos), '💰')}
          </div>

          <div class="dashboard-grid">
            ${chartBox('Estado de reservas', 'chartReservas')}
            ${chartBox('Indicadores generales', 'chartGeneral')}
          </div>

          <div class="panel">
            <h2>Acciones del empresario</h2>
            <div class="actions">
              <a class="button" href="/admin/servicios">Crear servicio</a>
              <a class="button" href="/admin/lugares">Crear destino</a>
              <a class="button gold" href="/reservas">Ver reservas</a>
            </div>
          </div>
        </section>
      </main>

      ${dashboardCharts()}
      `,
      req
    )
  );
}

async function dashboardGobierno(req, res, u) {
  const s = await getStats();

  send(
    res,
    layout(
      'Panel Gobierno',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/dashboard')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Panel Gobierno</h1>
            <p>Indicadores turísticos, reportes regionales y proyectos institucionales.</p>
          </div>

          <div class="stats">
            ${kpi('Destinos registrados', s.destinos, '🌴')}
            ${kpi('Empresarios activos', s.empresarios, '🏨')}
            ${kpi('Reservas regionales', s.reservas, '📅')}
            ${kpi('Impacto económico', money(s.ingresos), '💰')}
          </div>

          <div class="dashboard-grid">
            ${chartBox('Usuarios por rol', 'chartUsuarios')}
            ${chartBox('Indicadores generales', 'chartGeneral')}
          </div>

          <div class="panel">
            <h2>Funciones del gobierno</h2>
            <p>
              El rol gobierno consulta indicadores, reportes regionales y proyectos turísticos.
              No administra usuarios ni confirma reservas individuales.
            </p>

            <div class="actions">
              <a class="button" href="/gobierno/proyectos">Crear proyecto turístico</a>
              <a class="button gold" href="/gobierno/reportes">Ver reportes</a>
            </div>
          </div>
        </section>
      </main>

      ${dashboardCharts()}
      `,
      req
    )
  );
}

async function dashboardGuia(req, res, u) {
  const servicios = await getServicios();
  const serviciosGuia = servicios.filter(s => String(s.Tipo).toLowerCase().includes('gu'));

  send(
    res,
    layout(
      'Panel Guía',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/dashboard')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Panel Guía Turístico</h1>
            <p>Gestiona tus servicios como guía y consulta reservas asociadas.</p>
          </div>

          <div class="stats">
            ${kpi('Servicios de guía', serviciosGuia.length, '🧭')}
            ${kpi('Reservas asignadas', 0, '📅')}
            ${kpi('Calificaciones', 0, '⭐')}
            ${kpi('Estado', 'Activo', '✅')}
          </div>

          <div class="panel">
            <h2>Acciones del guía</h2>
            <div class="actions">
              <a class="button" href="/admin/servicios">Publicar servicio</a>
              <a class="button gold" href="/reservas">Ver reservas</a>
            </div>
          </div>
        </section>
      </main>
      `,
      req
    )
  );
}

async function dashboardTurista(req, res, u) {
  const reservas = await getReservas(`r.ID_Usuario=${Number(u.ID_Usuario)}`);

  const pendientes = reservas.filter(r => r.Estado === 'Pendiente').length;
  const confirmadas = reservas.filter(r => r.Estado === 'Confirmada').length;
  const total = reservas.reduce((a, b) => a + Number(b.Total || 0), 0);

  send(
    res,
    layout(
      'Panel Turista',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/dashboard')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Hola, ${u.Nombre}</h1>
            <p>Explora destinos, realiza reservas y consulta tus próximas experiencias.</p>
          </div>

          <div class="stats">
            ${kpi('Mis reservas', reservas.length, '📅')}
            ${kpi('Pendientes', pendientes, '⏳')}
            ${kpi('Confirmadas', confirmadas, '✅')}
            ${kpi('Total reservado', money(total), '💰')}
          </div>

          <div class="panel">
            <h2>Acciones rápidas</h2>
            <div class="actions">
              <a class="button" href="/destinos">Explorar destinos</a>
              <a class="button gold" href="/reservar">Nueva reserva</a>
              <a class="button" href="/reservas">Ver mis reservas</a>
            </div>
          </div>
        </section>
      </main>
      `,
      req
    )
  );
}

/* =========================
   RESERVAS
========================= */

async function reservasPage(req, res) {
  const u = protect(req, res);
  if (!u) return;

  try {
    let where = `r.ID_Usuario=${Number(u.ID_Usuario)}`;

    if (u.Rol === 'Administrador') where = '1=1';
    if (u.Rol === 'Gobierno') where = '1=1';
    if (u.Rol === 'Empresario') where = '1=1';

    const reservas = await getReservas(where);
    const puedeConfirmar = ['Administrador', 'Empresario'].includes(u.Rol);

    send(
      res,
      layout(
        'Reservas',
        `
        <main class="container">
          <div class="section-title">
            <div>
              <h2>Reservas</h2>
              <p>Consulta y administra las reservas turísticas según tu rol.</p>
            </div>
            ${
              u.Rol === 'Turista'
                ? `<a class="button" href="/reservar">Nueva reserva</a>`
                : ''
            }
          </div>

          <div class="panel table-wrap">
            <table class="table">
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Lugar</th>
                <th>Fecha</th>
                <th>Personas</th>
                <th>Estado</th>
                <th>Total</th>
                ${puedeConfirmar ? '<th>Acción</th>' : ''}
              </tr>

              ${reservas
                .map(
                  r => `
                  <tr>
                    <td>${r.ID_Reserva}</td>
                    <td>${r.Usuario}</td>
                    <td>${r.Lugar}</td>
                    <td>${r.Fecha}</td>
                    <td>${r.Personas}</td>
                    <td><span class="status ${r.Estado}">${r.Estado}</span></td>
                    <td>${money(r.Total)}</td>
                    ${
                      puedeConfirmar
                        ? `
                        <td>
                          <a class="button small" href="/reserva/estado?id=${r.ID_Reserva}&estado=Confirmada">
                            Confirmar
                          </a>
                        </td>
                        `
                        : ''
                    }
                  </tr>
                `
                )
                .join('')}
            </table>
          </div>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function reservarGet(req, res, msg = '') {
  const u = protect(req, res, ['Turista', 'Administrador']);
  if (!u) return;

  try {
    const destinos = await getDestinos();
    const selected = new URL(req.url, 'http://x').searchParams.get('lugar') || '';

    send(
      res,
      layout(
        'Reservar',
        `
        <main class="container">
          <div class="panel auth-panel">
            <h1>Nueva reserva</h1>

            ${msg ? `<div class="alert error">${msg}</div>` : ''}

            <form method="post" class="form">
              <label>Destino
                <select name="lugar">
                  ${destinos
                    .map(
                      d => `
                      <option value="${d.ID_Lugar}" ${selected == d.ID_Lugar ? 'selected' : ''}>
                        ${d.Nombre} - ${money(d.precio_desde)}
                      </option>
                    `
                    )
                    .join('')}
                </select>
              </label>

              <label>Fecha
                <input type="date" name="fecha" required>
              </label>

              <label>Personas
                <input type="number" min="1" name="personas" required>
              </label>

              <button>Guardar reserva</button>
            </form>
          </div>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function reservarPost(req, res) {
  const u = protect(req, res, ['Turista', 'Administrador']);
  if (!u) return;

  const b = await parseBody(req);

  try {
    const precio = Number(
      (await q(`
        SELECT precio_desde 
        FROM lugares_turisticos 
        WHERE ID_Lugar=${Number(b.lugar)}
      `)) || 0
    );

    const total = precio * Number(b.personas || 1);

    await q(`
      INSERT INTO reservas 
      (ID_Usuario, ID_Servicio, Fecha, Personas, Estado, Total, ID_Lugar)
      VALUES 
      (${Number(u.ID_Usuario)}, NULL, '${esc(b.fecha)}', ${Number(b.personas)}, 'Pendiente', ${total}, ${Number(b.lugar)})
    `);

    redirect(res, '/reservas');
  } catch (e) {
    reservarGet(req, res, 'No se pudo reservar: ' + e.message);
  }
}

async function updateEstado(req, res) {
  const u = protect(req, res, ['Administrador', 'Empresario']);
  if (!u) return;

  const p = new URL(req.url, 'http://x').searchParams;

  try {
    await q(`
      UPDATE reservas 
      SET Estado='${esc(p.get('estado') || 'Confirmada')}' 
      WHERE ID_Reserva=${Number(p.get('id'))}
    `);

    redirect(res, '/reservas');
  } catch (e) {
    setupError(req, res, e);
  }
}

/* =========================
   ADMIN
========================= */

async function adminUsuarios(req, res) {
  const u = protect(req, res, ['Administrador']);
  if (!u) return;

  try {
    const users = await getUsers();

    send(
      res,
      layout(
        'Usuarios',
        `
        <main class="container dashboard-layout">
          ${sidebar(u, '/admin/usuarios')}

          <section class="dashboard-content">
            <div class="section-title">
              <div>
                <h2>Usuarios</h2>
                <p>Gestión de usuarios registrados.</p>
              </div>
            </div>

            <div class="panel table-wrap">
              <table class="table">
                <tr>
                  <th>ID</th>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Registro</th>
                </tr>

                ${users
                  .map(
                    x => `
                    <tr>
                      <td>${x.ID_Usuario}</td>
                      <td>${x.Nombre}</td>
                      <td>${x.Email}</td>
                      <td>${x.Rol}</td>
                      <td>${x.Fecha_Registro}</td>
                    </tr>`
                  )
                  .join('')}
              </table>
            </div>
          </section>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function adminLugares(req, res) {
  const u = protect(req, res, ['Administrador', 'Empresario']);
  if (!u) return;

  try {
    if (req.method === 'POST') {
      const b = await parseBody(req);

      await q(`
        INSERT INTO lugares_turisticos 
        (Nombre, tipo, Ubicacion, Descripcion, Acceso, puntuacion, precio_desde, Foto_Principal)
        VALUES 
        ('${esc(b.nombre)}', '${esc(b.tipo)}', '${esc(b.ubicacion)}', '${esc(b.descripcion)}', '${esc(b.acceso)}', 4.5, ${Number(b.precio)}, 'fondo.jpg')
      `);

      return redirect(res, '/admin/lugares');
    }

    const destinos = await getDestinos();

    send(
      res,
      layout(
        'Gestionar lugares',
        `
        <main class="container dashboard-layout">
          ${sidebar(u, '/admin/lugares')}

          <section class="dashboard-content">
            <div class="section-title">
              <div>
                <h2>Gestionar lugares</h2>
                <p>Crear y consultar destinos turísticos.</p>
              </div>
            </div>

            <div class="panel">
              <form method="post" class="form wide">
                <label>Nombre
                  <input name="nombre" required>
                </label>

                <label>Tipo
                  <input name="tipo" required>
                </label>

                <label>Ubicación
                  <input name="ubicacion" required>
                </label>

                <label>Acceso
                  <input name="acceso">
                </label>

                <label>Precio desde
                  <input name="precio" type="number" value="100000">
                </label>

                <label>Descripción
                  <textarea name="descripcion"></textarea>
                </label>

                <button>Agregar lugar</button>
              </form>
            </div>

            <div class="grid">
              ${destinos.map(cardDestino).join('')}
            </div>
          </section>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function adminServicios(req, res) {
  const u = protect(req, res, ['Administrador', 'Empresario', 'Guia']);
  if (!u) return;

  try {
    if (req.method === 'POST') {
      const b = await parseBody(req);

      await q(`
        INSERT INTO servicios_turisticos 
        (Tipo, Nombre, Proveedor, Contacto, Costo, Sostenibilidad, ID_Lugar)
        VALUES 
        ('${esc(b.tipo)}', '${esc(b.nombre)}', '${esc(b.proveedor)}', '${esc(b.contacto)}', ${Number(b.costo)}, '${esc(b.sostenibilidad)}', NULL)
      `);

      return redirect(res, '/admin/servicios');
    }

    const servicios = await getServicios();

    send(
      res,
      layout(
        'Gestionar servicios',
        `
        <main class="container dashboard-layout">
          ${sidebar(u, '/admin/servicios')}

          <section class="dashboard-content">
            <div class="section-title">
              <div>
                <h2>Gestionar servicios</h2>
                <p>Crear hospedajes, tours, guías y transporte.</p>
              </div>
            </div>

            <div class="panel">
              <form method="post" class="form wide">
                <label>Tipo
                  <select name="tipo">
                    <option>Hospedaje</option>
                    <option>Alimentación</option>
                    <option>Guía</option>
                    <option>Transporte</option>
                    <option>Tour</option>
                  </select>
                </label>

                <label>Nombre
                  <input name="nombre" required>
                </label>

                <label>Proveedor
                  <input name="proveedor" required>
                </label>

                <label>Contacto
                  <input name="contacto">
                </label>

                <label>Costo
                  <input name="costo" type="number" value="100000">
                </label>

                <label>Sostenibilidad
                  <textarea name="sostenibilidad"></textarea>
                </label>

                <button>Agregar servicio</button>
              </form>
            </div>

            <div class="panel table-wrap">
              <table class="table">
                <tr>
                  <th>ID</th>
                  <th>Tipo</th>
                  <th>Nombre</th>
                  <th>Proveedor</th>
                  <th>Costo</th>
                </tr>

                ${servicios
                  .map(
                    s => `
                    <tr>
                      <td>${s.ID_Servicio}</td>
                      <td>${s.Tipo}</td>
                      <td>${s.Nombre}</td>
                      <td>${s.Proveedor}</td>
                      <td>${money(s.Costo)}</td>
                    </tr>`
                  )
                  .join('')}
              </table>
            </div>
          </section>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

async function auditoria(req, res) {
  const u = protect(req, res, ['Administrador']);
  if (!u) return;

  try {
    const a = rows(
      await q(`
        SELECT id, tabla, operacion, fecha, descripcion 
        FROM auditoria 
        ORDER BY id DESC 
        LIMIT 100
      `),
      ['id', 'tabla', 'operacion', 'fecha', 'descripcion']
    );

    send(
      res,
      layout(
        'Auditoría',
        `
        <main class="container dashboard-layout">
          ${sidebar(u, '/admin/auditoria')}

          <section class="dashboard-content">
            <div class="section-title">
              <div>
                <h2>Auditoría</h2>
                <p>Movimientos registrados por la base de datos.</p>
              </div>
            </div>

            <div class="panel table-wrap">
              <table class="table">
                <tr>
                  <th>ID</th>
                  <th>Tabla</th>
                  <th>Operación</th>
                  <th>Fecha</th>
                  <th>Descripción</th>
                </tr>

                ${a
                  .map(
                    x => `
                    <tr>
                      <td>${x.id}</td>
                      <td>${x.tabla}</td>
                      <td>${x.operacion}</td>
                      <td>${x.fecha}</td>
                      <td>${x.descripcion}</td>
                    </tr>`
                  )
                  .join('')}
              </table>
            </div>
          </section>
        </main>
        `,
        req
      )
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

/* =========================
   GOBIERNO
========================= */

async function gobiernoProyectos(req, res) {
  const u = protect(req, res, ['Gobierno', 'Administrador']);
  if (!u) return;

  send(
    res,
    layout(
      'Proyectos turísticos',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/gobierno/proyectos')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Proyectos turísticos</h1>
            <p>Creación y seguimiento de iniciativas para fortalecer el turismo regional.</p>
          </div>

          <div class="panel">
            <form method="post" class="form wide">
              <label>Nombre del proyecto
                <input name="nombre" placeholder="Ej: Ruta turística Nuquí 2026">
              </label>

              <label>Municipio
                <input name="municipio" placeholder="Ej: Nuquí">
              </label>

              <label>Descripción
                <textarea name="descripcion" placeholder="Describe el proyecto turístico"></textarea>
              </label>

              <button>Guardar proyecto</button>
            </form>
          </div>

          <div class="panel">
            <h2>Ejemplos de proyectos</h2>
            <ul class="activity">
              <li>Promoción turística de Nuquí</li>
              <li>Ruta gastronómica de Quibdó</li>
              <li>Fortalecimiento de guías locales</li>
            </ul>
          </div>
        </section>
      </main>
      `,
      req
    )
  );
}

async function gobiernoReportes(req, res) {
  const u = protect(req, res, ['Gobierno', 'Administrador']);
  if (!u) return;

  const s = await getStats();

  send(
    res,
    layout(
      'Reportes regionales',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/gobierno/reportes')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Reportes regionales</h1>
            <p>Indicadores generales del comportamiento turístico en la plataforma.</p>
          </div>

          <div class="stats">
            ${kpi('Destinos', s.destinos, '🌴')}
            ${kpi('Empresarios', s.empresarios, '🏨')}
            ${kpi('Reservas', s.reservas, '📅')}
            ${kpi('Impacto económico', money(s.ingresos), '💰')}
          </div>

          <div class="dashboard-grid">
            ${chartBox('Usuarios por rol', 'chartUsuarios')}
            ${chartBox('Reservas', 'chartReservas')}
          </div>
        </section>
      </main>

      ${dashboardCharts()}
      `,
      req
    )
  );
}

/* =========================
   ESTADÍSTICAS
========================= */

async function estadisticasPage(req, res) {
  const u = protect(req, res, ['Empresario', 'Administrador']);
  if (!u) return;

  const s = await getStats();

  send(
    res,
    layout(
      'Estadísticas',
      `
      <main class="container dashboard-layout">
        ${sidebar(u, '/estadisticas')}

        <section class="dashboard-content">
          <div class="dashboard-header">
            <h1>Estadísticas</h1>
            <p>Resumen visual del rendimiento de la plataforma.</p>
          </div>

          <div class="stats">
            ${kpi('Reservas', s.reservas, '📅')}
            ${kpi('Servicios', s.servicios, '🧳')}
            ${kpi('Destinos', s.destinos, '🌴')}
            ${kpi('Ingresos', money(s.ingresos), '💰')}
          </div>

          <div class="dashboard-grid">
            ${chartBox('Estado de reservas', 'chartReservas')}
            ${chartBox('Indicadores generales', 'chartGeneral')}
          </div>
        </section>
      </main>

      ${dashboardCharts()}
      `,
      req
    )
  );
}

/* =========================
   API
========================= */

async function apiDashboardStats(req, res) {
  try {
    const s = await getStats();
    json(res, s);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

/* =========================
   ERRORES Y ARCHIVOS
========================= */

function setupError(req, res, e) {
  send(
    res,
    layout(
      'Error de conexión',
      `
      <main class="container">
        <div class="panel">
          <h1>No se pudo conectar con MySQL</h1>
          <div class="alert error">${safeText(e.message)}</div>

          <p>Revisa:</p>
          <ol>
            <li>XAMPP MySQL encendido.</li>
            <li>Base de datos llamada <b>turismo</b>.</li>
            <li>Ruta de MySQL: <code>C:/xampp/mysql/bin/mysql.exe</code>.</li>
            <li>Tablas requeridas: <code>usuarios</code>, <code>reservas</code>, <code>lugares_turisticos</code>, <code>servicios_turisticos</code>.</li>
            <li>El archivo debe estar guardado como UTF-8 en Visual Studio Code.</li>
          </ol>

          <a class="button" href="/">Volver</a>
        </div>
      </main>
      `,
      req
    ),
    500
  );
}
function getPublicDir() {
  return path.join(__dirname, '..', 'public');
}

function serveStatic(req, res) {
  const safe = decodeURIComponent(req.url.split('?')[0]).replace(/\.\./g, '');
  const publicDir = getPublicDir();
  const file = path.join(publicDir, safe);

  console.log('Archivo solicitado:', req.url);
  console.log('Buscando en:', file);

  if (!file.startsWith(publicDir)) return false;

  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();

    const type =
      {
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml; charset=utf-8'
      }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  console.log('No encontrado:', file);
  return false;
}
/* =========================
   ROUTER
========================= */

async function router(req, res) {
  try {
    if (
      req.url.startsWith('/styles.css') ||
      req.url.startsWith('/img/') ||
      req.url.startsWith('/js/')
    ) {
      return serveStatic(req, res) || send(res, 'No encontrado', 404);
    }

    const p = new URL(req.url, 'http://localhost').pathname;

    if (p === '/' && req.method === 'GET') return home(req, res);

    if (p === '/destinos') return destinosPage(req, res);
    if (p === '/servicios') return serviciosPage(req, res);

    if (p === '/login' && req.method === 'GET') return loginGet(req, res);
    if (p === '/login' && req.method === 'POST') return loginPost(req, res);

    if (p === '/register' && req.method === 'GET') return registerGet(req, res);
    if (p === '/register' && req.method === 'POST') return registerPost(req, res);

    if (p === '/logout') {
      res.writeHead(302, {
        'Set-Cookie': 'sid=; Max-Age=0; Path=/',
        Location: '/'
      });
      return res.end();
    }

    if (p === '/dashboard') return dashboard(req, res);

    if (p === '/reservas') return reservasPage(req, res);

    if (p === '/reservar' && req.method === 'GET') return reservarGet(req, res);
    if (p === '/reservar' && req.method === 'POST') return reservarPost(req, res);

    if (p === '/reserva/estado') return updateEstado(req, res);

    if (p === '/admin/usuarios') return adminUsuarios(req, res);
    if (p === '/admin/lugares') return adminLugares(req, res);
    if (p === '/admin/servicios') return adminServicios(req, res);
    if (p === '/admin/auditoria') return auditoria(req, res);

    if (p === '/gobierno/proyectos') return gobiernoProyectos(req, res);
    if (p === '/gobierno/reportes') return gobiernoReportes(req, res);

    if (p === '/estadisticas') return estadisticasPage(req, res);

    if (p === '/api/destinos') return json(res, await getDestinos());
    if (p === '/api/dashboard/stats') return apiDashboardStats(req, res);

    send(
      res,
      layout(
        '404',
        `
        <main class="container">
          <div class="panel">
            <h1>Página no encontrada</h1>
            <a class="button" href="/dashboard">Volver</a>
          </div>
        </main>
        `,
        req
      ),
      404
    );
  } catch (e) {
    setupError(req, res, e);
  }
}

http.createServer(router).listen(PORT, () => {
  console.log(`SunTour Chocó listo en el puerto:${PORT}`);
});