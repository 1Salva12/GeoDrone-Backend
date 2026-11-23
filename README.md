# GeoDrone API

Backend REST para gestión de proyectos y vuelos, autenticación, envío de imágenes a NodeODM y mediciones geoespaciales.

## Base de datos local

El backend ahora usa PostgreSQL. La migración `migrations/001_initial.sql` se aplica al arrancar y crea las tablas en el esquema privado `geodrone`.

```powershell
Copy-Item .env.example .env
# Completa DATABASE_URL y reemplaza JWT_SECRET por un valor aleatorio de 32+ caracteres.
npm install
npm test
npm start
```

Configura `DATABASE_URL`, `JWT_SECRET`, `NODEODM_URL`, `NODEODM_TOKEN`, `UPLOAD_DIR`, `NODEODM_OPTIONS` y `CORS_ORIGIN` en `.env`. No pongas secretos en Android ni los subas al repositorio.

## Publicar gratis para pruebas (Render + Supabase)

El archivo `render.yaml` prepara el servicio web gratis. Aún debes crear tus propias cuentas; no se ha publicado ningún servicio ni base de datos desde este proyecto.

1. Sube el código de GeoDrone a un repositorio privado de GitHub.
2. Crea un proyecto gratuito en Supabase. Elige una región cercana a Render y guarda la contraseña de la base de datos en un gestor de contraseñas.
3. En Supabase, abre **Connect** y copia el URI de **Session pooler**. Es el adecuado para servicios IPv4 como Render. No pongas ese URI en Android.
4. En Render, usa **New > Blueprint** y conecta el repositorio. Render leerá `render.yaml` y te pedirá `DATABASE_URL` y `NODEODM_URL`; `NODEODM_TOKEN` es necesario si tu NodeODM está protegido con Bearer. Introduce los secretos solo en el panel de Render. Render generará `JWT_SECRET`.
5. Espera el despliegue y verifica `https://<nombre-del-servicio>.onrender.com/health`. Debe responder `{"status":"ok"}`.
6. Copia la URL HTTPS de Render para configurarla en Cordenadas.

La base queda en un esquema PostgreSQL privado, no expuesto por la API REST pública de Supabase. El backend usa TLS hacia PostgreSQL y controla el acceso a los datos por el usuario autenticado.

### Limitaciones importantes del plan gratis

- Render apaga la API tras 15 minutos sin tráfico; la primera petición puede tardar alrededor de un minuto en despertar.
- Supabase Free pausa el proyecto tras una semana de inactividad, tiene 500 MB de base de datos y no incluye copias descargables. Reactívalo desde su panel si ocurre.
- El disco de Render es temporal. Las fotos y DSM guardados localmente no sobreviven a reinicios; los archivos grandes requieren almacenamiento de objetos persistente antes de usarse como archivo a largo plazo. NodeODM también debe estar disponible y protegido: no publiques un NodeODM sin autenticación en internet.
- Estos planes gratuitos sirven para pruebas/hobby, no garantizan disponibilidad ni copias de seguridad de producción. Revisa los límites vigentes antes de subir fotografías pesadas.

## Conectar la app Android Cordenadas

La app ya usa las rutas compatibles `/api/projects`, `/api/projects/{id}/flights`, `/api/flights/{id}/photos`, `/api/flights/{id}/status` y `/api/measurements/calculate`.

1. Abre `C:\Users\Salva\Cordenadas\gradle.properties` y agrega o actualiza esta línea con la URL HTTPS de Render:

   ```properties
   GEODRONE_API_URL=https://<nombre-del-servicio>.onrender.com/
   ```

2. En Android Studio, pulsa **Sync Project with Gradle Files** y ejecuta la variante `debug`. El mismo valor Gradle también se usa para la variante `release` cuando está definido.
3. Registra una cuenta con `POST /api/auth/register` desde Postman (JSON `{ "name", "email", "password" }`) y luego inicia sesión en la app. El botón de modo demo es local y no accede al backend.
4. No agregues `DATABASE_URL`, la contraseña de Supabase, `JWT_SECRET` ni `NODEODM_TOKEN` al código Android. La app solo necesita la URL pública HTTPS de la API.

