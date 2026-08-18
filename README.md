# Sistema de Generación de Actas PNP

App web (Node.js + Express + docxtemplater) que genera actas de intervención
policial en formato Word (.docx). Soporta varias personas intervinientes a la
vez, sugiere la base legal según el delito, trae la ubicación oficial del
Perú en cascada, autocompleta nombres desde el DNI vía RENIEC, usa íconos
SVG y la paleta institucional oficial de la PNP, valida campos numéricos, y
puede protegerse con usuario/contraseña para publicarlo con un link.

## Cómo correrlo localmente

```bash
npm install
cp .env.example .env      # completa lo que necesites (ver abajo)
npm start
```

Abre http://localhost:3000.

## Publicar el sistema con un link (Render.com, gratis)

Recomendado porque no requiere tarjeta, da HTTPS automático, y soporta un
servidor Node "de verdad" (a diferencia de hostings solo-estáticos).

### 1. Protege el sistema con usuario y contraseña — OBLIGATORIO

Antes de publicarlo, define `AUTH_USER` y `AUTH_PASS` (ver `.env.example`).
**El sistema maneja datos sensibles** (DNI, violencia familiar, menores) —
sin esto, cualquiera con el link puede generarlos. Cuando estas variables
están configuradas, el navegador pide usuario/contraseña antes de mostrar
nada; sin ellas, queda abierto (solo aceptable en tu PC local).

### 2. Sube el proyecto a GitHub

```bash
cd sistema-actas-entrega
git init
git add .
git commit -m "Sistema de actas PNP"
```
Crea un repositorio nuevo en https://github.com/new (puede ser privado) y
sigue las instrucciones que te da GitHub para conectar tu carpeta local
("git remote add origin ..." y "git push"). El `.gitignore` ya excluye
`node_modules/` y tu `.env` — nunca subas el token o la contraseña a GitHub.

### 3. Crea el servicio en Render

1. Entra a https://render.com y crea una cuenta (puedes usar tu cuenta de
   GitHub para entrar directo).
2. **New +** → **Web Service**.
3. Conecta el repositorio que acabas de subir.
4. Configuración:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. En la sección **Environment Variables**, agrega ahí (no en un archivo
   `.env`, Render no lo lee) todas las que uses:
   - `AUTH_USER`, `AUTH_PASS` (obligatorias)
   - `RENIEC_API_URL`, `RENIEC_API_TOKEN` (si quieres el autocompletado DNI)
6. **Create Web Service**. Render instala, arranca, y en 2-3 minutos te da
   una URL tipo `https://sistema-actas-pnp.onrender.com` — ese es el link
   que le compartes al usuario.

### Nota sobre el plan gratuito de Render

El plan Free "duerme" el servicio tras ~15 minutos sin uso, y tarda unos 30-
50 segundos en despertar la primera vez que alguien entra después de estar
dormido (no pasa nada, solo se ve una carga lenta la primera vez del día).
Si eso molesta, el plan pago más económico (~$7/mes) lo mantiene siempre
activo.

### Alternativa: Railway.app

Funciona muy parecido (conectas GitHub, defines variables de entorno, te da
una URL pública). Tiene un plan gratuito con crédito limitado por mes en vez
de "dormir" el servicio — puede convenirte más si el sistema se usa seguido
durante el día.

## Varias personas intervinientes (varios detenidos)

En "3. Personas intervinientes" puedes agregar tantos bloques como personas
haya en la diligencia. Agregar una persona nueva nunca borra lo ya escrito
en las anteriores. Al generar, se arma un documento por cada combinación
persona × tipo de acta marcado (uno solo se descarga directo; varios se
entregan en un `.zip`).

## Campos numéricos

DNI, edad, celular, CIP del instructor y teléfonos solo aceptan dígitos. N°
de Resolución/Expediente y placas/licencias quedan como texto libre a
propósito (pueden llevar guiones o letras).

## Paleta de colores

Paleta institucional oficial de la PNP (Directiva de Identidad Gráfica PNP,
2017): verde `#279448`, verde oscuro `#14401f`, dorado `#b08d2c`. Editable
en `--pnp-green`, `--pnp-green-dark`, `--pnp-gold` en `public/index.html`.

## Íconos

SVG del set Lucide (MIT, sin atribución), incrustados sin CDN externo —
funciona sin internet. Editable en `const ICONS = {...}` en el `<script>`.

## Ubicación (Departamento / Provincia / Distrito)

Combobox en cascada con la lista oficial del Perú (25 departamentos, 196
provincias, 1,867 distritos — dataset INEI, en `config/ubigeo.json`, sin
llamadas externas).

## Fecha y horas — botones rápidos

"Fecha", "Hora de inicio" y "Hora de cierre" tienen un botón que llena el
campo con la fecha/hora actual en el formato de las actas.

## Consulta RENIEC (autocompletar nombre desde el DNI)

RENIEC no tiene API pública gratuita oficial. Proveedor recomendado:
[apiperu.dev](https://apiperu.dev) (registro → Configuración → API Token →
pegar en `RENIEC_API_TOKEN`). Alternativas: Factiliza, APIDNI (ver
`.env.example`). Sin configurar, el botón de búsqueda muestra un mensaje
claro en vez de fallar.

**Seguridad**: nunca compartas tokens ni contraseñas por chat o control de
versiones. `.env` nunca debe subirse a git (ya está en `.gitignore`).

## Base legal — cómo funciona

`config/base-legal.json`: por cada tipo de delito trae él o los artículos
del Código Penal y el texto que se inserta en el acta. Es una ayuda de
referencia rápida, no un dictamen legal — la calificación final la define
el fiscal/juez.

## Estructura

- `server.js` — backend Express (config, base-legal, ubigeo, dni, generar,
  generar-lote, auth opcional).
- `templates/*.docx` — plantillas Word con tags `{{campo}}`.
- `config/actas.json`, `config/base-legal.json`, `config/ubigeo.json`.
- `.env.example` — variables de entorno (RENIEC + AUTH_USER/AUTH_PASS).
- `public/index.html` — formulario (vanilla JS).

## Actas implementadas (9 de 9)

1. Acta de Registro Personal
2. Acta de Lectura de Derechos al Imputado
3. Acta de Denuncia Verbal (agresión familiar)
4. Acta de Lectura, Notificación y Entrega de Medidas de Protección
5. Acta de Intervención Policial por Accidente de Tránsito
6. Acta de Lectura de Derechos y Deberes de la Agraviada
7. Acta de Comunicación Telefónica al Fiscal de Turno
8. Acta de Prueba de Equilibrio y Coordinación (Hogan-Romberg / ebriedad)
9. Acta de Intervención Policial — narrativa libre (hurto, hallazgo, etc.)

## Cómo agregar un tipo de acta nuevo

1. Crea `templates/nombre_del_acta.docx` con tags `{{como_este}}`.
2. Agrega la entrada en `config/actas.json` (`implementado: true` +
   `campos_especificos`).
3. Nuevo delito → agrégalo a `config/base-legal.json`.
4. Reinicia el servidor.

## Notas

- Campo vacío → línea en blanco en el documento, no rompe.
- Formulario responsivo (usable desde celular).
- No hay guardado de historial de actas generadas todavía.
