/**
 * SSAS JALISCO — Cuestionario Socioeconómico
 * API receptora (estática + Apps Script)
 * =====================================
 * 
 * NOVEDADES de esta versión:
 *   - Cada encuesta lleva un PIN de encuestador (capturado en la app antes de
 *     iniciar; queda guardado por dispositivo). Esto permite saber qué
 *     encuestador hizo qué encuesta sin necesidad de login con conexión.
 *   - Se registra hora de inicio y hora de término de la encuesta, además de
 *     la duración total en segundos.
 *   - Hoja "Auditoria" registra establecimientos de PIN, cambios, sincronizaciones
 *     exitosas y errores.
 *
 * Despliegue:
 *   1. Pega este código en https://script.google.com (vinculado a un Spreadsheet)
 *   2. Implementar → Nueva implementación → "Aplicación web":
 *        Ejecutar como: Yo
 *        Acceso: Cualquier usuario (incluso anónimo)
 *   3. Copia la URL "/exec" y ponla en index.html (URL_API).
 */

const SHEET_RESP  = 'Respuestas';
const SHEET_AUDIT = 'Auditoria';

// Encabezados de la hoja Respuestas
const HEADERS = [
  'Fecha_Servidor', 'Folio', 'ID_Cliente', 'PIN_Encuestador',
  // Tiempos
  'Hora_Inicio', 'Hora_Termino', 'Duracion_Segundos',
  // GPS
  'Latitud', 'Longitud',
  // Identificación
  'Nombre', 'Apellido_Paterno', 'Apellido_Materno', 'CURP', 'Ocupacion', 'Edad', 'Sexo',
  // Domicilio
  'Domicilio', 'No_Interior', 'CP', 'Localidad', 'Colonia', 'Area', 'AGEB', 'Municipio',
  'Telefono_Fijo', 'Celular',
  // Hogar
  'Personas_Hogar', 'Menores_18', 'Adultos_60', 'Aportantes',
  'Integrante_1_Nombre', 'Integrante_1_Edad', 'Integrante_1_Ocupacion',
  'Integrante_2_Nombre', 'Integrante_2_Edad', 'Integrante_2_Ocupacion',
  'Integrante_3_Nombre', 'Integrante_3_Edad', 'Integrante_3_Ocupacion',
  'Discapacidad', 'Tipo_Discapacidad',
  // Socioeconómico
  'Ingreso_Mensual', 'Perdio_Empleo',
  // Vivienda
  'Servicios_Publicos', 'Tipo_Vivienda', 'Material_Piso', 'Material_Piso_Otro',
  'Material_Techo', 'Material_Techo_Otro',
  // Transporte
  'Medio_Transporte', 'Medio_Transporte_Otro', 'Apoyo_Transporte', 'Apoyo_Transporte_Tipo',
  'Frecuencia_Transporte',
  // Educación
  'Nivel_Estudios', 'Ninos_No_Escuela', 'Apoyo_Escolar', 'Condicion_Escuela', 'Estancias_Infantiles',
  // Salud
  'Servicio_Salud', 'Servicio_Salud_Tipo', 'Servicio_Salud_Otro', 'Calificacion_Salud',
  'Surte_Medicamento', 'Hospital_Cerca', 'Enf_Cronicas', 'Problemas_Emocionales',
  'Atencion_Psicologica',
  // Programas sociales
  'Recibe_Apoyo', 'Recibe_Apoyo_Cual', 'Satisfaccion_Apoyo', 'Tipo_Apoyo_Necesario',
  'Tipo_Apoyo_Otro', 'Preferencia_Apoyo', 'Programas_Conocidos', 'Programas_Otro',
  // Participación (prioridades)
  'Pri_Seguridad_Orden', 'Pri_Seguridad_Detalle',
  'Pri_Educacion_Orden', 'Pri_Educacion_Detalle',
  'Pri_Salud_Orden', 'Pri_Salud_Detalle',
  'Pri_Servicios_Orden', 'Pri_Servicios_Detalle',
  'Pri_Desempleo_Orden', 'Pri_Desempleo_Detalle',
  'Pri_Adicciones_Orden', 'Pri_Adicciones_Detalle',
  'Participa_Comites', 'Disposicion_Proyecto', 'Disposicion_Motivo',
  // Opinión social
  'Conoce_Presidente', 'Conoce_Presidente_Nombre',
  'Conoce_Gobernador', 'Conoce_Gobernador_Nombre',
  'Conoce_Bienestar', 'Conoce_Bienestar_Nombre',
  'Conoce_SSAS', 'Conoce_SSAS_Nombre',
  'Gobierno_Cercano',
  // Calificaciones
  'Calif_Presidente', 'Calif_Gobernador', 'Calif_Bienestar', 'Calif_SSAS',
  // Metadatos cliente
  'Creado_En_Cliente', 'User_Agent'
];