Para desarrollo local, si no defines la propiedad, debug conserva `http://10.0.2.2:4000/`; en un teléfono físico configura la IP local de la PC temporalmente. El backend debe poder alcanzar a NodeODM mediante `NODEODM_URL`; la app no se conecta directamente a NodeODM.

## Autenticación

- `POST /api/auth/register` — JSON `{ "name", "email", "password" }`.
- `POST /api/auth/login` — JSON `{ "email", "password" }`.

Ambos devuelven un JWT. En las demás rutas `/api`, envía `Authorization: Bearer <token>`. Las consultas y modificaciones de proyectos, vuelos, mediciones y reportes se limitan al usuario autenticado.

## Proyectos, vuelos e imágenes

- `GET|POST /api/proyectos`; `GET|PUT|DELETE /api/proyectos/:projectId`.
- `GET|POST /api/proyectos/:projectId/vuelos`.
- `GET|PUT|DELETE /api/vuelos/:flightId`.
- `GET /api/vuelos/:flightId/imagenes`.
- `POST /api/vuelos/:flightId/imagenes` — multipart, campo repetible `imagenes` (JPG, PNG o TIFF). Se leen las coordenadas GPS EXIF como latitud/longitud WGS84 cuando están disponibles y las imágenes se envían a `POST /task/new` de NodeODM.
- `GET /api/vuelos/:flightId/procesamiento` — consulta el estado de NodeODM.
- `GET /api/vuelos/:flightId/resultados` — información y URL de descarga al concluir.
- `GET /api/vuelos/:flightId/resultados/descarga` — proxy del ZIP de resultados NodeODM.
- `POST /api/vuelos/:flightId/dsm` — multipart, campo `dsm`, para registrar el DSM GeoTIFF del vuelo.
- `GET /api/vuelos/:flightId/curvas?interval=1` — curvas GeoJSON (segmentos de isolínea) generadas desde el DSM. El intervalo se expresa en unidades de elevación del ráster, normalmente metros.

NodeODM genera ortomosaico, DSM y modelo 3D según sus opciones instaladas/configuradas. La API expone el archivo ZIP completo como descarga. Para usar elevaciones y curvas, carga el GeoTIFF DSM del ZIP mediante la ruta `dsm`. El TIFF debe incluir georreferenciación y un código EPSG conocido. Las fotos deben traer coordenadas GPS EXIF válidas; si faltan, la API rechaza la subida.

## Mediciones y exportaciones

`POST /api/mediciones` recibe `{ "flightId", "type", "points" }`, donde cada punto es `{ "lat", "lon" }` WGS84 y `type` es:

- `distance`: suma las distancias consecutivas en UTM; mínimo dos puntos.
- `perimeter`: suma los lados y cierra el polígono; mínimo tres vértices.
- `area`: fórmula de Shoelace en UTM; mínimo tres vértices.
- `elevation_difference`: diferencia absoluta entre dos elevaciones del DSM.

Cada resultado guarda entrada y datos proyectados en la tabla PostgreSQL `mediciones`. Un cálculo de perímetro/área usa una sola zona UTM determinada por el centro de los puntos; se rechazan latitudes fuera del rango UTM (-80° a 84°).

- `GET /api/mediciones` (opcional `?flightId=...`), `GET|DELETE /api/mediciones/:measurementId`.
- `GET /api/reportes/:flightId.csv`.
- `GET /api/reportes/:flightId.pdf`.

## Límites

Las imágenes aceptan hasta 500 archivos de 100 MB cada uno. Los DSM aceptan hasta 2 GB. La generación de curvas limita los rásteres a 4 millones de celdas, 500 niveles y 100 000 segmentos para acotar memoria y tamaño de respuesta.
