#!/usr/bin/env node
/**
 * @fileoverview Pruebas de integración de SaludYa — ejecutables desde terminal.
 *
 * Verifica el flujo completo de la aplicación: almacenamiento, CRUD de citas,
 * filtros por médico, gestión de agenda y la integración paciente → médico.
 *
 * No requiere dependencias externas; simula `localStorage` y `sessionStorage`
 * mediante objetos planos para poder correr en Node.js sin DOM.
 *
 * @module tests/run
 * @author SaludYa
 * @version 1.0.0
 *
 * @example
 * // Ejecutar desde la raíz del proyecto:
 * node tests/run.js
 */
'use strict';

/* ─────────────────────────────────────────────────────────
   Códigos ANSI para color en terminal
───────────────────────────────────────────────────────── */

/**
 * Paleta de códigos de escape ANSI para dar color a la salida en terminal.
 * @type {{ reset: string, bold: string, dim: string, green: string, red: string, yellow: string, cyan: string, gray: string }}
 */
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

/* ─────────────────────────────────────────────────────────
   Typedefs
───────────────────────────────────────────────────────── */

/**
 * Representa una cita médica en el sistema.
 * @typedef {Object} Cita
 * @property {string} id            - Identificador único (ej. `"cita_1719000000abc"`).
 * @property {string} paciente      - Nombre completo del paciente.
 * @property {string} medico        - Nombre completo del médico.
 * @property {string} especialidad  - Especialidad médica (ej. `"Medicina General"`).
 * @property {string} fecha         - Fecha en formato `YYYY-MM-DD`.
 * @property {string} hora          - Hora en formato `HH:mm`.
 * @property {'pendiente'|'confirmada'|'cancelada'|'rechazada'} estado - Estado actual de la cita.
 * @property {string} motivo        - Motivo de la consulta (puede ser cadena vacía).
 */

/**
 * Representa una franja horaria de disponibilidad en la agenda del médico.
 * @typedef {Object} SlotAgenda
 * @property {string} id         - Identificador único del slot.
 * @property {string} medico     - Nombre completo del médico propietario.
 * @property {string} fecha      - Fecha en formato `YYYY-MM-DD`.
 * @property {string} horaInicio - Hora de inicio en formato `HH:mm`.
 * @property {string} horaFin   - Hora de fin en formato `HH:mm`.
 */

/**
 * Resultado de un caso de test individual.
 * @typedef {Object} TestResult
 * @property {string}  nombre - Descripción del comportamiento probado.
 * @property {boolean} ok     - `true` si el test pasó, `false` si falló.
 * @property {string}  [error] - Mensaje del error lanzado (solo cuando `ok === false`).
 */

/**
 * Agrupación de tests bajo un nombre común.
 * @typedef {Object} Suite
 * @property {string}       nombre - Nombre descriptivo de la suite.
 * @property {TestResult[]} tests  - Lista de resultados de los tests en esta suite.
 */

/**
 * Objeto que implementa la API mínima de Web Storage.
 * @typedef {Object} StorageLike
 * @property {function(string): (string|null)} getItem    - Lee el valor de una clave.
 * @property {function(string, string): void}  setItem    - Escribe un valor.
 * @property {function(string): void}          removeItem - Elimina una clave.
 * @property {function(): void}                clear      - Vacía todo el storage.
 */

/**
 * Objeto de aserciones retornado por {@link expect}.
 * @typedef {Object} Matcher
 * @property {function(*): void}      toBe           - Igualdad estricta (`===`).
 * @property {function(): void}       toBeTruthy     - El valor es truthy.
 * @property {function(): void}       toBeFalsy      - El valor es falsy.
 * @property {function(number): void} toBeGreaterThan - El valor numérico es mayor que `n`.
 * @property {function(string): void} toHaveProperty  - El objeto tiene la propiedad indicada.
 */

/* ─────────────────────────────────────────────────────────
   Simulación de Web Storage para Node.js
───────────────────────────────────────────────────────── */

/**
 * Crea un objeto que simula la API `Web Storage` (`localStorage` / `sessionStorage`)
 * para entornos Node.js donde el DOM no está disponible.
 *
 * Almacena los valores como strings (igual que el navegador) dentro
 * de un objeto con prototype `null` para evitar colisiones con propiedades heredadas.
 *
 * @returns {StorageLike} Instancia de storage en memoria.
 *
 * @example
 * const ls = crearStorage();
 * ls.setItem('clave', 'valor');
 * ls.getItem('clave'); // → 'valor'
 * ls.getItem('otra');  // → null
 */