// Encabezados de la hoja Auditoria
const AUDIT_HEADERS = ['Timestamp', 'PIN', 'Evento', 'Detalle', 'User_Agent'];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _json({ estatus: 'error', mensaje: 'Sin datos en el cuerpo de la petición' });
    }
    const datosRecibidos = JSON.parse(e.postData.contents);

    // ¿Es una llamada de auditoría dedicada o un envío de encuestas?
    // El frontend incluye "_audit:true" en eventos de auditoría puros (set PIN, etc.)
    if (datosRecibidos && datosRecibidos._audit === true) {
      const eventos = Array.isArray(datosRecibidos.eventos) ? datosRecibidos.eventos : [];
      eventos.forEach(function(ev){
        _audit_(ev.pin || '', ev.evento || '', ev.detalle || '', ev.userAgent || '');
      });
      return _json({ estatus: 'ok', mensaje: 'Auditoría registrada', total: eventos.length });
    }

    const registros = Array.isArray(datosRecibidos) ? datosRecibidos : [datosRecibidos];
    if (!registros.length) return _json({ estatus: 'error', mensaje: 'Arreglo vacío' });

    const sheet = _hoja_();
    const guardados = [];

    registros.forEach(function (r) {
      const idCliente = String(r.id_cliente || '');
      if (idCliente && _existeIdCliente_(sheet, idCliente)) {
        guardados.push({ id_cliente: idCliente, duplicado: true, folio: '' });
        return;
      }
      const folio = 'JAL-' + Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyyMMdd') +
                    '-' + Utilities.getUuid().substring(0, 8).toUpperCase();

      const ints = Array.isArray(r.integrantes) ? r.integrantes : [{},{},{}];
      while (ints.length < 3) ints.push({});

      const pri = r.prioridades || {};
      const _pri = function(tema) {
        const v = pri[tema] || {};
        return [String(v.rango || ''), String(v.detalle || '')];
      };
      const p1 = _pri('Seguridad');
      const p2 = _pri('Educación');
      const p3 = _pri('Salud');
      const p4 = _pri('Servicios Públicos (agua, luz, drenaje, calles)');
      const p5 = _pri('Desempleo');
      const p6 = _pri('Adicciones');

      const fila = [
        new Date(), folio, idCliente, String(r.pin || ''),
        String(r.horaInicio || ''), String(r.horaTermino || ''),
        Number(r.duracionSegundos) || 0,
        r.latitud || '', r.longitud || '',
        r.nombre || '', r.apPaterno || '', r.apMaterno || '', r.curp || '', r.ocupacion || '',
        r.edad || '', r.sexo || '',
        r.domicilio || '', r.noInt || '', r.cp || '', r.localidad || '', r.colonia || '',
        r.area || '', r.ageb || '', r.municipio || '', r.telFijo || '', r.celular || '',
        r.personasHogar || '', r.menores18 || '', r.adultos60 || '', r.aportantes || '',
        ints[0].nombre || '', ints[0].edad || '', ints[0].ocupacion || '',
        ints[1].nombre || '', ints[1].edad || '', ints[1].ocupacion || '',
        ints[2].nombre || '', ints[2].edad || '', ints[2].ocupacion || '',
        r.discapacidad || '', r.tipoDiscapacidad || '',
        r.ingresoMensual || '', r.perdioEmpleo || '',
        _arr_(r.serviciosPublicos), r.tipoVivienda || '',
        r.materialPiso || '', r.materialPisoOtro || '',
        r.materialTecho || '', r.materialTechoOtro || '',
        r.medioTransporte || '', r.medioTransporteOtro || '',
        r.apoyoTransporte || '', _arr_(r.apoyoTransporteTipo), r.frecuenciaTransporte || '',
        r.nivelEstudios || '', r.ninosNoEscuela || '', r.apoyoEscolar || '',
        r.condicionEscuela || '', r.estanciasInfantiles || '',
        r.servicioSalud || '', _arr_(r.servicioSaludTipo), r.servicioSaludOtro || '',
        r.calificacionSalud || '', r.surteMedicamento || '', r.hospitalCerca || '',
        r.enfCronicas || '', r.problemasEmocionales || '', r.atencionPsicologica || '',
        r.recibeApoyo || '', r.recibeApoyoCual || '', r.satisfaccionApoyo || '',
        _arr_(r.tipoApoyoNecesario), r.tipoApoyoOtro || '', r.preferenciaApoyo || '',
        _arr_(r.programasConocidos), r.programasOtro || '',
        p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1], p5[0], p5[1], p6[0], p6[1],
        r.participaComites || '', r.disposicionProyecto || '', r.disposicionMotivo || '',
        r.conocePresidente || '', r.conocePresidenteNombre || '',
        r.conoceGobernador || '', r.conoceGobernadorNombre || '',
        r.conoceBienestar || '', r.conoceBienestarNombre || '',
        r.conoceSSAS || '', r.conoceSSASNombre || '',
        r.gobiernoCercano || '',
        r.califPresidente || '', r.califGobernador || '', r.califBienestar || '', r.califSSAS || '',
        String(r.creado_en || ''),
        String(r.userAgent || '').substring(0, 300)
      ];
      sheet.appendRow(fila);
      // Registrar en auditoría la sincronización exitosa
      _audit_(String(r.pin || ''), 'ENCUESTA_SINCRONIZADA',
              'Folio: ' + folio + ' · Municipio: ' + (r.municipio || ''),
              String(r.userAgent || '').substring(0, 300));
      guardados.push({ id_cliente: idCliente, duplicado: false, folio: folio });
    });

    return _json({ estatus: 'ok', mensaje: 'Datos guardados', total: guardados.length, detalle: guardados });
  } catch (err) {
    return _json({ estatus: 'error', mensaje: String(err && err.message || err) });
  }
}

function doGet() {
  return _json({ estatus: 'ok', mensaje: 'API SSAS Jalisco activa', timestamp: new Date().toISOString() });
}

// ---------- Helpers ----------
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _arr_(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
function _hoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Vincula este script desde Extensiones → Apps Script de un Spreadsheet.');
  let sh = ss.getSheetByName(SHEET_RESP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_RESP);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#2B1B4B').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < HEADERS.length) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#2B1B4B').setFontColor('#ffffff');
  }
  return sh;
}
function _hojaAudit_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_AUDIT);
  if (!sh) {
    sh = ss.insertSheet(SHEET_AUDIT);
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS])
      .setFontWeight('bold').setBackground('#C24B96').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _audit_(pin, evento, detalle, userAgent) {
  try {
    const sh = _hojaAudit_();
    const ts = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow([ts, String(pin || ''), String(evento || ''),
                  String(detalle || ''), String(userAgent || '').substring(0, 300)]);
  } catch (e) {
    // Best-effort: no debe romper el flujo
  }
}
function _existeIdCliente_(sheet, idCliente) {
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const col = sheet.getRange(2, 3, last - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]) === idCliente) return true;
  }
  return false;
}
