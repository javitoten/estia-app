# Estia — Vacation Property OS

ERP para empresas de gestión de viviendas vacacionales: propiedades, facturas con OCR real,
gastos/ingresos, rentabilidad, calendario, inventario, mantenimiento, documentación con alertas
de caducidad, incidencias y un asistente de IA sobre tus propios datos.

## Arrancar

Requiere Node.js 22.5+ (usa el módulo `node:sqlite` incorporado, sin dependencias externas).

```
node server.js
```

Abre http://localhost:4000 — se crea automáticamente una cuenta de demo la primera vez:

- Email: `demo@estia.app`
- Contraseña: `demo1234`

También puedes registrar tu propia empresa desde `/register`.

## Notas técnicas

- **Cero dependencias npm.** Todo corre con módulos nativos de Node (`http`, `node:sqlite`, `crypto`)
  porque este entorno de desarrollo no tenía acceso a internet para instalar paquetes. Es intencionadamente
  ligero: no hay build step, no hay `node_modules`. Si más adelante se quiere migrar a Next.js/Prisma/React,
  la lógica de negocio (src/queries.js, src/ocr.js, src/seed.js, el esquema en src/db.js) se traslada casi
  directamente.
- **Base de datos:** SQLite en `data/estia.db` (se crea sola al arrancar).
- **OCR real:** usa el binario `tesseract` instalado en el sistema (+ `pdftoppm` para PDFs). Sube una
  factura desde "Facturas → + Subir factura" para verlo funcionando de principio a fin.
- **Asistente de IA:** motor de reglas que interpreta la pregunta y consulta la base de datos real del
  tenant (no hay llamada a un LLM externo en este entorno). La lógica está en `src/routes/ai.js` y ya
  sigue el patrón de "tool calling sobre datos propios" descrito en el documento de producto, así que
  conectar un LLM real más adelante es sustituir esa función por una llamada a la API que quieras usar.
- **Multi-tenant:** cada empresa (`companies`) tiene sus propios usuarios, propiedades y datos; todas las
  consultas están acotadas por `company_id`.

## Estructura

```
server.js              Servidor HTTP + router
src/db.js               Esquema SQLite
src/seed.js              Datos de demostración
src/auth.js              Sesiones y hashing de contraseñas
src/ocr.js                Extracción OCR + clasificación automática
src/queries.js            Cálculos de rentabilidad y KPIs
src/property_tabs.js      Los 10 módulos por propiedad
src/routes/                Páginas y API
public/                    CSS y JS de cliente
```