function crearStorage() {
  const store = Object.create(null);
  return {
    getItem:    k      => (k in store ? store[k] : null),
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: k      => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

/**
 * Simula `window.localStorage`.
 * @type {StorageLike}
 */
const localStorage   = crearStorage();

/**
 * Simula `window.sessionStorage`.
 * @type {StorageLike}
 */
const sessionStorage = crearStorage();

/* ─────────────────────────────────────────────────────────
   Constantes del sistema
   (deben coincidir con los valores en los archivos .html)
───────────────────────────────────────────────────────── */

/** @constant {string} Clave de `localStorage` donde se persisten las citas. */
const CITAS_KEY = 'saludya_citas';

/** @constant {string} Clave de `localStorage` donde se persiste la agenda. */
const AGENDA_KEY = 'saludya_agenda';

/** @constant {string} Nombre del médico activo en el panel médico demo. */
const MEDICO = 'Dra. Paula García';

/** @constant {string} Nombre de otro médico usado para pruebas de aislamiento. */
const OTRO_MEDICO = 'Dr. Fernando Ruiz';

/* ─────────────────────────────────────────────────────────
   Lógica de negocio
   (réplica de medico/index.html y medico/pages/gestion-agenda.html)
───────────────────────────────────────────────────────── */

/**
 * Lee y deserializa la lista de citas desde `localStorage`.
 * Réplica de `getCitas()` en `medico/index.html`.
 *
 * @returns {Cita[]} Array de citas (vacío si no hay datos).
 */
const getCitas = () => JSON.parse(localStorage.getItem(CITAS_KEY) || '[]');

/**
 * Lee y deserializa la lista de franjas de agenda desde `localStorage`.
 * Réplica de `getAgenda()` en `medico/pages/gestion-agenda.html`.
 *
 * @returns {SlotAgenda[]} Array de franjas (vacío si no hay datos).
 */
const getAgenda = () => JSON.parse(localStorage.getItem(AGENDA_KEY) || '[]');

/**
 * Serializa y persiste la lista de citas en `localStorage`.
 * Réplica de `saveCitas()` en `medico/index.html`.
 *
 * @param {Cita[]} datos - Lista de citas a guardar.
 * @returns {void}
 */
const setCitas = datos => localStorage.setItem(CITAS_KEY, JSON.stringify(datos));

/**
 * Serializa y persiste la lista de franjas en `localStorage`.
 * Réplica de `saveAgenda()` en `medico/pages/gestion-agenda.html`.
 *
 * @param {SlotAgenda[]} datos - Lista de franjas a guardar.
 * @returns {void}
 */
const setAgenda = datos => localStorage.setItem(AGENDA_KEY, JSON.stringify(datos));

/**
 * Elimina todas las claves de SaludYa de ambos storages.
 * Debe llamarse al inicio y al final de cada test para garantizar aislamiento.
 *
 * @returns {void}
 */
function limpiarTodo() {
  localStorage.removeItem(CITAS_KEY);
  localStorage.removeItem(AGENDA_KEY);
  sessionStorage.removeItem('saludya_sesion');
  sessionStorage.removeItem('saludya_nombre');
}

/**
 * Determina si una franja de agenda ya tiene una cita activa asociada.
 * Réplica exacta de `isReservada()` en `medico/pages/gestion-agenda.html`.
 *
 * Una franja se considera **reservada** cuando existe al menos una cita con
 * el mismo médico, fecha y `hora === horaInicio`, en estado `"pendiente"` o
 * `"confirmada"`. Las citas canceladas o rechazadas no bloquean la franja.
 *
 * @param {SlotAgenda} slot   - Franja horaria a evaluar.
 * @param {Cita[]}     citas  - Lista de citas activas en el sistema.
 * @returns {boolean} `true` si la franja está ocupada, `false` si está libre.
 *
 * @example
 * const slot = { medico: 'Dra. X', fecha: '2026-09-01', horaInicio: '09:00', horaFin: '09:30', id: '1' };
 * const citas = [{ medico: 'Dra. X', fecha: '2026-09-01', hora: '09:00', estado: 'pendiente', ... }];
 * isReservada(slot, citas); // → true
 */
function isReservada(slot, citas) {
  return citas.some(c =>
    c.medico === slot.medico     &&
    c.fecha  === slot.fecha      &&
    c.hora   === slot.horaInicio &&
    (c.estado === 'pendiente' || c.estado === 'confirmada')
  );
}

/**
 * Comprueba si una fecha ISO corresponde al día actual.
 * Réplica de `esMismoDia()` en `medico/index.html`.
 *
 * La hora de referencia se inyecta como parámetro para facilitar tests
 * deterministas sin depender del reloj del sistema.
 *
 * @param {string} fecha        - Fecha a evaluar en formato `YYYY-MM-DD`.
 * @param {Date}   [hoy=new Date()] - Fecha de referencia (por defecto hoy).
 * @returns {boolean} `true` si `fecha` corresponde a `hoy`.
 *
 * @example
 * esMismoDia('2026-06-06', new Date('2026-06-06')); // → true
 * esMismoDia('2026-01-01', new Date('2026-06-06')); // → false
 */
function esMismoDia(fecha, hoy = new Date()) {
  const d = new Date(fecha + 'T00:00:00');
  return d.getFullYear() === hoy.getFullYear() &&
         d.getMonth()    === hoy.getMonth()    &&
         d.getDate()     === hoy.getDate();
}

/**
 * Actualiza el estado de una cita en el storage.
 * Réplica de `cambiarEstado()` en `medico/index.html`.
 *
 * Realiza un map inmutable: crea un nuevo array donde únicamente la cita
 * con el `id` indicado recibe el nuevo estado; el resto no se modifica.
 *
 * @param {string} id           - ID de la cita a modificar.
 * @param {'confirmada'|'rechazada'|'cancelada'} nuevoEstado - Estado destino.
 * @returns {void}
 */
function cambiarEstado(id, nuevoEstado) {
  setCitas(getCitas().map(c => c.id === id ? { ...c, estado: nuevoEstado } : c));
}

/**
 * Crea y persiste una nueva cita en el storage.
 * Réplica exacta de `confirmarCita()` en `paciente/pages/cita.html`.
 *
 * Lee el nombre del paciente desde `sessionStorage['saludya_nombre']`
 * y traduce los `value` de los `<select>` HTML a nombres legibles usando
 * los mapas internos `MEDICO_MAP` y `ESP_MAP`.
 *
 * @param {Object} params                                                         - Valores del formulario de cita.
 * @param {'medicina_general'|'dermatologia'|'pediatria'} params.especialidad     - `value` del select de especialidad.
 * @param {'dr-paula-garcia'|'dra-lopez'}                 params.medico           - `value` del select de médico.
 * @param {string}                                        params.fecha            - Fecha en formato `YYYY-MM-DD`.
 * @param {string}                                        params.hora             - Hora en formato `HH:mm`.
 * @returns {Cita} La cita creada, ya persistida en `localStorage`.
 *
 * @example
 * sessionStorage.setItem('saludya_nombre', 'Ana Gómez');
 * const cita = confirmarCita({ especialidad: 'dermatologia', medico: 'dr-paula-garcia', fecha: '2026-09-01', hora: '09:00' });
 * cita.paciente;     // → 'Ana Gómez'
 * cita.medico;       // → 'Dra. Paula García'
 * cita.especialidad; // → 'Dermatología'
 * cita.estado;       // → 'pendiente'
 */
function confirmarCita({ especialidad, medico, fecha, hora }) {
  const MEDICO_MAP = {
    'dr-paula-garcia': 'Dra. Paula García',
    'dra-lopez':       'Dra. López',
  };
  const ESP_MAP = {
    'medicina_general': 'Medicina General',
    'dermatologia':     'Dermatología',
    'pediatria':        'Pediatría',
  };
  const cita = {
    id:           'cita_' + Date.now() + Math.random().toString(36).slice(2),
    paciente:     sessionStorage.getItem('saludya_nombre') || 'Paciente Demo',
    medico:       MEDICO_MAP[medico],
    especialidad: ESP_MAP[especialidad],
    fecha,
    hora,
    estado:       'pendiente',
    motivo:       '',
  };
  setCitas([...getCitas(), cita]);
  return cita;
}

/* ─────────────────────────────────────────────────────────
   Helpers de fixtures
───────────────────────────────────────────────────────── */

/**
 * Contador secuencial para generar IDs únicos en fixtures.
 * @type {number}
 */
let _seq = 0;

/**
 * Genera un objeto {@link Cita} con valores predeterminados para usar en tests.
 * Usa el contador `_seq` para garantizar IDs únicos entre llamadas.
 *
 * @param {Partial<Cita>} [overrides={}] - Campos a sobreescribir sobre los defaults.
 * @returns {Cita} Objeto cita listo para insertar en storage.
 *
 * @example
 * nuevaCita();
 * // → { id: 'cita_t_1', paciente: 'Paciente Test', medico: 'Dra. Paula García', estado: 'pendiente', ... }
 *
 * nuevaCita({ estado: 'confirmada', fecha: '2026-10-01' });
 * // → { id: 'cita_t_2', ..., estado: 'confirmada', fecha: '2026-10-01' }
 */
function nuevaCita(overrides = {}) {
  return {
    id:           `cita_t_${++_seq}`,
    paciente:     'Paciente Test',
    medico:       MEDICO,
    especialidad: 'Medicina General',
    fecha:        '2026-08-15',
    hora:         '10:00',
    estado:       'pendiente',
    motivo:       '',
    ...overrides,
  };
}

/**
 * Genera un objeto {@link SlotAgenda} con valores predeterminados para usar en tests.
 * Usa el contador `_seq` para garantizar IDs únicos entre llamadas.
 *
 * @param {Partial<SlotAgenda>} [overrides={}] - Campos a sobreescribir sobre los defaults.
 * @returns {SlotAgenda} Objeto slot listo para insertar en storage.
 *
 * @example
 * nuevoSlot({ fecha: '2026-10-01', horaInicio: '09:00', horaFin: '09:30' });
 * // → { id: 'slot_t_3', medico: 'Dra. Paula García', fecha: '2026-10-01', ... }
 */
function nuevoSlot(overrides = {}) {
  return {
    id:         `slot_t_${++_seq}`,
    medico:     MEDICO,
    fecha:      '2026-08-15',
    horaInicio: '10:00',
    horaFin:    '10:30',
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────
   Framework mínimo de tests
───────────────────────────────────────────────────────── */

/**
 * Registro global de todas las suites definidas.
 * @type {Suite[]}
 */
const suites = [];

/**
 * Suite activa durante la ejecución de `describir()`.
 * @type {Suite|null}
 */
let _suite = null;

/**
 * Total de tests que pasaron.
 * @type {number}
 */
let totalPass = 0;

/**
 * Total de tests que fallaron.
 * @type {number}
 */
let totalFail = 0;

/**
 * Define una suite de tests. Equivale al `describe()` de Jest/Vitest.
 *
 * Registra una nueva {@link Suite} en el array global `suites`,
 * la marca como activa y ejecuta `fn` de forma síncrona para
 * que todas las llamadas a `it()` internas queden registradas.
 *
 * @param {string}          nombre - Nombre descriptivo de la suite (se muestra en terminal).
 * @param {function(): void} fn    - Función que contiene las llamadas a {@link it}.
 * @returns {void}
 *
 * @example
 * describir('Mi módulo', () => {
 *   it('hace algo', () => { ... });
 * });
 */
function describir(nombre, fn) {
  _suite = { nombre, tests: [] };
  suites.push(_suite);
  fn();
}

/**
 * Define y ejecuta un caso de test individual. Equivale al `it()` / `test()` de Jest/Vitest.
 *
 * Si `fn` completa sin lanzar errores el test se registra como pasado.
 * Cualquier excepción lanzada (incluyendo las de {@link expect}) marca el test como fallido.
 *
 * @param {string}          nombre - Descripción del comportamiento esperado.
 * @param {function(): void} fn    - Cuerpo del test; debe lanzar un `Error` para indicar fallo.
 * @returns {void}
 *
 * @example
 * it('suma dos números', () => {
 *   expect(1 + 1).toBe(2);
 * });
 */
function it(nombre, fn) {
  try {
    fn();
    _suite.tests.push({ nombre, ok: true });
    totalPass++;
  } catch (e) {
    _suite.tests.push({ nombre, ok: false, error: e.message });
    totalFail++;
  }
}

/**
 * Crea un objeto de aserciones sobre un valor.
 * Equivale al `expect()` de Jest/Vitest.
 *
 * Cada método lanza un `Error` con un mensaje descriptivo si la aserción falla,
 * lo que permite que {@link it} capture el fallo y registre el mensaje.
 *
 * @param {*} valor - Valor a evaluar.
 * @returns {Matcher} Objeto con métodos de aserción.
 *
 * @example
 * expect(getCitas().length).toBe(1);
 * expect(resultado).toBeTruthy();
 * expect(lista).toHaveProperty('id');
 */
function expect(valor) {
  return {
    /**
     * Verifica igualdad estricta (`===`).
     * @param {*} esperado - Valor esperado.
     * @throws {Error} Si `valor !== esperado`.
     */
    toBe(esperado) {
      if (valor !== esperado)
        throw new Error(`esperaba ${JSON.stringify(esperado)}, recibió ${JSON.stringify(valor)}`);
    },

    /**
     * Verifica que el valor sea truthy (`!!valor === true`).
     * @throws {Error} Si el valor es falsy.
     */
    toBeTruthy() {
      if (!valor) throw new Error(`esperaba truthy, recibió ${JSON.stringify(valor)}`);
    },

    /**
     * Verifica que el valor sea falsy (`!!valor === false`).
     * @throws {Error} Si el valor es truthy.
     */
    toBeFalsy() {
      if (valor) throw new Error(`esperaba falsy, recibió ${JSON.stringify(valor)}`);
    },

    /**
     * Verifica que el valor numérico sea estrictamente mayor que `n`.
     * @param {number} n - Límite inferior (exclusivo).
     * @throws {Error} Si `valor <= n`.
     */
    toBeGreaterThan(n) {
      if (valor <= n) throw new Error(`esperaba > ${n}, recibió ${valor}`);
    },

    /**
     * Verifica que el objeto tenga la propiedad indicada (usando `in`).
     * @param {string} prop - Nombre de la propiedad.
     * @throws {Error} Si el valor no es un objeto o no posee `prop`.
     */
    toHaveProperty(prop) {
      if (typeof valor !== 'object' || valor === null || !(prop in valor))
        throw new Error(`objeto no tiene la propiedad "${prop}"`);
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   DEFINICIÓN DE PRUEBAS
═══════════════════════════════════════════════════════════ */

describir('1. Almacenamiento', () => {
  it('storage simulado está disponible', () => {
    expect(typeof localStorage).toBe('object');
    expect(typeof sessionStorage).toBe('object');
  });

  it('getItem devuelve null cuando la clave no existe', () => {
    limpiarTodo();
    expect(localStorage.getItem('clave_inexistente')).toBe(null);
  });

  it('setItem y getItem persisten un valor en saludya_citas', () => {
    limpiarTodo();
    setCitas([{ id: 'x1' }]);
    expect(getCitas().length).toBe(1);
    limpiarTodo();
  });

  it('setItem y getItem persisten un valor en saludya_agenda', () => {
    limpiarTodo();
    setAgenda([{ id: 'a1' }]);
    expect(getAgenda().length).toBe(1);
    limpiarTodo();
  });

  it('sessionStorage acepta las claves de sesión del sistema', () => {
    sessionStorage.setItem('saludya_sesion', 'activa');
    sessionStorage.setItem('saludya_nombre', 'Carlos López');
    expect(sessionStorage.getItem('saludya_sesion')).toBe('activa');
    expect(sessionStorage.getItem('saludya_nombre')).toBe('Carlos López');
  });

  it('limpiarTodo borra ambas claves', () => {
    setCitas([nuevaCita()]);
    setAgenda([nuevoSlot()]);
    limpiarTodo();
    expect(getCitas().length).toBe(0);
    expect(getAgenda().length).toBe(0);
  });
});

describir('2. Citas — estructura y CRUD', () => {
  it('una cita tiene todos los campos obligatorios', () => {
    const cita = nuevaCita();
    ['id', 'paciente', 'medico', 'especialidad', 'fecha', 'hora', 'estado'].forEach(p =>
      expect(cita).toHaveProperty(p)
    );
  });

  it('crear una cita la persiste en localStorage', () => {
    limpiarTodo();
    const cita = nuevaCita();
    setCitas([...getCitas(), cita]);
    expect(getCitas().length).toBe(1);
    expect(getCitas()[0].id).toBe(cita.id);
    limpiarTodo();
  });

  it('cambiar estado a "confirmada" persiste correctamente', () => {
    limpiarTodo();
    const cita = nuevaCita({ estado: 'pendiente' });
    setCitas([cita]);
    cambiarEstado(cita.id, 'confirmada');
    expect(getCitas()[0].estado).toBe('confirmada');
    limpiarTodo();
  });

  it('rechazar una cita persiste estado "rechazada"', () => {
    limpiarTodo();
    const cita = nuevaCita({ estado: 'pendiente' });
    setCitas([cita]);
    cambiarEstado(cita.id, 'rechazada');
    expect(getCitas()[0].estado).toBe('rechazada');
    limpiarTodo();
  });

  it('cambiar estado no afecta a otras citas', () => {
    limpiarTodo();
    const c1 = nuevaCita({ estado: 'pendiente' });
    const c2 = nuevaCita({ estado: 'pendiente' });
    setCitas([c1, c2]);
    cambiarEstado(c1.id, 'confirmada');
    expect(getCitas().find(c => c.id === c2.id).estado).toBe('pendiente');
    limpiarTodo();
  });

  it('múltiples citas conviven sin sobrescribirse', () => {
    limpiarTodo();
    setCitas([
      nuevaCita({ paciente: 'A', fecha: '2026-09-01' }),
      nuevaCita({ paciente: 'B', fecha: '2026-09-02' }),
      nuevaCita({ paciente: 'C', fecha: '2026-09-03' }),
    ]);
    expect(getCitas().length).toBe(3);
    limpiarTodo();
  });

  it('getCitas devuelve array vacío cuando no hay datos', () => {
    limpiarTodo();
    expect(getCitas().length).toBe(0);
  });
});

describir('3. Filtro por médico', () => {
  it('solo se muestran citas asignadas al médico actual', () => {
    limpiarTodo();
    setCitas([
      nuevaCita({ medico: MEDICO }),
      nuevaCita({ medico: OTRO_MEDICO }),
      nuevaCita({ medico: MEDICO }),
    ]);
    const propias = getCitas().filter(c => c.medico === MEDICO);
    expect(propias.length).toBe(2);
    limpiarTodo();
  });

  it('citas de otro médico no aparecen en el panel', () => {
    limpiarTodo();
    setCitas([nuevaCita({ medico: OTRO_MEDICO })]);
    const propias = getCitas().filter(c => c.medico === MEDICO);
    expect(propias.length).toBe(0);
    limpiarTodo();
  });

  it('filtro "pendiente" devuelve solo las pendientes del médico', () => {
    limpiarTodo();
    setCitas([
      nuevaCita({ medico: MEDICO, estado: 'pendiente' }),
      nuevaCita({ medico: MEDICO, estado: 'confirmada' }),
      nuevaCita({ medico: MEDICO, estado: 'cancelada' }),
    ]);
    const pendientes = getCitas().filter(c => c.medico === MEDICO && c.estado === 'pendiente');
    expect(pendientes.length).toBe(1);
    limpiarTodo();
  });

  it('filtro "confirmada" devuelve solo las confirmadas del médico', () => {
    limpiarTodo();
    setCitas([
      nuevaCita({ medico: MEDICO, estado: 'confirmada' }),
      nuevaCita({ medico: MEDICO, estado: 'confirmada' }),
      nuevaCita({ medico: MEDICO, estado: 'pendiente' }),
    ]);
    const confirmadas = getCitas().filter(c => c.medico === MEDICO && c.estado === 'confirmada');
    expect(confirmadas.length).toBe(2);
    limpiarTodo();
  });

  it('stats: citas de hoy se cuentan correctamente', () => {
    limpiarTodo();
    const hoy = new Date().toISOString().split('T')[0];
    setCitas([
      nuevaCita({ medico: MEDICO, fecha: hoy,          estado: 'confirmada' }),
      nuevaCita({ medico: MEDICO, fecha: hoy,          estado: 'pendiente'  }),
      nuevaCita({ medico: MEDICO, fecha: '2026-01-01', estado: 'confirmada' }),
    ]);
    const deHoy = getCitas().filter(c =>
      c.medico === MEDICO && esMismoDia(c.fecha) &&
      (c.estado === 'confirmada' || c.estado === 'pendiente')
    );
    expect(deHoy.length).toBe(2);
    limpiarTodo();
  });

  it('stats: total pendientes se cuenta sobre todas las fechas', () => {
    limpiarTodo();
    setCitas([
      nuevaCita({ medico: MEDICO, fecha: '2026-06-01', estado: 'pendiente' }),
      nuevaCita({ medico: MEDICO, fecha: '2026-07-01', estado: 'pendiente' }),
      nuevaCita({ medico: MEDICO, fecha: '2026-08-01', estado: 'confirmada' }),
    ]);
    const pendientes = getCitas().filter(c => c.medico === MEDICO && c.estado === 'pendiente');
    expect(pendientes.length).toBe(2);
    limpiarTodo();
  });
});

describir('4. Agenda — franjas horarias', () => {
  it('crear un slot lo persiste en localStorage', () => {
    limpiarTodo();
    setAgenda([nuevoSlot()]);
    expect(getAgenda().length).toBe(1);
    limpiarTodo();
  });

  it('slot tiene todos los campos requeridos', () => {
    const s = nuevoSlot();
    ['id', 'medico', 'fecha', 'horaInicio', 'horaFin'].forEach(p =>
      expect(s).toHaveProperty(p)
    );
  });

  it('franja sin citas se detecta como disponible', () => {
    limpiarTodo();
    const slot = nuevoSlot();
    expect(isReservada(slot, [])).toBeFalsy();
    limpiarTodo();
  });

  it('franja con cita pendiente se detecta como reservada', () => {
    limpiarTodo();
    const slot = nuevoSlot({ fecha: '2026-08-20', horaInicio: '09:00' });
    const cita = nuevaCita({ fecha: '2026-08-20', hora: '09:00', estado: 'pendiente' });
    setAgenda([slot]);
    setCitas([cita]);
    expect(isReservada(slot, getCitas())).toBeTruthy();
    limpiarTodo();
  });

  it('franja con cita confirmada se detecta como reservada', () => {
    limpiarTodo();
    const slot = nuevoSlot({ fecha: '2026-08-21', horaInicio: '11:00' });
    const cita = nuevaCita({ fecha: '2026-08-21', hora: '11:00', estado: 'confirmada' });
    setAgenda([slot]);
    setCitas([cita]);
    expect(isReservada(slot, getCitas())).toBeTruthy();
    limpiarTodo();
  });

  it('franja con cita cancelada sigue disponible', () => {
    limpiarTodo();
    const slot = nuevoSlot({ fecha: '2026-08-22', horaInicio: '08:00' });
    const cita = nuevaCita({ fecha: '2026-08-22', hora: '08:00', estado: 'cancelada' });
    setAgenda([slot]);
    setCitas([cita]);
    expect(isReservada(slot, getCitas())).toBeFalsy();
    limpiarTodo();
  });

  it('franja con cita rechazada sigue disponible', () => {
    limpiarTodo();
    const slot = nuevoSlot({ fecha: '2026-08-23', horaInicio: '14:00' });
    const cita = nuevaCita({ fecha: '2026-08-23', hora: '14:00', estado: 'rechazada' });
    setAgenda([slot]);
    setCitas([cita]);
    expect(isReservada(slot, getCitas())).toBeFalsy();
    limpiarTodo();
  });

  it('eliminar un slot libre lo borra del storage', () => {
    limpiarTodo();
    const slot = nuevoSlot();
    setAgenda([slot]);
    setAgenda(getAgenda().filter(s => s.id !== slot.id));
    expect(getAgenda().length).toBe(0);
    limpiarTodo();
  });

  it('no se puede eliminar un slot reservado (regla de negocio)', () => {
    limpiarTodo();
    const slot = nuevoSlot({ fecha: '2026-08-25', horaInicio: '10:00' });
    const cita = nuevaCita({ fecha: '2026-08-25', hora: '10:00', estado: 'pendiente' });
    setAgenda([slot]);
    setCitas([cita]);
    const puedeEliminar = !isReservada(slot, getCitas());
    expect(puedeEliminar).toBeFalsy();
    limpiarTodo();
  });
});

describir('5. Flujo completo paciente → médico', () => {
  it('login guarda el nombre del usuario en sessionStorage', () => {
    sessionStorage.setItem('saludya_nombre', 'Carlos López');
    expect(sessionStorage.getItem('saludya_nombre')).toBe('Carlos López');
  });

  it('confirmarCita() usa el nombre de sesión como paciente', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Ana Gómez');
    const cita = confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-10', hora: '09:30' });
    expect(cita.paciente).toBe('Ana Gómez');
    limpiarTodo();
  });

  it('confirmarCita() traduce el value del select al nombre del médico', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Test');
    const cita = confirmarCita({ especialidad: 'dermatologia', medico: 'dr-paula-garcia', fecha: '2026-09-11', hora: '10:00' });
    expect(cita.medico).toBe('Dra. Paula García');
    limpiarTodo();
  });

  it('confirmarCita() traduce el value del select a nombre de especialidad', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Test');
    const cita = confirmarCita({ especialidad: 'pediatria', medico: 'dr-paula-garcia', fecha: '2026-09-12', hora: '11:00' });
    expect(cita.especialidad).toBe('Pediatría');
    limpiarTodo();
  });

  it('cita agendada por el paciente llega con estado "pendiente"', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Test');
    const cita = confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-13', hora: '08:00' });
    expect(cita.estado).toBe('pendiente');
    limpiarTodo();
  });

  it('cita del paciente aparece en las solicitudes del médico', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'María Torres');
    confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-15', hora: '09:00' });
    const solicitudes = getCitas().filter(c => c.medico === MEDICO && c.estado === 'pendiente');
    expect(solicitudes.some(c => c.paciente === 'María Torres')).toBeTruthy();
    limpiarTodo();
  });

  it('el médico puede confirmar la cita del paciente', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Test');
    const cita = confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-16', hora: '10:00' });
    cambiarEstado(cita.id, 'confirmada');
    expect(getCitas().find(c => c.id === cita.id).estado).toBe('confirmada');
    limpiarTodo();
  });

  it('cita confirmada deja de aparecer en solicitudes pendientes', () => {
    limpiarTodo();
    sessionStorage.setItem('saludya_nombre', 'Test');
    const cita = confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-17', hora: '11:00' });
    cambiarEstado(cita.id, 'confirmada');
    const pendientes = getCitas().filter(c => c.medico === MEDICO && c.estado === 'pendiente');
    expect(pendientes.length).toBe(0);
    limpiarTodo();
  });

  it('varios pacientes pueden agendar citas independientes', () => {
    limpiarTodo();
    for (const nombre of ['Paciente A', 'Paciente B', 'Paciente C']) {
      sessionStorage.setItem('saludya_nombre', nombre);
      confirmarCita({ especialidad: 'medicina_general', medico: 'dr-paula-garcia', fecha: '2026-09-20', hora: '09:00' });
    }
    expect(getCitas().length).toBe(3);
    limpiarTodo();
  });
});

/* ─────────────────────────────────────────────────────────
   Render de resultados en terminal
───────────────────────────────────────────────────────── */

const LINE = c.gray + '─'.repeat(52) + c.reset;

console.log('\n' + c.bold + c.cyan + 'SaludYa — Pruebas de integración' + c.reset);
console.log(LINE);

for (const suite of suites) {
  console.log('\n' + c.bold + suite.nombre + c.reset);
  for (const t of suite.tests) {
    const icon = t.ok ? c.green + '  ✓' : c.red + '  ✗';
    console.log(icon + c.reset + ' ' + t.nombre);
    if (t.error) console.log(c.red + c.dim + '      → ' + t.error + c.reset);
  }
}

console.log('\n' + LINE);
const passStr = c.green + c.bold + `✓ ${totalPass} pasadas` + c.reset;
const failStr = totalFail > 0
  ? c.red  + c.bold + `✗ ${totalFail} fallidas` + c.reset
  : c.gray + `✗ 0 fallidas` + c.reset;
console.log(passStr + '   ' + failStr + '\n');

process.exit(totalFail > 0 ? 1 : 0);
